from datetime import timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..db import get_db
from ..ids import normalize
from ..limiter import limiter
from ..models import Batch, Candidate
from ..paper import utcnow
from ..security import hash_token, make_jwt

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    exam_id: str


@router.get("/health")
async def health():
    return {"ok": True}


@router.post("/auth/login")
@limiter.limit(settings.login_rate)
async def login(request: Request, body: LoginIn, db=Depends(get_db), x_session_token: str | None = Header(None)):
    code = normalize(body.exam_id)
    cand = (await db.execute(select(Candidate).where(Candidate.code == code))).scalar_one_or_none()
    if not cand:
        raise HTTPException(404, "That Exam ID was not recognised. Check it and try again.")
    batch = await db.get(Batch, cand.batch_id)
    now = utcnow()

    if cand.status in ("SUBMITTED", "DISQUALIFIED"):
        raise HTTPException(409, "This Exam ID has already been used to complete an assessment.")
    if cand.status == "IN_PROGRESS":
        if x_session_token and cand.session_hash == hash_token(x_session_token):
            return {"resume": True}
        raise HTTPException(409, "This Exam ID is already in use on another device or browser. Contact the exam support desk.")
    if now < batch.window_start:
        raise HTTPException(403, "The exam window has not opened yet. Opens " + batch.window_start.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC"))
    if now > batch.window_end:
        raise HTTPException(403, "The exam window for your batch has closed.")

    return {
        "resume": False,
        "pre_token": make_jwt({"sub": str(cand.id), "typ": "pre"}, minutes=45),
        "name": cand.name,
        "window_end": batch.window_end.isoformat(),
        "org": settings.org_name,
    }
