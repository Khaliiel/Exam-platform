"use client";
import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { adm, adminToken } from "@/lib/adminApi";

const fmt = (d?: string) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "-");

export default function EvidenceDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<"snaps" | "events" | "answers">("snaps");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { adm(`/candidates/${id}`).then(setD).catch((e) => setMsg(e.message)); }, [id]);

  async function reset() {
    if (reason.trim().length < 5) return setMsg("Give a reason (5+ characters). It is written to the audit log.");
    if (!confirm("Reset this candidate? Their answers will be deleted and the ID can be used again.")) return;
    try { await adm(`/candidates/${id}/reset`, { method: "POST", body: { reason } }); setMsg("Reset done."); onChanged(); onClose(); }
    catch (e: any) { setMsg(e.message); }
  }

  const c = d?.candidate;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#1c2430]/40" onClick={onClose}>
      <aside className="glass h-full w-full max-w-3xl overflow-y-auto rounded-none p-7" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Candidate evidence">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl text-navy">{c?.name || c?.exam_id || "Loading…"}</h2>
            {c && <p className="text-sm opacity-75">{c.exam_id} | {c.email || "no email"} | {c.status}{c.reason ? ` (${c.reason})` : ""}</p>}
          </div>
          <button className="btn-ghost !py-1" onClick={onClose}>Close</button>
        </div>
        {!d && <p>{msg || "Loading…"}</p>}
        {d && (<>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-5">
            <dt>Started</dt><dd>{fmt(c.started_at)}</dd><dt>Finished</dt><dd>{fmt(c.submitted_at)}</dd>
            <dt>Consent logged</dt><dd>{fmt(c.consent_at)}</dd><dt>Tab-switch strikes</dt><dd>{c.violations}</dd>
            <dt>IP</dt><dd>{c.ip || "-"}</dd><dt>Browser</dt><dd className="truncate" title={c.user_agent}>{c.user_agent || "-"}</dd>
          </dl>
          <div className="flex gap-1 mb-4 border-b border-rule">
            {([["snaps", `Snapshots (${d.snapshots.length})`], ["events", `Events (${d.events.length})`], ["answers", `Answer audit (${d.answers.length})`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 -mb-px border-b-2 ${tab === k ? "border-navy text-navy" : "border-transparent opacity-70"}`}>{l}</button>
            ))}
          </div>

          {tab === "snaps" && (d.snapshots.length ? (
            <div className="grid grid-cols-3 gap-3">
              {d.snapshots.map((s: any) => (
                <figure key={s.id}>
                  <img loading="lazy" alt={`Snapshot at ${fmt(s.at)}`} className="w-full rounded-md bg-[#ece8de] aspect-[4/3] object-cover"
                    src={s.url || `${API}/admin/snapshots/${s.id}/file?token=${adminToken.get()}`} />
                  <figcaption className="text-xs mt-1">{fmt(s.at)}{s.trigger !== "interval" && <span className="text-crimson"> | {s.trigger}</span>}</figcaption>
                </figure>
              ))}
            </div>
          ) : <p>No snapshots (purged or none captured).</p>)}

          {tab === "events" && (
            <table className="w-full text-sm"><tbody>
              {d.events.map((e: any, i: number) => (
                <tr key={i} className="border-b border-rule/70"><td className="py-1.5 pr-3 whitespace-nowrap">{fmt(e.at)}</td>
                  <td className={`pr-3 ${["TAB_SWITCH", "DISQUALIFIED_TAB_SWITCH", "CAMERA_LOST"].includes(e.type) ? "text-crimson" : ""}`}>{e.type}</td>
                  <td className="opacity-70 truncate max-w-[16rem]">{e.detail ? JSON.stringify(e.detail) : ""}</td></tr>
              ))}
            </tbody></table>
          )}

          {tab === "answers" && (
            <ol className="space-y-3">
              {d.answers.map((a: any, i: number) => (
                <li key={i} className="text-sm border-b border-rule/70 pb-2">
                  <div className="opacity-60">{a.section.replace("_", " ")} #{a.pos + 1} {a.late_sync && <span className="text-amber">(synced late)</span>} {a.elapsed_ms != null && `| ${(a.elapsed_ms / 1000).toFixed(1)}s`}</div>
                  <div>{a.text}</div>
                  <div className={a.selected == null ? "opacity-60" : a.is_correct ? "text-navy" : "text-crimson"}>
                    {a.selected == null ? "Not answered" : `Chose ${"ABCD"[a.selected]}: ${a.options[a.selected]}`}
                    {a.selected != null && !a.is_correct && <span className="text-ink"> | Correct: {"ABCD"[a.correct_slot]}: {a.options[a.correct_slot]}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-8 pt-5 border-t border-rule">
            <h3 className="text-lg text-navy mb-2">Reset after a technical failure</h3>
            <input className="field mb-2" placeholder="Reason (written to the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn-ghost" onClick={reset}>Reset this Exam ID</button>
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        </>)}
      </aside>
    </div>
  );
}
