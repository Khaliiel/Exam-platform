# Proctored Assessment Platform

FastAPI + Next.js + Supabase Postgres + Cloudflare R2. Built for ~1,300 candidates in an open exam window.

## What is where
```
backend/app/paper.py        exam engine: random paper builder + server-authoritative timer state machine
backend/app/routers/        auth (ID gate), exam (candidate API), admin (HR console API)
backend/app/tasks.py        Celery: throttled invitation emails (Resend) + 30-day snapshot purge
backend/app/scripts/        create_admin, seed_demo
backend/loadtest/           Locust script
frontend/app/               / (ID gate), /check (camera, consent), /exam, /done, /admin
frontend/lib/useLockdown.ts focus-loss strikes, copy/paste/devtools blocking, fullscreen
frontend/lib/queue.ts       AES-GCM encrypted offline answer queue
```

## Run locally
```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp ../.env.example .env        # for local dev set DATABASE_URL to a local Postgres, ENV=development
python -m app.scripts.create_admin --email you@company.com
python -m app.scripts.seed_demo --candidates 20      # demo questions + batch + IDs in codes.txt
uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```
Open http://localhost:3000, enter a demo ID from `backend/codes.txt`. Admin console: /admin.
Without R2 configured, snapshots are stored under `backend/storage/` (dev only).

## How the rules are enforced
- **Single device:** `/exam/begin` stores a SHA-256 of a random session token. Any other device is refused (409). The same browser resumes via the token in localStorage. Lost token (cleared storage) = admin reset, logged.
- **Timers:** all deadlines live in the database and are evaluated lazily on every request (`advance()`), so a crashed browser or dropped connection cannot extend time. Sections lock themselves; the final state is deterministic.
- **Answer key:** never sent to the browser. Scoring happens server-side at answer time.
- **Randomization:** 5 questions per sub-type, shuffled; option order shuffled; seeded per candidate and stored, so any paper can be reproduced.
- **Strikes:** tab/window focus loss counts once per episode (server de-duplicates within 2 s). Strike 3 = `DISQUALIFIED_TAB_SWITCH`, all sections locked.
- **Offline:** an answer chosen during an outage is kept in an encrypted local queue and accepted on reconnect as a "late sync" if it was made within the question window. The server clock does not pause.
- **Open window:** candidates can start any time between window open and close and get their full time. Starting is refused outside the window.

## Deploy (recommended)
| Piece | Choice | Why |
|---|---|---|
| Frontend | Vercel | CDN, no server to size for the spike |
| API + Redis + workers | One VPS, 4 vCPU / 8 GB, `docker compose up -d` | Predictable under a spike, no cold starts or autoscale lag |
| Database | Supabase **paid** plan, transaction pooler URL (6543) | The free tier will not survive the spike |
| Images | Cloudflare R2 | Browser uploads directly via presigned URL, API never carries image bytes |
| Email | Resend | Sends at 2/s by default: 1,299 invites take about 11 minutes |

Put the VPS and the Supabase project in the same region, as close to Lagos as you can get. Verify current region lists and pricing yourself.

**R2 CORS** (bucket settings): allow origin = your frontend URL, method `PUT`, header `Content-Type`.
**Email DNS:** publish SPF, DKIM and DMARC for the sending domain (Resend shows the records) and send a test to Gmail/Outlook first.

## Before exam day
1. Run the load test against a staging copy: `python -m app.scripts.seed_demo --candidates 1300` then `locust -f loadtest/locustfile.py --host https://staging-api/api -u 1300 -r 50`. Watch DB connections and p95 latency of `/exam/answers`.
2. Run a pilot with 20 real devices (Windows, macOS, Linux; Chrome, Edge, Firefox).
3. Replace demo questions with the real bank via Admin > Question bank > Import.
4. Set a strong `JWT_SECRET`; create admins with `create_admin`.
5. Tell candidates: refreshing the page costs time because the clock is server-side.

## Known limits (read these)
- 25 questions x 15 s = 375 s, but the section ceiling is 300 s. A candidate who uses the full 15 s on every question will only reach question 20. Tune `QUESTION_SECONDS` (12 s fits exactly) or `SECTION_SECONDS`.
- Browser lockdown cannot stop a second device, a phone photo, or a virtual machine. Snapshots exist so a human can review flags.
- Venue Wi-Fi shares one public IP: the login limiter defaults to 60/min per IP. Raise `LOGIN_RATE` if you run an in-person session.
- Admin 2FA is not implemented. Put /admin behind Cloudflare Access or an IP allow-list.
- Not implemented: face detection on snapshots, live invigilator view.
