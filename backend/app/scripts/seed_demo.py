"""python -m app.scripts.seed_demo --candidates 20
Creates 375 clearly-labelled DEMO questions (5 sub-types x 25 x 3 sections), a batch open for 24h and N candidates.
Replace with the real bank via the admin importer before the exam."""
import argparse
import asyncio
import random
from datetime import timedelta

from ..db import Base, SessionLocal, engine
from ..ids import make_code
from ..models import SECTIONS, Batch, Candidate, Question
from ..paper import utcnow

SUBTYPES = {
    "CURRENT_AFFAIRS": ["national", "international", "economy", "science-tech", "sports-culture"],
    "LOGIC_MATHS": ["series", "arithmetic", "syllogism", "data-interpretation", "puzzles"],
    "ENGLISH": ["grammar", "vocabulary", "comprehension", "error-spotting", "sentence-order"],
}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=20)
    n = ap.parse_args().candidates
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        for sec in SECTIONS:
            for st in SUBTYPES[sec]:
                for i in range(1, 26):
                    a, b = random.randint(2, 40), random.randint(2, 40)
                    opts = [str(a + b), str(a + b + 1), str(a + b - 2), str(a + b + 5)]
                    db.add(Question(section=sec, subtype=st, text=f"[DEMO {sec}/{st} #{i}] What is {a} + {b}?", options=opts, correct=0))
        now = utcnow()
        batch = Batch(name="Demo batch", window_start=now - timedelta(minutes=5), window_end=now + timedelta(hours=24))
        db.add(batch)
        await db.flush()
        codes = []
        for i in range(n):
            code = make_code("DEMO")
            codes.append(code)
            db.add(Candidate(code=code, name=f"Demo Candidate {i + 1}", batch_id=batch.id))
        await db.commit()
    open("codes.txt", "w").write("\n".join(codes))
    print(f"Seeded 375 questions, batch and {n} candidates. IDs written to codes.txt")


asyncio.run(main())
