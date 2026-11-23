"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DeviceGate from "@/components/DeviceGate";
import FloatingIcons from "@/components/FloatingIcons";
import { ORG, ApiError, NetworkError, api, pre, session } from "@/lib/api";

function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { const id = params.get("id"); if (id) setCode(id.toUpperCase()); }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api.login(code.trim(), session.get());
      if (r.resume) return router.push("/exam");
      pre.set(r.pre_token);
      sessionStorage.setItem("exam_meta", JSON.stringify({ name: r.name, org: r.org, window_end: r.window_end }));
      router.push("/check");
    } catch (e: any) {
      setErr(e instanceof NetworkError ? "We can't reach the server. Check your internet connection and try again." : e.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="relative min-h-screen grid place-items-center px-6 py-16">
      <FloatingIcons />
      <div className="relative z-10 w-full max-w-xl">
        <h1 className="text-5xl leading-tight mb-3 bg-gradient-to-r from-[#1B365D] to-[#0f766e] bg-clip-text text-transparent">Online Assessment</h1>
        <p className="mb-10 text-lg">{ORG}. Enter the Exam ID from your invitation email to begin.</p>

        <form onSubmit={submit} className="glass overflow-hidden">
          <div className="p-8">
            <label htmlFor="eid" className="block mb-2 text-navy">Exam ID</label>
            <input id="eid" autoFocus autoComplete="off" spellCheck={false} value={code} placeholder="REC26-8492-K7M"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              className="field text-2xl tracking-[0.12em] tabular-nums text-center py-4" />
            {err && <p role="alert" className="mt-3 text-crimson">{err}</p>}
          </div>
          <div className="tear" />
          <div className="p-8 flex items-center justify-between gap-4">
            <p className="text-sm max-w-[16rem]">One attempt, one device. Your ID locks to this browser once you begin.</p>
            <button className="btn-primary" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Continue"}</button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function Page() {
  return <DeviceGate><Suspense fallback={null}><Landing /></Suspense></DeviceGate>;
}
