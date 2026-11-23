"""python -m app.scripts.create_admin --email hr@company.com [--role admin|viewer]"""
import argparse
import asyncio
import getpass

from sqlalchemy import select

from ..db import Base, SessionLocal, engine
from ..models import AdminUser
from ..security import hash_pw


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--password")
    ap.add_argument("--role", default="admin", choices=["admin", "viewer"])
    a = ap.parse_args()
    pw = a.password or getpass.getpass("Password (min 12 chars): ")
    if len(pw) < 12:
        raise SystemExit("Password too short")
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        u = (await db.execute(select(AdminUser).where(AdminUser.email == a.email.lower()))).scalar_one_or_none()
        if u:
            u.password_hash, u.role = hash_pw(pw), a.role
        else:
            db.add(AdminUser(email=a.email.lower(), password_hash=hash_pw(pw), role=a.role))
        await db.commit()
    print("Admin saved:", a.email)


asyncio.run(main())
