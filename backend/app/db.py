from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


def make_engine(**kw):
    # statement_cache_size=0 + unique prepared names => safe behind pgbouncer/Supavisor (transaction mode)
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
        },
        **kw,
    )


engine = make_engine(pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()  # endpoints also commit explicitly before returning
