import base64
import csv
import io
import os
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.orm import defer

from .. import storage
from ..config import settings
from ..db import get_db
from ..ids import make_code
from ..limiter import limiter
from ..models import (SECTION_LABELS, SECTIONS, AdminUser, AttemptQuestion, AuditLog, Batch, Candidate, Event, Question,
                      SectionRun, Snapshot)
from ..paper import invalidate_bank, utcnow
from ..security import bearer, decode_jwt, make_jwt, verify_pw

router = APIRouter(prefix="/admin", tags=["admin"])
NON_FLAG = ["ONLINE", "OFFLINE", "CAMERA_RESTORED", "BEGIN", "RESET"]


def band(pct, status):
    """PASS >= 70%, FAIL <= 50%, CONSIDER in between. Only for finished attempts."""
    if pct is None or status not in ("SUBMITTED", "DISQUALIFIED"):
        return None
    return "PASS" if pct >= settings.pass_percent else "FAIL" if pct <= settings.fail_percent else "CONSIDER"


# ---------- auth ----------
async def require_admin(authorization: str | None = Header(None)) -> dict:
    return decode_jwt(bearer(authorization), "admin")


async def require_editor(a: dict = Depends(require_admin)) -> dict:
    if a.get("role") != "admin":
        raise HTTPException(403, "Read-only account")
    return a


async def audit(db, admin: dict, action: str, detail: dict | None = None):
    db.add(AuditLog(admin_email=admin["sub"], action=action, detail=detail))


class AdminLoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
@limiter.limit(settings.admin_login_rate)
async def admin_login(request: Request, body: AdminLoginIn, db=Depends(get_db)):
    u = (await db.execute(select(AdminUser).where(AdminUser.email == body.email.lower()))).scalar_one_or_none()
    ok = bool(u) and await run_in_threadpool(verify_pw, body.password, u.password_hash)
    if not ok:
        raise HTTPException(401, "Incorrect email or password.")
    db.add(AuditLog(admin_email=u.email, action="LOGIN"))
    await db.commit()
    return {"token": make_jwt({"sub": u.email, "role": u.role, "typ": "admin"}, settings.admin_session_minutes), "role": u.role}


# ---------- danger zone: reset data (password protected) ----------
class ResetAllIn(BaseModel):
    password: str
    mode: str = Field(pattern="^(results|all)$")
    confirm: str


@router.post("/data/reset")
@limiter.limit("5/minute")
async def reset_all_data(request: Request, body: ResetAllIn, db=Depends(get_db), a=Depends(require_editor)):
    """mode 'results': wipe every attempt/snapshot/event and set all candidates back to NOT_STARTED (IDs stay valid).
    mode 'all': also delete the candidates themselves. The question bank, batches and admins are never touched."""
    if body.confirm.strip().upper() != "RESET":
        raise HTTPException(400, 'Type RESET to confirm.')
    u = (await db.execute(select(AdminUser).where(AdminUser.email == a["sub"]))).scalar_one_or_none()
    if not u or not await run_in_threadpool(verify_pw, body.password, u.password_hash):
        raise HTTPException(403, "Incorrect password.")
    keys = list((await db.execute(select(Snapshot.key))).scalars().all())
    n_cand = (await db.execute(select(func.count()).select_from(Candidate))).scalar()
    for model in (AttemptQuestion, SectionRun, Snapshot, Event):
        await db.execute(delete(model))
    if body.mode == "all":
        await db.execute(delete(Candidate))
    else:
        await db.execute(update(Candidate).values(status="NOT_STARTED", session_hash=None, violations=0, started_at=None,
                                                  submitted_at=None, consent_at=None, consent_given=False,
                                                  disqualified_reason=None, ip=None, user_agent=None))
    await audit(db, a, "DATA_RESET", {"mode": body.mode, "candidates": n_cand, "snapshots": len(keys)})
    await db.commit()
    try:
        storage.delete_keys(keys)
    except Exception:
        pass
    return {"ok": True, "mode": body.mode, "candidates": n_cand, "snapshots_removed": len(keys)}


# ---------- stats ----------
@router.get("/stats")
async def stats(db=Depends(get_db), _=Depends(require_admin)):
    rows = (await db.execute(select(Candidate.status, func.count()).group_by(Candidate.status))).all()
    flagged = (await db.execute(select(func.count(func.distinct(Event.candidate_id))).where(Event.type.notin_(NON_FLAG)))).scalar()
    return {"by_status": {s: c for s, c in rows}, "flagged": flagged}


