from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

SECTIONS = ["CURRENT_AFFAIRS", "LOGIC_MATHS", "ENGLISH"]
SECTION_LABELS = {
    "CURRENT_AFFAIRS": "Current Affairs",
    "LOGIC_MATHS": "Logical Reasoning & Mathematics",
    "ENGLISH": "English Language",
}
TZ = DateTime(timezone=True)


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    window_start: Mapped[datetime] = mapped_column(TZ)
    window_end: Mapped[datetime] = mapped_column(TZ)
    snapshots_purged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    # NOT_STARTED | IN_PROGRESS | SUBMITTED | DISQUALIFIED
    status: Mapped[str] = mapped_column(String(20), default="NOT_STARTED", index=True)
    session_hash: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    consent_given: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    disqualified_reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
    violations: Mapped[int] = mapped_column(Integer, default=0)
    seed: Mapped[int] = mapped_column(Integer, default=0)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    invite_sent_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    section: Mapped[str] = mapped_column(String(120), index=True)
    subtype: Mapped[str] = mapped_column(String(60), default="general")
    text: Mapped[str] = mapped_column(Text)
    passage: Mapped[str | None] = mapped_column(Text, nullable=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)       # diagram as data URL
    difficulty: Mapped[str] = mapped_column(String(10), default="medium", server_default="medium")  # easy|medium|hard
    options: Mapped[list] = mapped_column(JSONB)          # exactly 4 strings
    correct: Mapped[int] = mapped_column(Integer)         # 0..3 (index into options)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class SectionRun(Base):
    __tablename__ = "section_runs"
    __table_args__ = (UniqueConstraint("candidate_id", "section"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), index=True)
    section: Mapped[str] = mapped_column(String(120))
    n: Mapped[int] = mapped_column(Integer)
    ord: Mapped[int] = mapped_column(Integer, default=0)   # position of this section in the paper
    ready_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)   # when the section became available to start
    pos: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    q_deadline: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    lock_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)


class AttemptQuestion(Base):
    __tablename__ = "attempt_questions"
    __table_args__ = (UniqueConstraint("candidate_id", "section", "pos"), Index("ix_aq_cand_sec", "candidate_id", "section"))
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    section: Mapped[str] = mapped_column(String(120))
    pos: Mapped[int] = mapped_column(Integer)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"))
    option_order: Mapped[list] = mapped_column(JSONB)     # display slot -> original option index
    selected: Mapped[int | None] = mapped_column(Integer, nullable=True)   # display slot chosen
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    late_sync: Mapped[bool] = mapped_column(Boolean, default=False)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Snapshot(Base):
    __tablename__ = "snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), index=True)
    key: Mapped[str] = mapped_column(String(300))
    trigger: Mapped[str] = mapped_column(String(30), default="interval")
    taken_at: Mapped[datetime] = mapped_column(TZ)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())


class AdminUser(Base):
    __tablename__ = "admin_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), default="admin")   # admin | viewer


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    admin_email: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())
