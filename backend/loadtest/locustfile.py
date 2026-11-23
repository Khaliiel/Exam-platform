"""Load test:  python -m app.scripts.seed_demo --candidates 1300   (creates codes.txt)
   locust -f loadtest/locustfile.py --host http://localhost:8000/api -u 1300 -r 50
Run against a staging copy, never the production database."""
import random
import time
from queue import Empty, Queue

from locust import HttpUser, between, task

CODES: Queue = Queue()
for line in open("codes.txt").read().split():
    CODES.put(line)


class Candidate(HttpUser):
    wait_time = between(2, 9)

    def on_start(self):
        try:
            code = CODES.get_nowait()
        except Empty:
            self.environment.runner.quit()
            return
        pre = self.client.post("/auth/login", json={"exam_id": code}).json()["pre_token"]
        r = self.client.post("/exam/begin", json={"consent": True}, headers={"Authorization": f"Bearer {pre}"}).json()
        self.h = {"Authorization": f"Bearer {r['session_token']}"}
        self.state = r["state"]

    @task
    def play(self):
        s = self.state
        if s.get("status") != "IN_PROGRESS":
            self.stop()
            return
        if s.get("phase") == "intro":
            time.sleep(s["starts_in_ms"] / 1000)
            self.state = self.client.get("/exam/state", headers=self.h).json()
            return
        item = {"section": s["section"], "pos": s["pos"], "choice": random.randint(0, 3), "elapsed_ms": random.randint(1500, 9000)}
        self.state = self.client.post("/exam/answers", json={"answers": [item]}, headers=self.h, name="/exam/answers").json()
        if random.random() < 0.03:
            self.client.post("/exam/snapshot/presign", json={"trigger": "interval"}, headers=self.h)
