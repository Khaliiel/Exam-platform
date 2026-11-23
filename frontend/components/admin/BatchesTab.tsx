"use client";
import { useCallback, useEffect, useState } from "react";
import { adm, download } from "@/lib/adminApi";

// datetime-local has no zone; interpret entries as Lagos time (WAT, UTC+1)
const toIso = (v: string) => (v ? `${v}:00+01:00` : "");
const show = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

export default function BatchesTab() {
  const [batches, setBatches] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", start: "", end: "" });
  const [gen, setGen] = useState<Record<number, { count: string; prefix: string }>>({});
  const [created, setCreated] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => adm("/batches").then(setBatches).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createBatch() {
    try { await adm("/batches", { method: "POST", body: { name: form.name, window_start: toIso(form.start), window_end: toIso(form.end) } }); setForm({ name: "", start: "", end: "" }); setMsg("Batch created."); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function generate(id: number) {
    const g = gen[id] || { count: "", prefix: "REC26" };
    try { const r = await adm("/candidates/generate", { method: "POST", body: { batch_id: id, count: Number(g.count), prefix: g.prefix.toUpperCase() } }); setCreated(r.created); setMsg(`Generated ${r.created.length} IDs.`); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function importCsv(id: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file); fd.append("batch_id", String(id)); fd.append("prefix", (gen[id]?.prefix || "REC26").toUpperCase());
    try { const r = await adm("/candidates/import", { method: "POST", body: fd }); setCreated(r.created); setMsg(`Imported ${r.created.length} candidates with new IDs.`); load(); }
    catch (e: any) { setMsg(e.message); } e.target.value = "";
  }
  async function invites(id: number) {
    if (!confirm("Send invitation emails to every candidate in this batch who has not been emailed yet?")) return;
    try { const r = await adm(`/batches/${id}/invites`, { method: "POST" }); setMsg(`${r.queued} emails queued. They send at a throttled rate, so allow several minutes.`); }
    catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="grid lg:grid-cols-[22rem_1fr] gap-6">
      <section className="glass p-6 h-fit">
        <h2 className="text-xl text-navy mb-3">New batch</h2>
        <input className="field mb-3" placeholder="Batch name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="text-sm">Window opens (Lagos time)</label>
        <input type="datetime-local" className="field mb-3" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <label className="text-sm">Window closes (Lagos time)</label>
        <input type="datetime-local" className="field mb-4" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <button className="btn-primary w-full" disabled={!form.name || !form.start || !form.end} onClick={createBatch}>Create batch</button>
        <p className="text-sm opacity-70 mt-3">Candidates can start any time inside the window and receive their full time once they begin.</p>
      </section>

      <section>
        {msg && <p role="status" className="mb-3">{msg}</p>}
        {batches.map((b) => (
          <article key={b.id} className="glass p-6 mb-4">
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <div><h3 className="text-xl text-navy">{b.name}</h3><p className="text-sm opacity-75">{show(b.window_start)} to {show(b.window_end)} | {b.candidates} candidates{b.snapshots_purged ? " | snapshots purged" : ""}</p></div>
              <div className="flex gap-2"><button className="btn-ghost !py-1.5" onClick={() => download(`/batches/${b.id}/ids.csv`, `batch-${b.id}-ids.csv`)}>Download IDs</button><button className="btn-ghost !py-1.5" onClick={() => invites(b.id)}>Send invitations</button></div>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <input className="field !w-28" placeholder="Count" inputMode="numeric" value={gen[b.id]?.count || ""} onChange={(e) => setGen({ ...gen, [b.id]: { prefix: "REC26", ...gen[b.id], count: e.target.value.replace(/\D/g, "") } })} />
              <input className="field !w-32" placeholder="Prefix" value={gen[b.id]?.prefix ?? "REC26"} onChange={(e) => setGen({ ...gen, [b.id]: { count: "", ...gen[b.id], prefix: e.target.value.toUpperCase() } })} />
              <button className="btn-primary !py-2" disabled={!gen[b.id]?.count} onClick={() => generate(b.id)}>Generate IDs</button>
              <label className="btn-ghost cursor-pointer !py-2">Import name,email CSV<input type="file" accept=".csv" hidden onChange={(e) => importCsv(b.id, e)} /></label>
            </div>
          </article>
        ))}
        {!batches.length && <p className="opacity-70">No batches yet. Create one to begin.</p>}
        {created.length > 0 && (
          <article className="glass p-6"><h3 className="text-xl text-navy mb-2">Just created</h3>
            <p className="text-sm opacity-75 mb-2">Use "Download IDs" above for the full list. First 50 shown.</p>
            <div className="grid sm:grid-cols-2 gap-x-8 text-[0.95rem] tabular-nums">{created.slice(0, 50).map((c) => <div key={c.exam_id}>{c.exam_id} {c.name && <span className="opacity-60">{c.name}</span>}</div>)}</div>
          </article>)}
      </section>
    </div>
  );
}
