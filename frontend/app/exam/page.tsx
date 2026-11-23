"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DeviceGate from "@/components/DeviceGate";
import TimerRing from "@/components/TimerRing";
import IntegrityScene from "@/components/IntegrityScene";
import * as sound from "@/lib/sound";
import { ApiError, NetworkError, api, session } from "@/lib/api";
import { clearQueue, loadQueue, saveQueue } from "@/lib/queue";
import { captureJpeg, getStream, startCamera } from "@/lib/media";
import { useLockdown } from "@/lib/useLockdown";

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIRST_NOTE = "Welcome. Before you begin, a reminder. Exam malpractice is a serious offence. Using unfair means to pass a job exam puts your career and your reputation at risk, and this session is monitored. Do your best, honestly. When you are ready, press Start.";
const NEXT_NOTE = "Section complete. Take a breath. Remember, malpractice can cost you the job and more, and this assessment is monitored. When you are ready, press Proceed to continue.";

function Exam() {
  const router = useRouter();
  const tok = useRef("");
  const [s, setS] = useState<any>(null);
  const [clock, setClock] = useState({ q: 0, sec: 0, intro: 0, ready: 0 });
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [fsLost, setFsLost] = useState(false);
  const [warn, setWarn] = useState<number | null>(null);
  const [camLost, setCamLost] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const queue = useRef<any[]>([]);
  const flushing = useRef(false);
  const shownAt = useRef(Date.now());
  const qKey = useRef("");
  const violations = useRef(0);
  const video = useRef<HTMLVideoElement>(null);

  const finish = useCallback((status: string) => {
    clearQueue(); session.clear();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.replace("/done?r=" + status);
  }, [router]);

  // Applies a server state. Deadlines are converted to the local clock using the response time.
  const apply = useCallback((st: any) => {
    if (st.status && st.status !== "IN_PROGRESS") return finish(st.status);
    const t = Date.now();
    setClock({ q: t + (st.q_remaining_ms ?? 0), sec: t + (st.section_remaining_ms ?? 0), intro: t + (st.starts_in_ms ?? 0), ready: t + (st.auto_start_in_ms ?? 0) });
    violations.current = st.violations ?? 0;
    const key = `${st.section}:${st.phase}:${st.pos}`;
    if (key !== qKey.current) { qKey.current = key; shownAt.current = t; setSelected(st.already_selected ?? null); setConfirmFinish(false); }
    setS(st);
  }, [finish]);

  const refresh = useCallback(async () => {
    try { apply(await api.state(tok.current)); setOffline(false); }
    catch (e: any) {
      if (e instanceof NetworkError) { setOffline(true); setTimeout(refresh, 2500); }
      else if (e instanceof ApiError && e.status === 401) { session.clear(); router.replace("/"); }
    }
  }, [apply, router]);

  // Sends queued answers; on network failure keeps them (encrypted in localStorage) and retries.
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const batch = [...queue.current];
        try {
          const st = await api.answers(tok.current, batch);
          queue.current = queue.current.filter((x) => !batch.includes(x));
          saveQueue(tok.current, queue.current);
          setOffline(false); apply(st);
        } catch (e: any) {
          if (e instanceof NetworkError) { setOffline(true); setTimeout(flush, 2500); return; }
          queue.current = queue.current.filter((x) => !batch.includes(x));
          saveQueue(tok.current, queue.current);
          if (e instanceof ApiError && e.status === 401) { session.clear(); router.replace("/"); return; }
          refresh();
        }
      }
    } finally { flushing.current = false; }
  }, [apply, refresh, router]);

  // ---- snapshots ----
  const snap = useCallback(async (trigger: string) => {
    const v = video.current;
    if (!v || !tok.current) return;
    try {
      const blob = await captureJpeg(v);
      if (!blob) return;
      const p = await api.presign(tok.current, trigger);
      if (p.skip) return;
      if (p.mode === "r2") await fetch(p.url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      else { const fd = new FormData(); fd.append("key", p.key); fd.append("file", blob, "s.jpg"); await api.direct(tok.current, fd); }
    } catch {}
  }, []);

  // ---- proctoring events ----
  const send = useCallback(async (type: string, detail: any, tries = 0): Promise<void> => {
    try {
      const r = await api.event(tok.current, type, detail);
      if (r.status && r.status !== "IN_PROGRESS") return finish(r.status);
      if (type === "TAB_SWITCH" && typeof r.violations === "number") { violations.current = r.violations; setWarn(r.violations); }
    } catch (e) {
      if (e instanceof NetworkError && tries < 6) { await sleep(3000); return send(type, detail, tries + 1); }
    }
  }, [finish]);

  const report = useCallback((type: string, detail?: any) => {
    if (!tok.current) return;
    if (type === "TAB_SWITCH") { violations.current += 1; setWarn(violations.current); snap("tab_switch"); }
    if (type === "FULLSCREEN_EXIT") setFsLost(true);
    send(type, detail);
  }, [send, snap]);

  useLockdown(!!s && camReady, report);

  // ---- boot ----
  useEffect(() => {
    const t = session.get();
    if (!t) { router.replace("/"); return; }
    tok.current = t;
    loadQueue(t).then((q) => { queue.current = q; q.length ? flush() : refresh(); });
    startCamera()
      .then((st) => {
        if (video.current) video.current.srcObject = st;
        st.getVideoTracks()[0].addEventListener("ended", () => { setCamLost(true); send("CAMERA_LOST", {}); });
      })
      .catch(() => { setCamLost(true); send("CAMERA_LOST", { reason: "denied" }); })
      .finally(() => setCamReady(true));
    setFsLost(!document.fullscreenElement);
    const iv = setInterval(() => setNow(Date.now()), 200);
    const onOnline = () => flush();
    const onFs = () => setFsLost(!document.fullscreenElement);
    window.addEventListener("online", onOnline);
    document.addEventListener("fullscreenchange", onFs);
    return () => { clearInterval(iv); window.removeEventListener("online", onOnline); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  // periodic snapshots every 30-45 s while the exam is running
  useEffect(() => {
    if (!s || s.status !== "IN_PROGRESS" || !camReady) return;
    let stop = false;
    (async () => { await sleep(4000); while (!stop) { await snap("interval"); await sleep(30000 + Math.random() * 15000); } })();
    return () => { stop = true; };
  }, [!!s, camReady]);

  // server decides when a question/section ends: ask for the new state right after the earliest deadline
  useEffect(() => {
    if (!s || s.status !== "IN_PROGRESS") return;
    const target = s.phase === "intro" ? clock.intro : s.phase === "ready" ? clock.ready : Math.min(clock.q, clock.sec);
    const id = setTimeout(refresh, Math.max(0, target - Date.now()) + 350);
    return () => clearTimeout(id);
  }, [s, clock]);

  useEffect(() => { setSoundOn(sound.enabled()); }, []);
  // spoken reminder + soft music only on the waiting screens, never while questions are on screen
  useEffect(() => {
    if (!s || s.phase !== "ready") return;
    sound.start(s.first ? FIRST_NOTE : NEXT_NOTE);
    return () => sound.stop();
  }, [s?.phase, s?.section]);
  // animated background on waiting screens, still background while a question is showing
  useEffect(() => {
    document.body.classList.toggle("calm", !!s && s.phase !== "ready");
    return () => document.body.classList.remove("calm");
  }, [s?.phase]);

  async function proceed() {
    if (busy) return;
    setBusy(true);
    sound.chime(); sound.stop();
    try { apply(await api.startSection(tok.current)); setOffline(false); }
    catch (e: any) { if (e instanceof NetworkError) setOffline(true); refresh(); }
    finally { setBusy(false); }
  }
  function toggleSound() { const on = !soundOn; setSoundOn(on); sound.setEnabled(on); if (on && s?.phase === "ready") sound.start(s.first ? FIRST_NOTE : NEXT_NOTE); }

  function choose(i: number) {
    if (selected !== null || !s || s.phase !== "question") return;
    setSelected(i);
    queue.current.push({ section: s.section, pos: s.pos, choice: i, elapsed_ms: Date.now() - shownAt.current });
    saveQueue(tok.current, queue.current);
    flush();
  }

  async function submitSection() {
    setConfirmFinish(false);
    try { apply(await api.submitSection(tok.current)); } catch { refresh(); }
  }

  async function backToExam() {
    try { await document.documentElement.requestFullscreen(); } catch {}
    setWarn(null);
  }
  async function retryCamera() {
    try { const st = await startCamera(); if (video.current) video.current.srcObject = st; setCamLost(false); send("CAMERA_RESTORED", {}); } catch {}
  }

  if (!s) return <main className="min-h-screen grid place-items-center">Loading your exam…</main>;

  const qLeft = clock.q - now, secLeft = clock.sec - now, introLeft = clock.intro - now;
  const secColor = secLeft <= 20000 ? "text-crimson" : secLeft <= 60000 ? "text-amber" : "text-navy";
  const max = s.max_violations || 3;
  const blocking = fsLost || camLost;

  return (
    <main className="min-h-screen px-6 pb-16">
      {offline && <div role="status" className="fixed top-0 inset-x-0 z-40 bg-amber text-white text-center py-2">Connection lost. Your answers are saved on this device and will sync automatically. The exam clock keeps running on the server.</div>}

      <header className="glass mx-auto mt-6 max-w-4xl px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-navy">{s.section_label}</div>
          <div className="text-sm opacity-70">Section {s.section_index + 1} of {s.section_count}{s.phase === "question" && <> &nbsp;|&nbsp; Question {s.pos + 1} of {s.n}</>}</div>
        </div>
        {s.phase === "question" && <div className={`text-2xl tabular-nums ${secColor}`} aria-label="Section time remaining">{mmss(secLeft)}</div>}
      </header>

      {s.phase === "ready" && <Ready s={s} left={clock.ready - now} busy={busy} soundOn={soundOn} onProceed={proceed} onToggleSound={toggleSound} />}

      {s.phase === "intro" && (
        <section className="glass mx-auto mt-10 max-w-2xl p-12 text-center">
          <h1 className="text-3xl text-navy mb-3">{s.section_label}</h1>
          <p className="mb-6">{s.section_index === 0 ? "Your exam starts in" : "Next section starts in"}</p>
          <div className="text-6xl text-navy tabular-nums">{Math.max(0, Math.ceil(introLeft / 1000))}</div>
          <p className="mt-6 text-sm opacity-75">{s.question_seconds} seconds per question. {Math.round(s.section_seconds / 60)} minutes maximum for this section. Answers are saved as you choose them.</p>
        </section>
      )}

      {s.phase === "question" && (
        <section key={qKey.current} className="glass mx-auto mt-8 max-w-4xl p-8 md:p-10">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-[40rem]">
              {s.question.passage && <blockquote className="mb-5 border-l-2 border-navy/30 pl-4 italic whitespace-pre-line">{s.question.passage}</blockquote>}
              <h2 className="text-2xl leading-snug">{s.question.text}</h2>
              {s.question.image && <img src={s.question.image} alt="Diagram for this question" className="mt-5 max-h-72 w-auto max-w-full rounded-lg border border-rule bg-white" />}
            </div>
            <TimerRing remainingMs={qLeft} totalMs={s.question_seconds * 1000} />
          </div>
          <div role="radiogroup" className="mt-8 grid gap-3">
            {s.question.options.map((o: any, i: number) => (
              <button key={i} role="radio" aria-checked={selected === i} disabled={selected !== null || blocking || !!warn}
                onClick={() => choose(i)}
                className={`flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy
                  ${selected === i ? "border-navy bg-navy text-white" : "border-rule bg-white hover:border-navy/60 disabled:hover:border-rule"} disabled:cursor-default`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${selected === i ? "border-white/70" : "border-navy/30 text-navy"}`}>{o.label}</span>
                <span>{o.text}</span>
              </button>
            ))}
          </div>
          <div className="mt-8 flex justify-between items-center text-sm opacity-80">
            <span>{selected !== null ? "Answer saved" : "Choose one answer"}</span>
            {confirmFinish
              ? <span className="flex gap-2 items-center">End this section now?
                  <button className="btn-primary !py-1 !px-4" onClick={submitSection}>Yes, submit</button>
                  <button className="btn-ghost !py-1 !px-4" onClick={() => setConfirmFinish(false)}>Keep going</button></span>
              : <button className="btn-ghost !py-1 !px-4" onClick={() => setConfirmFinish(true)}>Submit section</button>}
          </div>
        </section>
      )}

      <div className="fixed bottom-5 left-5 z-30 glass p-1.5 flex items-center gap-2">
        <video ref={video} autoPlay muted playsInline className="h-14 w-20 rounded-md object-cover -scale-x-100 bg-[#ece8de]" />
        <span className="mr-2 flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full bg-crimson animate-pulse" aria-hidden />Recording</span>
      </div>

      {warn !== null && warn > 0 && warn < max && !blocking && (
        <Overlay>
          <h2 className="text-3xl text-crimson mb-3">Warning {warn} of {max - 1}</h2>
          <p className="mb-6">You left the exam window. Do it {max - warn === 1 ? "once more" : `${max - warn} more times`} and your assessment will end immediately. The clock did not stop.</p>
          <button className="btn-primary" onClick={backToExam}>Return to exam</button>
        </Overlay>
      )}
      {fsLost && !camLost && (warn === null || warn >= max || warn === 0) && (
        <Overlay>
          <h2 className="text-3xl text-navy mb-3">Return to full screen</h2>
          <p className="mb-6">The exam must stay in full screen. The clock is still running.</p>
          <button className="btn-primary" onClick={backToExam}>Enter full screen</button>
        </Overlay>
      )}
      {camLost && (
        <Overlay>
          <h2 className="text-3xl text-crimson mb-3">Camera not detected</h2>
          <p className="mb-6">Reconnect or allow your camera to continue. The clock is still running.</p>
          <button className="btn-primary" onClick={retryCamera}>Turn camera on</button>
        </Overlay>
      )}
    </main>
  );
}

function Ready({ s, left, busy, soundOn, onProceed, onToggleSound }: any) {
  const mins = Math.round(s.section_seconds / 60);
  const n = s.section_index + 1;
  return (
    <section className="mx-auto mt-8 grid max-w-5xl gap-6 md:grid-cols-[1.05fr_1fr]">
      <div className="glass flex items-center justify-center p-6"><div className="w-full"><IntegrityScene /></div></div>
      <div className="glass flex flex-col p-8">
        {!s.first && (
          <div className="mb-5 flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: "rgba(22,163,74,0.12)" }}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: "#15803D" }} aria-hidden>✓</span>
            <div><div style={{ color: "#15803D" }}>{s.prev_label}: {s.prev_reason === "TIMEOUT" ? "time is up" : "complete"}</div><div className="text-sm opacity-80">Your answers are saved. You cannot go back to it.</div></div>
          </div>
        )}
        <div className="text-sm opacity-70">Section {n} of {s.section_count}</div>
        <h1 className="mb-2 text-3xl text-navy">{s.section_label}</h1>
        <p className="mb-3">{s.n} questions. {s.question_seconds} seconds for each question, and no more than {mins} minutes for the whole section.</p>
        <p className="mb-4 text-[0.97rem] opacity-90">The clock starts when you press the button and cannot be paused. Stay in full screen and keep this window in front.</p>
        <div className="mt-auto pt-2">
          <button className="btn-primary w-full !py-3 text-lg" onClick={onProceed} disabled={busy}>{busy ? "Starting…" : s.first ? `Start Section ${n}` : `Proceed to Section ${n}`}</button>
          <p className="mt-3 text-center text-sm opacity-80">Take a moment if you need one. If you do not press the button, this section starts by itself in {mmss(left)}.</p>
          <button onClick={onToggleSound} aria-pressed={soundOn} className="mx-auto mt-3 block text-sm text-navy underline">{soundOn ? "Sound is on. Mute" : "Sound is off. Turn on"}</button>
        </div>
      </div>
    </section>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2430]/55 px-6" style={{ backdropFilter: "blur(6px)" }} role="alertdialog" aria-modal="true">
      <div className="glass max-w-lg p-10 text-center">{children}</div>
    </div>
  );
}

export default function Page() { return <DeviceGate><Exam /></DeviceGate>; }