# ---------- batches ----------
class BatchIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    window_start: datetime
    window_end: datetime


@router.get("/batches")
async def list_batches(db=Depends(get_db), _=Depends(require_admin)):
    counts = dict((await db.execute(select(Candidate.batch_id, func.count()).group_by(Candidate.batch_id))).all())
    rows = (await db.execute(select(Batch).order_by(Batch.id.desc()))).scalars().all()
    return [{"id": b.id, "name": b.name, "window_start": b.window_start, "window_end": b.window_end,
             "candidates": counts.get(b.id, 0), "snapshots_purged": b.snapshots_purged} for b in rows]


@router.post("/batches")
async def create_batch(body: BatchIn, db=Depends(get_db), a=Depends(require_editor)):
    if body.window_end <= body.window_start:
        raise HTTPException(400, "Window end must be after start")
    b = Batch(name=body.name, window_start=body.window_start, window_end=body.window_end)
    db.add(b)
    await audit(db, a, "BATCH_CREATE", {"name": body.name})
    await db.commit()
    return {"id": b.id}


@router.post("/batches/{batch_id}/invites")
async def send_invites(batch_id: int, only_unsent: bool = True, db=Depends(get_db), a=Depends(require_editor)):
    from ..tasks import send_invite
    q = select(Candidate.id).where(Candidate.batch_id == batch_id, Candidate.email != "")
    if only_unsent:
        q = q.where(Candidate.invite_sent_at.is_(None))
    ids = (await db.execute(q)).scalars().all()
    for cid in ids:
        send_invite.delay(cid)
    await audit(db, a, "INVITES_QUEUED", {"batch_id": batch_id, "count": len(ids)})
    await db.commit()
    return {"queued": len(ids)}


@router.get("/batches/{batch_id}/ids.csv")
async def ids_csv(batch_id: int, db=Depends(get_db), _=Depends(require_admin)):
    rows = (await db.execute(select(Candidate).where(Candidate.batch_id == batch_id).order_by(Candidate.id))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["exam_id", "name", "email", "status"])
    for c in rows:
        w.writerow([c.code, c.name, c.email, c.status])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="batch-{batch_id}-ids.csv"'})


# ---------- candidates ----------
async def _mint(db, batch_id: int, prefix: str, people: list[tuple[str, str]]) -> list[dict]:
    if not await db.get(Batch, batch_id):
        raise HTTPException(404, "Batch not found")
    existing = set((await db.execute(select(Candidate.code))).scalars().all())
    out = []
    for name, email in people:
        for _ in range(20):
            code = make_code(prefix)
            if code not in existing:
                break
        else:
            raise HTTPException(500, "Could not mint a unique ID")
        existing.add(code)
        db.add(Candidate(code=code, name=name, email=email, batch_id=batch_id))
        out.append({"exam_id": code, "name": name, "email": email})
    return out


class GenIn(BaseModel):
    batch_id: int
    count: int = Field(ge=1, le=5000)
    prefix: str = Field(default="REC26", pattern=r"^[A-Z0-9]{2,8}$")


@router.post("/candidates/generate")
async def generate(body: GenIn, db=Depends(get_db), a=Depends(require_editor)):
    out = await _mint(db, body.batch_id, body.prefix, [("", "")] * body.count)
    await audit(db, a, "IDS_GENERATED", {"batch_id": body.batch_id, "count": body.count})
    await db.commit()
    return {"created": out}


@router.post("/candidates/import")
async def import_candidates(batch_id: int = Form(...), prefix: str = Form("REC26"), file: UploadFile = File(...),
                            db=Depends(get_db), a=Depends(require_editor)):
    text = (await file.read()).decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    people = [((r.get("name") or "").strip(), (r.get("email") or "").strip().lower()) for r in rows if (r.get("name") or r.get("email"))]
    if not people:
        raise HTTPException(400, "CSV needs columns: name,email")
    out = await _mint(db, batch_id, prefix, people)
    await audit(db, a, "CANDIDATES_IMPORTED", {"batch_id": batch_id, "count": len(out)})
    await db.commit()
    return {"created": out}


