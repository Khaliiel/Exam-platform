"""Exam engine: paper generation + server-authoritative timing state machine.

Timing is computed lazily from stored deadlines (advance()), so it is correct even if
the candidate's browser crashed, went offline, or never calls the API again.
"""
import math
import random
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select

from .config import settings as S
from .models import SECTION_LABELS, SECTIONS, AttemptQuestion, Candidate, Question, SectionRun


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---- question bank cache (ids only; refreshed every 60s) -------------------------
_cache: dict = {"t": 0.0, "data": None}


async def _bank(db):
    if _cache["data"] is None or time.time() - _cache["t"] > 60:
        rows = (await db.execute(select(Question.id, Question.section, Question.subtype, Question.difficulty)
                                 .where(Question.active.is_(True)).order_by(Question.id))).all()
        _cache.update(t=time.time(), data=[(r.id, r.section, r.subtype, r.difficulty) for r in rows])
    return _cache["data"]


def invalidate_bank():
    _cache["data"] = None


def _allocate(rng, sizes: dict, n: int) -> dict:
    """Split n picks across sub-types so that EVERY question in the section has exactly the same
    chance (n / total) of appearing in a candidate's paper, whatever the sub-type sizes are.
    Uses randomised (systematic) rounding: each sub-type gets floor(share) or floor(share)+1,
    with the extra pick given at random in proportion to the fractional part."""
    total = sum(sizes.values())
    if n >= total:
        return dict(sizes)
    keys = sorted(sizes)
    rng.shuffle(keys)
    u, acc, q = rng.random(), 0.0, {}
    for k in keys:
        lo, acc = acc, acc + n * sizes[k] / total
        q[k] = min(sizes[k], math.ceil(acc - u) - math.ceil(lo - u))
    # float-rounding safety net: always return exactly n picks
    while sum(q.values()) < n:
        k = rng.choice([k for k in keys if q[k] < sizes[k]]); q[k] += 1
    while sum(q.values()) > n:
        k = rng.choice([k for k in keys if q[k] > 0]); q[k] -= 1
    return q


def _draw(rng, items, k):
    """Draw k questions with the SAME easy/medium/hard mix for every candidate (40% / 40% / 20%),
    so no candidate gets a harder paper by luck. Falls back gracefully if a level is short."""
    by = {"easy": [], "medium": [], "hard": []}
    for it in items:
        by.get(it[3], by["medium"]).append(it)
    want = {"easy": round(k * 0.4), "hard": round(k * 0.2)}
    want["medium"] = k - want["easy"] - want["hard"]
    out = []
    for d in ("easy", "medium", "hard"):
        out += rng.sample(by[d], min(want[d], len(by[d])))
    if len(out) < k:
        rest = [it for it in items if it not in out]
        out += rng.sample(rest, min(k - len(out), len(rest)))
    return out


# ---- paper generation --------------------------------------------------------------
async def build_paper(db, cand: Candidate, now: datetime) -> list[SectionRun]:
    bank = await _bank(db)
    rng = random.Random(cand.seed)          # seed stored => paper is reproducible for disputes
    N = S.questions_per_section
    runs: list[SectionRun] = []
    order: list[str] = []                       # sections in order of first appearance in the bank
    for b in bank:
        if b[1] not in order:
            order.append(b[1])
    if not order:
        raise HTTPException(503, "The question bank is empty. Contact the administrator.")
    for si, sec in enumerate(order):
        pool = [b for b in bank if b[1] == sec]
        subs: dict[str, list] = {}
        for b in pool:
            subs.setdefault(b[2], []).append(b)
        quota = _allocate(rng, {k: len(v) for k, v in subs.items()}, N)
        chosen: list = []
        for sub in sorted(subs):
            if quota[sub]:
                chosen += _draw(rng, subs[sub], quota[sub])
        if not chosen:
            raise HTTPException(503, f"Question bank for {SECTION_LABELS.get(sec, sec)} is empty. Contact the administrator.")
        rng.shuffle(chosen)
        for pos, b in enumerate(chosen):
            db.add(AttemptQuestion(candidate_id=cand.id, section=sec, pos=pos, question_id=b[0],
                                   option_order=rng.sample(range(4), 4)))
        run = SectionRun(candidate_id=cand.id, section=sec, n=len(chosen), ord=si, pos=0)
        if si == 0:
            run.ready_at = now
        db.add(run)
        runs.append(run)
    await db.flush()
    return runs


async def get_runs(db, cid: int) -> list[SectionRun]:
    rows = (await db.execute(select(SectionRun).where(SectionRun.candidate_id == cid))).scalars().all()
    return sorted(rows, key=lambda r: r.ord)


# ---- state machine -----------------------------------------------------------------
def _begin(run: SectionRun, at: datetime) -> None:
    """Start a section as if the candidate had pressed Proceed at `at`."""
    run.started_at = at + timedelta(seconds=S.intro_seconds)
    run.deadline = run.started_at + timedelta(seconds=S.section_seconds)
    run.q_deadline = run.started_at + timedelta(seconds=S.question_seconds)


def lock_section(runs: list[SectionRun], i: int, at: datetime, reason: str) -> None:
    r = runs[i]
    r.locked, r.locked_at, r.lock_reason = True, at, reason
    if i + 1 < len(runs):
        runs[i + 1].ready_at = at       # the next section now WAITS for the candidate to press Proceed


