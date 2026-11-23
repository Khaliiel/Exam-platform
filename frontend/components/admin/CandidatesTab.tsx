"use client";
import { useCallback, useEffect, useState } from "react";
import { adm, download } from "@/lib/adminApi";
import EvidenceDrawer from "./EvidenceDrawer";

const abbr = (n: string) => n.split(/[\s&]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
const mins = (s?: number | null) => (s ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : "-");
const BAND: Record<string, { bg: string; fg: string; label: string }> = {
  PASS: { bg: "rgba(22,163,74,0.14)", fg: "#15803D", label: "Pass" },
  CONSIDER: { bg: "rgba(37,99,235,0.12)", fg: "#1D4ED8", label: "Consider" },
  FAIL: { bg: "rgba(220,38,38,0.12)", fg: "#B91C1C", label: "Fail" },
};

export default function CandidatesTab() {
  const [batches, setBatches] = useState<any[]>([]);
  const [f, setF] = useState({ batch_id: "", status: "", q: "", flagged: false, sort: "score", page: 1 });
  const [data, setData] = useState<any>({ total: 0, items: [] });
  const [stats, setStats] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams({ sort: f.sort, page: String(f.page), limit: "50" });
    if (f.batch_id) p.set("batch_id", f.batch_id); if (f.status) p.set("status", f.status); if (f.q) p.set("q", f.q); if (f.flagged) p.set("flagged", "true");
    try { setData(await adm("/candidates?" + p)); setStats(await adm("/stats")); setErr(""); } catch (e: any) { setErr(e.message); }
  }, [f]);

  useEffect(() => { adm("/batches").then(setBatches).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!live) return; const t = setInterval(load, 10000); return () => clearInterval(t); }, [live, load]);

  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === "page" ? v : 1 }));
  const S = stats?.by_status || {};

  return (
    <div>
      <div className="flex flex-wrap gap-6 mb-5 text-sm">
        {["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "DISQUALIFIED"].map((k) => <div key={k}><span className="text-2xl text-navy tabular-nums">{S[k] || 0}</span> {k.replace("_", " ").toLowerCase()}</div>)}
        <div><span className="text-2xl text-crimson tabular-nums">{stats?.flagged || 0}</span> flagged</div>
      </div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select className="field !w-auto" value={f.batch_id} onChange={(e) => set("batch_id", e.target.value)}><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className="field !w-auto" value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">Any status</option>{["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "DISQUALIFIED"].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="field !w-auto" value={f.sort} onChange={(e) => set("sort", e.target.value)}><option value="score">Sort by score</option><option value="flags">Sort by flags</option><option value="submitted">Latest finished</option><option value="name">Name</option></select>
        <input className="field !w-56" placeholder="Search name, ID, email" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.flagged} onChange={(e) => set("flagged", e.target.checked)} className="accent-[#1B365D]" /> Flagged only</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-[#1B365D]" /> Live refresh</label>
        <button className="btn-ghost !py-2 ml-auto" onClick={load}>Refresh now</button>
        <button className="btn-primary !py-2" onClick={() => download(`/export.xlsx${f.batch_id ? `?batch_id=${f.batch_id}` : ""}`, "score-report.xlsx").catch((e) => setErr(e.message))}>Download Excel report</button>
      </div>
      <div className="flex flex-wrap gap-5 mb-3 text-sm">
        {["PASS", "CONSIDER", "FAIL"].map((k) => <span key={k} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: BAND[k].fg }} />{BAND[k].label}: {k === "PASS" ? "70% and above" : k === "CONSIDER" ? "51% to 69%" : "50% and below"}</span>)}
      </div>
      {(data.section_order || []).length > 0 && <p className="text-sm opacity-75 mb-3">Section columns: {data.section_order.map((s: string) => `${abbr(s)} = ${s}`).join("; ")}</p>}
      {err && <p role="alert" className="text-crimson mb-3">{err}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full text-[0.95rem]">
          <thead><tr className="text-left border-b border-rule"><th className="p-3">#</th><th>Exam ID</th><th>Name</th><th>Status</th>{(data.section_order || []).map((s: string) => <th key={s} title={s}>{abbr(s)}</th>)}<th>Total</th><th>%</th><th>Result</th><th>Time</th><th>Strikes</th><th>Flags</th></tr></thead>
          <tbody>
            {data.items.map((c: any, i: number) => (
              <tr key={c.id} tabIndex={0} onClick={() => setOpen(c.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(c.id)} style={{ background: BAND[c.band]?.bg }} className="border-b border-rule/60 cursor-pointer hover:brightness-95">
                <td className="p-3">{(f.page - 1) * 50 + i + 1}</td><td>{c.exam_id}</td><td>{c.name || "-"}</td>
                <td className={c.status === "DISQUALIFIED" ? "text-crimson" : ""}>{c.status.replace("_", " ").toLowerCase()}</td>
                {(data.section_order || []).map((k: string) => <td key={k} className="tabular-nums">{c.sections[k]?.score ?? "-"}</td>)}
                <td className="tabular-nums text-navy">{c.score}/{c.total_questions || 75}</td>
                <td className="tabular-nums" style={{ color: BAND[c.band]?.fg, fontWeight: 600 }}>{c.percent != null ? `${c.percent}%` : "-"}</td>
                <td>{c.band ? <span className="rounded-full px-3 py-0.5 text-sm" style={{ background: BAND[c.band].bg, color: BAND[c.band].fg }}>{BAND[c.band].label}</span> : "-"}</td>
                <td>{mins(c.duration_sec)}</td>
                <td className={c.violations ? "text-amber" : ""}>{c.violations}</td><td className={c.flags ? "text-crimson" : ""}>{c.flags}</td>
              </tr>
            ))}
            {!data.items.length && <tr><td colSpan={20} className="p-8 text-center opacity-70">No candidates match these filters. Create a batch and generate IDs in "Batches and IDs".</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-4 text-sm">
        <span>{data.total} candidates</span>
        <span className="flex gap-2"><button className="btn-ghost !py-1" disabled={f.page <= 1} onClick={() => set("page", f.page - 1)}>Previous</button><button className="btn-ghost !py-1" disabled={f.page * 50 >= data.total} onClick={() => set("page", f.page + 1)}>Next</button></span>
      </div>
      {open && <EvidenceDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