@router.get("/candidates")
async def list_candidates(batch_id: int | None = None, status: str | None = None, q: str | None = None,
                          flagged: bool = False, sort: str = "score", page: int = 1, limit: int = Query(50, le=200),
                          db=Depends(get_db), _=Depends(require_admin)):
    score_sq = (select(AttemptQuestion.candidate_id.label("cid"),
                       func.coalesce(func.sum(case((AttemptQuestion.is_correct.is_(True), 1), else_=0)), 0).label("score"),
                       func.count(AttemptQuestion.selected).label("answered"), func.count().label("total"))
                .group_by(AttemptQuestion.candidate_id).subquery())
    flag_sq = (select(Event.candidate_id.label("cid"), func.count().label("flags")).where(Event.type.notin_(NON_FLAG))
               .group_by(Event.candidate_id).subquery())
    score, flags = func.coalesce(score_sq.c.score, 0), func.coalesce(flag_sq.c.flags, 0)
    base = (select(Candidate, Batch.name.label("batch_name"), score, func.coalesce(score_sq.c.answered, 0), func.coalesce(score_sq.c.total, 0), flags)
            .join(Batch, Batch.id == Candidate.batch_id)
            .outerjoin(score_sq, score_sq.c.cid == Candidate.id).outerjoin(flag_sq, flag_sq.c.cid == Candidate.id))
    if batch_id:
        base = base.where(Candidate.batch_id == batch_id)
    if status:
        base = base.where(Candidate.status == status)
    if q:
        like = f"%{q}%"
        base = base.where(Candidate.name.ilike(like) | Candidate.code.ilike(like) | Candidate.email.ilike(like))
    if flagged:
        base = base.where(flags > 0)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar()
    dur = Candidate.submitted_at - Candidate.started_at
    order = {"score": [score.desc(), dur.asc().nulls_last()], "flags": [flags.desc()], "name": [Candidate.name.asc()],
             "submitted": [Candidate.submitted_at.desc().nulls_last()]}.get(sort, [score.desc()])
    rows = (await db.execute(base.order_by(*order).limit(limit).offset((page - 1) * limit))).all()
    ids = [r[0].id for r in rows]
    per = {}
    if ids:
        for cid, sec, sc, ans in (await db.execute(
            select(AttemptQuestion.candidate_id, AttemptQuestion.section,
                   func.coalesce(func.sum(case((AttemptQuestion.is_correct.is_(True), 1), else_=0)), 0),
                   func.count(AttemptQuestion.selected))
            .where(AttemptQuestion.candidate_id.in_(ids)).group_by(AttemptQuestion.candidate_id, AttemptQuestion.section))).all():
            per.setdefault(cid, {})[sec] = {"score": sc, "answered": ans}
    items = []
    for c, bname, sc, ans, tot, fl in rows:
        secs = (c.submitted_at - c.started_at).total_seconds() if c.submitted_at and c.started_at else None
        pct = round(sc * 100 / tot, 1) if tot else None
        items.append({"id": c.id, "exam_id": c.code, "name": c.name, "email": c.email, "batch": bname, "status": c.status,
                      "score": sc, "answered": ans, "total_questions": tot, "percent": pct, "band": band(pct, c.status),
                      "sections": per.get(c.id, {}), "duration_sec": secs,
                      "violations": c.violations, "flags": fl, "reason": c.disqualified_reason})
    order = list((await db.execute(select(Question.section).where(Question.active.is_(True))
                                   .group_by(Question.section).order_by(func.min(Question.id)))).scalars().all())
    for secs in per.values():
        for s_ in secs:
            if s_ not in order:
                order.append(s_)
    return {"total": total, "items": items, "section_order": order}


