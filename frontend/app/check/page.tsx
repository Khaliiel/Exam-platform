"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DeviceGate from "@/components/DeviceGate";
import FloatingIcons from "@/components/FloatingIcons";
import { API, ApiError, NetworkError, api, pre, session } from "@/lib/api";
import { startCamera } from "@/lib/media";

function Check() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState("");
  const [cam, setCam] = useState<"idle" | "ok" | "denied">("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fsOk = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

  useEffect(() => {
    if (!pre.get()) { router.replace("/"); return; }
    try { setName(JSON.parse(sessionStorage.getItem("exam_meta") || "{}").name || ""); } catch {}
    (async () => {
      const times: number[] = [];
      try { for (let i = 0; i < 3; i++) { const t = performance.now(); await fetch(API + "/health", { cache: "no-store" }); times.push(performance.now() - t); } setLatency(Math.round(Math.min(...times))); }
      catch { setLatency(-1); }
    })();
  }, [router]);

  async function enableCamera() {
    try { const s = await startCamera(); if (video.current) video.current.srcObject = s; setCam("ok"); } catch { setCam("denied"); }
  }

  async function begin() {
    setErr(""); setBusy(true);
    try { await document.documentElement.requestFullscreen(); } catch {}      // must run inside the click
    try {
      const r = await api.begin(pre.get()!, { consent: true, screen: { w: screen.width, h: screen.height } });
      session.set(r.session_token); pre.clear();
      router.push("/exam");
    } catch (e: any) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setErr(e instanceof NetworkError ? "We can't reach the server. Check your connection and try again." : e instanceof ApiError ? e.message : "Could not start the exam.");
      setBusy(false);
    }
  }

  const netOk = latency !== null && latency >= 0 && latency < 1500;
  const ready = cam === "ok" && netOk && consent && fsOk;
  const Row = ({ ok, label, note }: { ok: boolean | null; label: string; note?: string }) => (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-1 inline-block h-3 w-3 rounded-full ${ok === null ? "bg-rule" : ok ? "bg-navy" : "bg-crimson"}`} aria-hidden />
      <span>{label}{note && <span className="block text-sm opacity-70">{note}</span>}</span>
    </li>
  );

  return (
    <main className="relative min-h-screen px-6 py-14">
      <FloatingIcons />
      <div className="relative z-10 mx-auto max-w-4xl grid md:grid-cols-[1fr_20rem] gap-8">
        <section className="glass p-8">
          <h1 className="text-3xl text-navy mb-1">{name ? `Welcome, ${name}` : "Before you begin"}</h1>
          <p className="mb-5">The assessment is made up of several timed sections. Each question has a time limit and each section has a strict ceiling. The clock is kept by the server and cannot be paused.</p>
          <ul className="mb-5 list-disc pl-5 space-y-1 text-[0.97rem]">
            <li>The exam runs in full screen. Leaving the exam window three times ends your attempt automatically.</li>
            <li>Copying, pasting, right-clicking and developer tools are disabled.</li>
            <li>Your webcam captures periodic snapshots for review by the hiring team.</li>
            <li>You will not see your score when you finish.</li>
          </ul>
          <ul className="divide-y divide-rule mb-5">
            <Row ok={cam === "idle" ? null : cam === "ok"} label="Webcam" note={cam === "denied" ? "Permission was blocked. Allow camera access in your browser's address bar and try again." : undefined} />
            <Row ok={latency === null ? null : netOk} label="Connection" note={latency === null ? "Testing…" : latency < 0 ? "Cannot reach the server" : `${latency} ms to server`} />
            <Row ok={fsOk} label="Full-screen support" />
          </ul>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-2 h-4 w-4 accent-[#1B365D]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-[0.97rem]">I consent to being monitored by webcam snapshots and activity logging during this assessment. Images are used only for integrity review and are deleted 30 days after the exam batch closes.</span>
          </label>
          {err && <p role="alert" className="mt-4 text-crimson">{err}</p>}
          <div className="mt-6 flex justify-end"><button className="btn-primary" disabled={!ready || busy} onClick={begin}>{busy ? "Starting…" : "Begin exam"}</button></div>
        </section>

        <aside className="glass p-5 h-fit">
          <div className="aspect-[4/3] rounded-lg bg-[#ece8de] overflow-hidden grid place-items-center">
            <video ref={video} autoPlay muted playsInline className="h-full w-full object-cover -scale-x-100" />
            {cam !== "ok" && <span className="absolute text-sm opacity-60">Camera preview</span>}
          </div>
          <button className="btn-ghost w-full mt-4" onClick={enableCamera}>{cam === "ok" ? "Camera on" : "Turn on camera"}</button>
          <p className="text-sm mt-3 opacity-80">Sit in a well-lit spot with your face clearly visible.</p>
        </aside>
      </div>
    </main>
  );
}

export default function Page() { return <DeviceGate><Check /></DeviceGate>; }