def start_section(runs: list[SectionRun], now: datetime) -> bool:
    """Candidate pressed Proceed: starts the first unlocked section if it has not started yet."""
    for r in runs:
        if r.locked:
            continue
        if r.started_at is None:
            _begin(r, now)
            return True
        return False
    return False


def advance(cand: Candidate, runs: list[SectionRun], now: datetime) -> None:
    if cand.status != "IN_PROGRESS":
        return
    qs = timedelta(seconds=S.question_seconds)
    for i, r in enumerate(runs):
        if r.locked:
            continue
        if r.started_at is None:
            if r.ready_at is None:       # rows created before this feature existed
                r.ready_at = runs[i - 1].locked_at if i > 0 and runs[i - 1].locked_at else now
            auto = r.ready_at + timedelta(seconds=S.break_seconds)
            if now < auto:
                return                    # waiting for the candidate to press Proceed
            _begin(r, auto)               # waited too long: starts by itself, clock fair for everyone
        if now < r.started_at:
            return
        while not r.locked:
            if now >= r.deadline:
                lock_section(runs, i, r.deadline, "TIMEOUT")
            elif now >= r.q_deadline:
                if r.pos >= r.n - 1:
                    lock_section(runs, i, min(r.q_deadline, r.deadline), "COMPLETED")
                else:
                    r.pos += 1
                    r.q_deadline = r.q_deadline + qs
            else:
                return
    cand.status = "SUBMITTED"
    cand.submitted_at = max(r.locked_at for r in runs)


def disqualify(cand: Candidate, runs: list[SectionRun], now: datetime, reason: str) -> None:
    cand.status, cand.disqualified_reason, cand.submitted_at = "DISQUALIFIED", reason, now
    for r in runs:
        if not r.locked:
            r.locked, r.locked_at, r.lock_reason = True, now, reason


async def apply_answer(db, cand: Candidate, runs: list[SectionRun], item, now: datetime) -> str:
    run = next((r for r in runs if r.section == item.section), None)
    if run is None:
        return "bad_section"
    if run.locked or run.started_at is None or now < run.started_at:
        return "locked"
    row = (await db.execute(
        select(AttemptQuestion, Question).join(Question, Question.id == AttemptQuestion.question_id)
        .where(AttemptQuestion.candidate_id == cand.id, AttemptQuestion.section == item.section, AttemptQuestion.pos == item.pos)
    )).first()
    if not row:
        return "bad_pos"
    aq, q = row
    if aq.selected is not None:
        return "duplicate"
    if item.pos > run.pos:
        return "future"
    if item.choice is None:
        return "skipped"
    if not 0 <= item.choice <= 3:
        return "bad_choice"
    on_time = item.pos == run.pos
    # Late sync (answer made before the server moved on, delivered after an outage): trust a bounded client claim.
    if not on_time and item.elapsed_ms > S.question_seconds * 1000 + S.late_sync_grace_ms:
        return "too_late"
    aq.selected = item.choice
    aq.is_correct = aq.option_order[item.choice] == q.correct
    aq.answered_at, aq.late_sync, aq.elapsed_ms = now, not on_time, item.elapsed_ms
    if on_time:
        idx = runs.index(run)
        if run.pos >= run.n - 1:
            lock_section(runs, idx, now, "COMPLETED")
        else:
            run.pos += 1
            run.q_deadline = now + timedelta(seconds=S.question_seconds)
    return "ok"


# ---- state payload (never contains the answer key) --------------------------------------
def _ms(td: timedelta) -> int:
    return max(0, int(td.total_seconds() * 1000))


async def build_state(db, cand: Candidate, runs: list[SectionRun], now: datetime) -> dict:
    base = {
        "server_time": int(now.timestamp() * 1000),
        "status": cand.status,
        "violations": cand.violations,
        "max_violations": S.max_violations,
        "question_seconds": S.question_seconds,
        "section_seconds": S.section_seconds,
    }
    if cand.status != "IN_PROGRESS":
        return base
    idx, run = next(((i, r) for i, r in enumerate(runs) if not r.locked), (None, None))
    if run is None:
        return base
    base.update(section=run.section, section_label=SECTION_LABELS.get(run.section, run.section), section_index=idx, section_count=len(runs))
    if run.started_at is None:
        ready = run.ready_at or now
        prev = runs[idx - 1] if idx > 0 else None
        base.update(phase="ready", n=run.n, first=(idx == 0),
                    auto_start_in_ms=_ms(ready + timedelta(seconds=S.break_seconds) - now),
                    prev_label=SECTION_LABELS.get(prev.section, prev.section) if prev else None,
                    prev_reason=prev.lock_reason if prev else None)
        return base
    if now < run.started_at:
        base.update(phase="intro", starts_in_ms=_ms(run.started_at - now))
        return base
    aq, q = (await db.execute(
        select(AttemptQuestion, Question).join(Question, Question.id == AttemptQuestion.question_id)
        .where(AttemptQuestion.candidate_id == cand.id, AttemptQuestion.section == run.section, AttemptQuestion.pos == run.pos)
    )).first()
    base.update(
        phase="question", pos=run.pos, n=run.n,
        q_remaining_ms=_ms(run.q_deadline - now),
        section_remaining_ms=_ms(run.deadline - now),
        already_selected=aq.selected,
        question={
            "text": q.text, "passage": q.passage, "image": q.image,
            "options": [{"label": "ABCD"[i], "text": q.options[o]} for i, o in enumerate(aq.option_order)],
        },
    )
    return base