@router.get("/candidates/{cid}")
async def candidate_detail(cid: int, db=Depends(get_db), _=Depends(require_admin)):
    c = await db.get(Candidate, cid)
    if not c:
        raise HTTPException(404, "Not found")
    answers = []
    for aq, q in (await db.execute(select(AttemptQuestion, Question).join(Question, Question.id == AttemptQuestion.question_id)
                                   .where(AttemptQuestion.candidate_id == cid))).all():
        answers.append({"section": aq.section, "pos": aq.pos, "text": q.text, "passage": q.passage,
                        "options": [q.options[o] for o in aq.option_order], "selected": aq.selected,
                        "correct_slot": aq.option_order.index(q.correct), "is_correct": aq.is_correct,
                        "answered_at": aq.answered_at, "late_sync": aq.late_sync, "elapsed_ms": aq.elapsed_ms})
    events = (await db.execute(select(Event).where(Event.candidate_id == cid).order_by(Event.created_at))).scalars().all()
    snaps = (await db.execute(select(Snapshot).where(Snapshot.candidate_id == cid).order_by(Snapshot.taken_at))).scalars().all()
    runs = (await db.execute(select(SectionRun).where(SectionRun.candidate_id == cid))).scalars().all()
    ordmap = {r.section: r.ord for r in runs}
    answers.sort(key=lambda a: (ordmap.get(a["section"], 99), a["pos"]))
    return {
        "candidate": {"id": c.id, "exam_id": c.code, "name": c.name, "email": c.email, "status": c.status, "violations": c.violations,
                      "reason": c.disqualified_reason, "started_at": c.started_at, "submitted_at": c.submitted_at,
                      "consent_at": c.consent_at, "ip": c.ip, "user_agent": c.user_agent},
        "sections": [{"section": r.section, "label": SECTION_LABELS.get(r.section, r.section), "locked_at": r.locked_at, "reason": r.lock_reason} for r in sorted(runs, key=lambda r: r.ord)],
        "answers": answers,
        "events": [{"type": e.type, "detail": e.detail, "at": e.created_at} for e in events],
        "snapshots": [{"id": s.id, "trigger": s.trigger, "at": s.taken_at,
                       "url": storage.presign_get(s.key) if storage.r2_enabled() else None} for s in snaps],
    }


class ResetIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)


@router.post("/candidates/{cid}/reset")
async def reset_candidate(cid: int, body: ResetIn, db=Depends(get_db), a=Depends(require_editor)):
    c = (await db.execute(select(Candidate).where(Candidate.id == cid).with_for_update())).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Not found")
    await db.execute(delete(AttemptQuestion).where(AttemptQuestion.candidate_id == cid))
    await db.execute(delete(SectionRun).where(SectionRun.candidate_id == cid))
    prev = {"status": c.status, "violations": c.violations}
    c.status, c.session_hash, c.violations = "NOT_STARTED", None, 0
    c.started_at = c.submitted_at = c.consent_at = c.disqualified_reason = None
    c.consent_given = False
    db.add(Event(candidate_id=cid, type="RESET", detail={"by": a["sub"], "reason": body.reason, "previous": prev}))
    await audit(db, a, "CANDIDATE_RESET", {"candidate": c.code, "reason": body.reason, **prev})
    await db.commit()
    return {"ok": True}


@router.get("/snapshots/{sid}/file")
async def snapshot_file(sid: int, token: str, db=Depends(get_db)):
    decode_jwt(token, "admin")        # <img> tags cannot send headers, so the token rides in the query string
    s = await db.get(Snapshot, sid)
    if not s:
        raise HTTPException(404, "Not found")
    path = storage.local_path(s.key)
    if not os.path.exists(path):
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type="image/jpeg")


# ---------- questions ----------
class QuestionIn(BaseModel):
    section: str
    subtype: str = "general"
    text: str = Field(min_length=3)
    passage: str | None = None
    options: list[str] = Field(min_length=4, max_length=4)
    correct: int = Field(ge=0, le=3)
    active: bool = True
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")


@router.get("/questions/stats")
async def question_stats(db=Depends(get_db), _=Depends(require_admin)):
    rows = (await db.execute(select(Question.section, Question.subtype, func.count()).where(Question.active.is_(True))
                             .group_by(Question.section, Question.subtype))).all()
    return [{"section": s, "label": SECTION_LABELS.get(s, s), "subtype": st, "count": c} for s, st, c in rows]


@router.get("/questions")
async def list_questions(section: str | None = None, q: str | None = None, page: int = 1, limit: int = Query(50, le=200),
                         db=Depends(get_db), _=Depends(require_admin)):
    base = select(Question).options(defer(Question.image))
    if section:
        base = base.where(Question.section == section)
    if q:
        base = base.where(Question.text.ilike(f"%{q}%"))
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar()
    rows = (await db.execute(base.order_by(Question.id.desc()).limit(limit).offset((page - 1) * limit))).scalars().all()
    has = set((await db.execute(select(Question.id).where(Question.id.in_([r.id for r in rows]), Question.image.isnot(None)))).scalars().all()) if rows else set()
    return {"total": total, "items": [{"id": r.id, "section": r.section, "subtype": r.subtype, "text": r.text, "passage": r.passage,
                                       "options": r.options, "correct": r.correct, "active": r.active,
                                       "difficulty": r.difficulty, "has_image": r.id in has} for r in rows]}


