"""Celery: throttled invitation emails (Resend) + 30-day snapshot purge.

Run:  celery -A app.tasks.celery worker -l info
      celery -A app.tasks.celery beat -l info
"""
import asyncio
from datetime import timedelta
from zoneinfo import ZoneInfo

import httpx
from celery import Celery
from celery.schedules import crontab
from sqlalchemy import delete, select
from sqlalchemy.pool import NullPool

from . import storage
from .config import settings
from .db import make_engine
from sqlalchemy.ext.asyncio import async_sessionmaker
from .models import Batch, Candidate, Snapshot
from .paper import utcnow

celery = Celery("exam", broker=settings.celery_broker_url)
celery.conf.update(task_acks_late=True, timezone="UTC",
                   beat_schedule={"purge-snapshots": {"task": "purge_snapshots", "schedule": crontab(hour=3, minute=0)}})


class RetryLater(Exception):
    pass


def _session():
    eng = make_engine(poolclass=NullPool)
    return eng, async_sessionmaker(eng, expire_on_commit=False)()


def _email(c: Candidate, b: Batch) -> tuple[str, str]:
    lagos = ZoneInfo("Africa/Lagos")
    fmt = "%A %d %B %Y, %I:%M %p"
    link = f"{settings.app_url}/?id={c.code}"
    start, end = b.window_start.astimezone(lagos).strftime(fmt), b.window_end.astimezone(lagos).strftime(fmt)
    text = (f"Dear {c.name or 'Candidate'},\n\nYou are invited to take your online assessment.\n\n"
            f"Your Exam ID: {c.code}\nExam link: {link}\nOpens: {start} (Lagos time)\nCloses: {end} (Lagos time)\n\n"
            "Requirements: a Windows, macOS or Linux laptop/desktop, a working webcam, the latest Chrome/Edge/Firefox, "
            "and a stable internet connection. Mobile phones and tablets are not supported.\n"
            "Your Exam ID works for one attempt on one device. Do not share it.\n\n" + settings.org_name)
    html = (f"<div style='font-family:Georgia,serif;max-width:560px;margin:auto;color:#1c2430;line-height:1.6'>"
            f"<p>Dear {c.name or 'Candidate'},</p><p>You are invited to take your online assessment.</p>"
            f"<p style='font-size:20px;letter-spacing:1px'><b>{c.code}</b></p>"
            f"<p><a href='{link}' style='background:#1B365D;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none'>Open your exam</a></p>"
            f"<p>Opens: {start} (Lagos time)<br>Closes: {end} (Lagos time)</p>"
            "<p>You need a Windows, macOS or Linux laptop or desktop with a working webcam, the latest Chrome, Edge or Firefox, "
            "and a stable internet connection. Phones and tablets are not supported.</p>"
            f"<p>Your Exam ID works for one attempt on one device. Do not share it.</p><p>{settings.org_name}</p></div>")
    return text, html


async def _send(cid: int):
    eng, db = _session()
    try:
        async with db:
            c = await db.get(Candidate, cid)
            if not c or not c.email or c.invite_sent_at:
                return
            b = await db.get(Batch, c.batch_id)
            text, html = _email(c, b)
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post("https://api.resend.com/emails",
                                      headers={"Authorization": f"Bearer {settings.resend_api_key}", "Idempotency-Key": f"invite-{c.id}"},
                                      json={"from": settings.mail_from, "to": [c.email], "subject": "Your online assessment: Exam ID and link",
                                            "html": html, "text": text})
            if r.status_code == 429 or r.status_code >= 500:
                raise RetryLater()
            if r.status_code >= 400:
                print(f"[invite] permanent failure for candidate {cid}: {r.status_code} {r.text[:200]}")
                return
            c.invite_sent_at = utcnow()
            await db.commit()
    finally:
        await eng.dispose()


@celery.task(bind=True, name="send_invite", max_retries=6, rate_limit=settings.invite_rate_limit)
def send_invite(self, candidate_id: int):
    try:
        asyncio.run(_send(candidate_id))
    except RetryLater:
        raise self.retry(countdown=min(120, 5 * 2 ** self.request.retries))


async def _purge():
    eng, db = _session()
    cutoff = utcnow() - timedelta(days=settings.snapshot_retention_days)
    try:
        async with db:
            batches = (await db.execute(select(Batch).where(Batch.window_end < cutoff, Batch.snapshots_purged.is_(False)))).scalars().all()
            for b in batches:
                cids = (await db.execute(select(Candidate.id).where(Candidate.batch_id == b.id))).scalars().all()
                keys = (await db.execute(select(Snapshot.key).where(Snapshot.candidate_id.in_(cids)))).scalars().all()
                storage.delete_keys(list(keys))
                await db.execute(delete(Snapshot).where(Snapshot.candidate_id.in_(cids)))
                b.snapshots_purged = True
                print(f"[purge] batch {b.id}: removed {len(keys)} snapshots")
            await db.commit()
    finally:
        await eng.dispose()


@celery.task(name="purge_snapshots")
def purge_snapshots():
    asyncio.run(_purge())
