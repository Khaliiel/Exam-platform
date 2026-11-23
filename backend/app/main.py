from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from .config import settings
from .db import Base, engine
from .limiter import limiter
from .routers import admin, auth, exam


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.env == "production" and settings.jwt_secret == "change-me":
        raise RuntimeError("Set JWT_SECRET in production")
    if settings.auto_create_tables:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # lightweight migration for databases created before these columns existed
            await conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT"))
            for t in ("questions", "section_runs", "attempt_questions"):
                await conn.execute(text(f"ALTER TABLE {t} ALTER COLUMN section TYPE VARCHAR(120)"))
            await conn.execute(text("ALTER TABLE section_runs ADD COLUMN IF NOT EXISTS ord INTEGER NOT NULL DEFAULT 0"))
            await conn.execute(text("ALTER TABLE section_runs ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ"))
            await conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty VARCHAR(10) NOT NULL DEFAULT 'medium'"))
    yield


app = FastAPI(title="Proctored Assessment API", lifespan=lifespan,
              docs_url=None if settings.env == "production" else "/docs", redoc_url=None)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth.router, exam.router, admin.router):
    app.include_router(r, prefix="/api")