def _check_section(s: str):
    if not s or not s.strip() or len(s) > 120:
        raise HTTPException(400, "Section name is required (max 120 characters)")


@router.post("/questions")
async def create_question(body: QuestionIn, db=Depends(get_db), a=Depends(require_editor)):
    _check_section(body.section)
    qn = Question(**body.model_dump())
    db.add(qn)
    await audit(db, a, "QUESTION_CREATE", {"section": body.section})
    await db.commit()
    invalidate_bank()
    return {"id": qn.id}


@router.put("/questions/{qid}")
async def update_question(qid: int, body: QuestionIn, db=Depends(get_db), a=Depends(require_editor)):
    _check_section(body.section)
    qn = await db.get(Question, qid)
    if not qn:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(qn, k, v)
    await audit(db, a, "QUESTION_UPDATE", {"id": qid})
    await db.commit()
    invalidate_bank()
    return {"ok": True}


@router.delete("/questions/{qid}")
async def deactivate_question(qid: int, db=Depends(get_db), a=Depends(require_editor)):
    qn = await db.get(Question, qid)
    if not qn:
        raise HTTPException(404, "Not found")
    qn.active = False            # soft delete: papers already issued still reference the row
    await audit(db, a, "QUESTION_DEACTIVATE", {"id": qid})
    await db.commit()
    invalidate_bank()
    return {"ok": True}


DIFF = {"easy": "easy", "simple": "easy", "medium": "medium", "moderate": "medium", "intermediate": "medium",
        "hard": "hard", "difficult": "hard"}


def _cell_text(c) -> str:
    """Excel stores 18.10% as 0.181 with a % format: turn it back into the text the author typed."""
    v = c.value
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (int, float)):
        fmt = c.number_format or ""
        if "%" in fmt:
            dec = len(fmt.split(".")[1].rstrip("%")) if "." in fmt else 0
            return f"{v * 100:.{dec}f}%"
        return str(int(v)) if float(v).is_integer() else str(v)
    return str(v).strip()


ALLOWED_IMG = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_IMG = 250_000


@router.post("/questions/{qid}/image")
async def set_question_image(qid: int, file: UploadFile = File(...), db=Depends(get_db), a=Depends(require_editor)):
    qn = await db.get(Question, qid)
    if not qn:
        raise HTTPException(404, "Not found")
    if file.content_type not in ALLOWED_IMG:
        raise HTTPException(400, "Use a PNG, JPEG, WebP or GIF image")
    data = await file.read()
    if len(data) > MAX_IMG:
        raise HTTPException(413, "Image is over 250 KB. Compress or resize it and try again (aim for under 150 KB).")
    qn.image = f"data:{file.content_type};base64," + base64.b64encode(data).decode()
    await audit(db, a, "QUESTION_IMAGE_SET", {"id": qid})
    await db.commit()
    invalidate_bank()
    return {"ok": True}


@router.delete("/questions/{qid}/image")
async def clear_question_image(qid: int, db=Depends(get_db), a=Depends(require_editor)):
    qn = await db.get(Question, qid)
    if not qn:
        raise HTTPException(404, "Not found")
    qn.image = None
    await audit(db, a, "QUESTION_IMAGE_CLEARED", {"id": qid})
    await db.commit()
    return {"ok": True}


ALIASES = {"current affairs": "CURRENT_AFFAIRS", "current_affairs": "CURRENT_AFFAIRS",
           "logical reasoning & mathematics": "LOGIC_MATHS", "logical reasoning and mathematics": "LOGIC_MATHS",
           "logic_maths": "LOGIC_MATHS", "logical reasoning": "LOGIC_MATHS", "maths": "LOGIC_MATHS",
           "english language": "ENGLISH", "english": "ENGLISH"}


