from fastapi import Depends, Header, HTTPException
from sqlalchemy import select

from .db import get_db
from .models import Candidate
from .security import bearer, hash_token


async def current_candidate(db=Depends(get_db), authorization: str | None = Header(None)) -> Candidate:
    """Resolves the candidate by session token and row-locks it (serialises concurrent requests)."""
    token = bearer(authorization)
    cand = (await db.execute(select(Candidate).where(Candidate.session_hash == hash_token(token)).with_for_update())).scalar_one_or_none()
    if not cand:
        raise HTTPException(401, "This session is no longer valid.")
    return cand
