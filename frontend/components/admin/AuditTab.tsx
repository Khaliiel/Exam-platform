"use client";
import { useEffect, useState } from "react";
import { adm } from "@/lib/adminApi";

const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos" });

export default function AuditTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [type, setType] = useState("");
  useEffect(() => { adm("/events" + (type ? `?type=${type}` : "")).then(setEvents).catch(() => {}); }, [type]);
  useEffect(() => { adm("/audit").then(setLogs).catch(() => {}); }, []);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="glass p-5">
        <div className="flex justify-between mb-3"><h2 className="text-xl text-navy">Candidate flags</h2>
          <select className="field !w-auto !py-1" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{["TAB_SWITCH", "DISQUALIFIED_TAB_SWITCH", "FULLSCREEN_EXIT", "CAMERA_LOST", "COPY_ATTEMPT", "PASTE_ATTEMPT", "DEVTOOLS_KEY", "CONTEXT_MENU"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <ul className="text-sm divide-y divide-rule/70 max-h-[60vh] overflow-y-auto">
          {events.map((e, i) => <li key={i} className="py-1.5"><span className="opacity-60">{fmt(e.at)}</span> {e.exam_id} {e.name && `(${e.name})`} <span className="text-crimson">{e.type}</span></li>)}
          {!events.length && <li className="py-4 opacity-70">No flags recorded.</li>}
        </ul>
      </section>
      <section className="glass p-5">
        <h2 className="text-xl text-navy mb-3">Admin actions</h2>
        <ul className="text-sm divide-y divide-rule/70 max-h-[60vh] overflow-y-auto">
          {logs.map((l, i) => <li key={i} className="py-1.5"><span className="opacity-60">{fmt(l.at)}</span> {l.admin} <b className="font-normal text-navy">{l.action}</b> <span className="opacity-70">{l.detail ? JSON.stringify(l.detail) : ""}</span></li>)}
          {!logs.length && <li className="py-4 opacity-70">No admin actions yet.</li>}
        </ul>
      </section>
    </div>
  );
}
