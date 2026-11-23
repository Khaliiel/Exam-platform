import os
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import storage
from ..config import settings as S
from ..db import get_db
from ..deps import current_candidate
from ..limiter import client_ip, limiter
from ..models import Batch, Candidate, Event, Snapshot
from ..paper import advance, apply_answer, build_paper, build_state, disqualify, get_runs, lock_section, start_section, utcnow
from ..security import bearer, decode_jwt, hash_token, new_token

router = APIRouter(prefix="/exam", tags=["exam"])

COUNTED = {"TAB_SWITCH"}
ALLOWED_EVENTS = {"TAB_SWITCH", "FULLSCREEN_EXIT", "COPY_ATTEMPT", "PASTE_ATTEMPT", "CUT_ATTEMPT", "CONTEXT_MENU",
                  "DEVTOOLS_KEY", "CAMERA_LOST", "CAMERA_RESTORED", "OFFLINE", "ONLINE", "SCREEN_CHANGE"}


class BeginIn(BaseModel):
    consent: bool
    screen: dict | None = None


@router.post("/begin")
@limiter.limit("30/minute")
async def begin(request: Request, body: BeginIn, db=Depends(get_db), authorization: str | None = Header(None)):
    if not body.consent:
        raise HTTPException(400, "Consent is required to begin.")
    payload = decode_jwt(bearer(authorization), "pre")
    cand = (await db.execute(select(Candidate).where(Candidate.id == int(payload["sub"])).with_for_update())).scalar_one()
    batch = await db.get(Batch, cand.batch_id)
    now = utcnow()
    if cand.status != "NOT_STARTED":
        raise HTTPException(409, "This Exam ID is already in use.")
    if not (batch.window_start <= now <= batch.window_end):
        raise HTTPException(403, "The exam window is not open.")

    cand.seed = secrets.randbits(31)
    runs = await build_paper(db, cand, now)           # may 503 before any state is changed
    token = new_token()
    cand.session_hash = hash_token(token)
    cand.status, cand.consent_given, cand.consent_at, cand.started_at = "IN_PROGRESS", True, now, now
    cand.ip = client_ip(request)
    cand.user_agent = (request.headers.get("user-agent") or "")[:300]
    db.add(Event(candidate_id=cand.id, type="BEGIN", detail={"screen": body.screen, "consent_at": now.isoformat()}))
    state = await build_state(db, cand, runs, now)
    await db.commit()
    return {"session_token": token, "state": state}


@router.get("/state")
async def state(cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    now = utcnow()
    runs = await get_runs(db, cand.id)
    advance(cand, runs, now)
    out = await build_state(db, cand, runs, now)
    await db.commit()
    return out


class AnswerItem(BaseModel):
    section: str
    pos: int
    choice: int | None = None
    elapsed_ms: int = 0


class AnswersIn(BaseModel):
    answers: list[AnswerItem] = Field(max_length=100)


@router.post("/answers")
async def answers(body: AnswersIn, cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    now = utcnow()
    runs = await get_runs(db, cand.id)
    advance(cand, runs, now)
    if cand.status == "IN_PROGRESS":
        for item in sorted(body.answers, key=lambda a: (a.section, a.pos)):
            await apply_answer(db, cand, runs, item, now)
        advance(cand, runs, now)
    out = await build_state(db, cand, runs, now)
    await db.commit()
    return out


@router.post("/start-section")
async def proceed(cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    """Candidate pressed 'Proceed': the next section starts now (after a short countdown)."""
    now = utcnow()
    runs = await get_runs(db, cand.id)
    advance(cand, runs, now)
    if cand.status == "IN_PROGRESS":
        start_section(runs, now)
    out = await build_state(db, cand, runs, now)
    await db.commit()
    return out


@router.post("/submit-section")
async def submit_section(cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    now = utcnow()
    runs = await get_runs(db, cand.id)
    advance(cand, runs, now)
    if cand.status == "IN_PROGRESS":
        i = next((i for i, r in enumerate(runs) if not r.locked), None)
        if i is not None and runs[i].started_at and now >= runs[i].started_at:
            lock_section(runs, i, now, "SUBMITTED_BY_CANDIDATE")
            advance(cand, runs, now)
    out = await build_state(db, cand, runs, now)
    await db.commit()
    return out


class EventIn(BaseModel):
    type: str
    detail: dict | None = None


@router.post("/event")
async def event(body: EventIn, cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    if body.type not in ALLOWED_EVENTS:
        raise HTTPException(400, "Unknown event type")
    now = utcnow()
    if cand.status != "IN_PROGRESS":
        return {"status": cand.status, "violations": cand.violations}
    if body.type in COUNTED:
        last = (await db.execute(select(func.max(Event.created_at)).where(Event.candidate_id == cand.id, Event.type == "TAB_SWITCH"))).scalar()
        if last and (now - last).total_seconds() < 2:       # visibilitychange + blur fire together: count once
            return {"status": cand.status, "violations": cand.violations, "ignored": True}
        cand.violations += 1
        db.add(Event(candidate_id=cand.id, type="TAB_SWITCH", detail={**(body.detail or {}), "n": cand.violations}))
        if cand.violations >= S.max_violations:
            runs = await get_runs(db, cand.id)
            disqualify(cand, runs, now, "DISQUALIFIED_TAB_SWITCH")
            db.add(Event(candidate_id=cand.id, type="DISQUALIFIED_TAB_SWITCH", detail={"violations": cand.violations}))
    else:
        db.add(Event(candidate_id=cand.id, type=body.type, detail=body.detail))
    out = {"status": cand.status, "violations": cand.violations, "max": S.max_violations}
    await db.commit()
    return out


class SnapIn(BaseModel):
    trigger: str = "interval"


@router.post("/snapshot/presign")
async def snapshot_presign(body: SnapIn, cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    if cand.status != "IN_PROGRESS":
        raise HTTPException(409, "Exam is not in progress")
    now = utcnow()
    last = (await db.execute(select(func.max(Snapshot.taken_at)).where(Snapshot.candidate_id == cand.id))).scalar()
    min_gap = 15 if body.trigger == "interval" else 4
    if last and (now - last) < timedelta(seconds=min_gap):
        return {"skip": True}
    key = f"snapshots/{cand.batch_id}/{cand.id}/{int(now.timestamp() * 1000)}.jpg"
    db.add(Snapshot(candidate_id=cand.id, key=key, trigger=body.trigger[:30], taken_at=now))
    await db.commit()
    if storage.r2_enabled():
        return {"mode": "r2", "url": storage.presign_put(key), "key": key}
    return {"mode": "direct", "key": key}


@router.post("/snapshot/direct")
async def snapshot_direct(key: str = Form(...), file: UploadFile = File(...), cand: Candidate = Depends(current_candidate), db=Depends(get_db)):
    """Dev/fallback path used when R2 is not configured."""
    owns = (await db.execute(select(Snapshot.id).where(Snapshot.candidate_id == cand.id, Snapshot.key == key))).first()
    if not owns:
        raise HTTPException(404, "Unknown snapshot")
    data = await file.read()
    if len(data) > 400_000:
        raise HTTPException(413, "Too large")
    path = storage.local_path(key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return {"ok": True}
