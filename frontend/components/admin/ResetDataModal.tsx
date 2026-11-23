"use client";
import { useState } from "react";
import { adm } from "@/lib/adminApi";

export default function ResetDataModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"results" | "all">("results");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  async function go() {
    setBusy(true); setMsg("");
    try {
      const r = await adm("/data/reset", { method: "POST", body: { password, mode, confirm } });
      setDone(true);
      setMsg(r.mode === "all" ? `Done. ${r.candidates} candidates and all their results were deleted.` : `Done. All results were cleared and ${r.candidates} Exam IDs can be used again.`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2430]/50 p-6" onClick={onClose}>
      <div className="glass w-full max-w-lg p-7" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reset data">
        <h2 className="text-2xl text-crimson mb-1">Reset data</h2>
        <p className="text-sm mb-4 opacity-80">This cannot be undone. Your question bank, batches and admin accounts are never touched.</p>
        {!done && (<>
          <label className="flex gap-3 items-start mb-2 cursor-pointer"><input type="radio" className="mt-2 accent-[#1B365D]" checked={mode === "results"} onChange={() => setMode("results")} />
            <span><b className="font-normal text-navy">Clear all results (refresh)</b><br /><span className="text-sm opacity-80">Wipes every answer, snapshot and log, and sets all candidates back to "not started". Exam IDs stay valid.</span></span></label>
          <label className="flex gap-3 items-start mb-4 cursor-pointer"><input type="radio" className="mt-2 accent-[#1B365D]" checked={mode === "all"} onChange={() => setMode("all")} />
            <span><b className="font-normal text-navy">Delete everything about candidates</b><br /><span className="text-sm opacity-80">Also deletes the candidates and their Exam IDs. Use this to clear test data before going live.</span></span></label>
          <label className="block text-sm mb-1" htmlFor="rp">Your admin password</label>
          <input id="rp" type="password" className="field mb-3" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <label className="block text-sm mb-1" htmlFor="rc">Type RESET to confirm</label>
          <input id="rc" className="field mb-4" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </>)}
        {msg && <p role="status" className={`mb-4 ${done ? "text-navy" : "text-crimson"}`}>{msg}</p>}
        <div className="flex justify-end gap-3">
          <button className="btn-ghost" onClick={() => (done ? window.location.reload() : onClose())}>{done ? "Close" : "Cancel"}</button>
          {!done && <button className="btn-primary !bg-crimson" disabled={busy || !password || confirm.trim().toUpperCase() !== "RESET"} onClick={go}>{busy ? "Working…" : "Reset data"}</button>}
        </div>
      </div>
    </div>
  );
}