@router.post("/questions/import")
async def import_questions(file: UploadFile = File(...), db=Depends(get_db), a=Depends(require_editor)):
    raw = await file.read()
    if file.filename and file.filename.lower().endswith((".xlsx", ".xlsm")):
        ws = openpyxl.load_workbook(io.BytesIO(raw), data_only=True).active
        grid = [[_cell_text(c) for c in row] for row in ws.iter_rows()]
    else:
        grid = [[c.strip() for c in row] for row in csv.reader(io.StringIO(raw.decode("utf-8-sig")))]
    if len(grid) < 2:
        raise HTTPException(400, "File is empty")
    head = [h.lower() for h in grid[0]]
    errors, added = [], 0
    have = set((await db.execute(select(Question.section, Question.text))).all())
    for ln, row in enumerate(grid[1:], start=2):
        d = dict(zip(head, row))
        if not any(row):
            continue
        sec = " ".join(d.get("section", "").split())
        opts = [d.get(f"option_{c}", "") for c in "abcd"]
        corr = d.get("correct", "").upper()[:1]
        text = d.get("question", "")
        missing = [n for n, v in [("section", sec), ("question", text), *[(f"option_{c}", o) for c, o in zip("abcd", opts)]] if not v]
        if corr not in list("ABCD"):
            missing.append("correct (must be A, B, C or D)")
        if len(sec) > 120:
            missing.append("section (name too long)")
        if missing:
            errors.append(f"Row {ln}: missing or invalid: " + ", ".join(missing))
            continue
        if (sec, text) in have:
            errors.append(f"Row {ln}: duplicate skipped")
            continue
        have.add((sec, text))
        db.add(Question(section=sec, subtype=d.get("subtype") or "general", text=text, passage=d.get("passage") or None,
                        options=opts, correct="ABCD".index(corr),
                        difficulty=DIFF.get(d.get("difficulty", "").strip().lower(), "medium")))
        added += 1
    await audit(db, a, "QUESTIONS_IMPORTED", {"added": added, "errors": len(errors)})
    await db.commit()
    invalidate_bank()
    return {"added": added, "errors": errors[:50]}


# ---------- export / logs ----------
@router.get("/export.xlsx")
async def export_xlsx(batch_id: int | None = None, db=Depends(get_db), a=Depends(require_admin)):
    data = await list_candidates(batch_id=batch_id, limit=200, page=1, sort="score", db=db, _=a)
    items = data["items"]
    order = data["section_order"]
    total = data["total"]
    page = 2
    while len(items) < total:
        items += (await list_candidates(batch_id=batch_id, limit=200, page=page, sort="score", db=db, _=a))["items"]
        page += 1
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Scores"
    ws.append(["Rank", "Exam ID", "Name", "Email", "Batch", "Status", *[SECTION_LABELS.get(s, s) for s in order], "Total", "Answered",
               "Minutes", "Tab-switch strikes", "Flags", "Disqualified reason", "Percent", "Result"])
    for i, c in enumerate(items, 1):
        ws.append([i, c["exam_id"], c["name"], c["email"], c["batch"], c["status"],
                   *[c["sections"].get(s, {}).get("score", 0) for s in order], c["score"], c["answered"],
                   round(c["duration_sec"] / 60, 1) if c["duration_sec"] else None, c["violations"], c["flags"], c["reason"], c["percent"], c["band"]])
    from openpyxl.styles import PatternFill
    fills = {"PASS": "C6EFCE", "CONSIDER": "BDD7EE", "FAIL": "FFC7CE"}
    for row in ws.iter_rows(min_row=2):
        f = fills.get(row[-1].value)
        if f:
            for cell in row:
                cell.fill = PatternFill("solid", fgColor=f)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="score-report.xlsx"'})


@router.get("/audit")
async def audit_log(limit: int = Query(100, le=500), db=Depends(get_db), _=Depends(require_admin)):
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))).scalars().all()
    return [{"admin": r.admin_email, "action": r.action, "detail": r.detail, "at": r.created_at} for r in rows]


@router.get("/events")
async def recent_events(type: str | None = None, limit: int = Query(100, le=500), db=Depends(get_db), _=Depends(require_admin)):
    q = (select(Event, Candidate.code, Candidate.name).join(Candidate, Candidate.id == Event.candidate_id)
         .where(Event.type.notin_(NON_FLAG)).order_by(Event.id.desc()).limit(limit))
    if type:
        q = q.where(Event.type == type)
    return [{"exam_id": code, "name": name, "type": e.type, "detail": e.detail, "at": e.created_at}
            for e, code, name in (await db.execute(q)).all()]
