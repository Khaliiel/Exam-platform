import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException

from .config import settings


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def make_jwt(payload: dict, minutes: int) -> str:
    data = {**payload, "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes)}
    return jwt.encode(data, settings.jwt_secret, algorithm="HS256")


def decode_jwt(token: str, typ: str) -> dict:
    try:
        p = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if p.get("typ") != typ:
        raise HTTPException(401, "Invalid token")
    return p


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing token")
    return authorization[7:].strip()
