"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminToken } from "@/lib/adminApi";
import CandidatesTab from "@/components/admin/CandidatesTab";
import QuestionsTab from "@/components/admin/QuestionsTab";
import BatchesTab from "@/components/admin/BatchesTab";
import AuditTab from "@/components/admin/AuditTab";
import ResetDataModal from "@/components/admin/ResetDataModal";

const TABS = [["candidates", "Leaderboard"], ["questions", "Question bank"], ["batches", "Batches and IDs"], ["audit", "Audit logs"]] as const;

export default function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<string>("candidates");
  const [ready, setReady] = useState(false);
  const [showReset, setShowReset] = useState(false);
  useEffect(() => { if (!adminToken.get()) router.replace("/admin"); else setReady(true); }, [router]);
  if (!ready) return null;
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl text-navy">Recruitment console</h1>
        <div className="flex gap-3"><button className="btn-ghost !py-1.5 !text-crimson !border-crimson/40" onClick={() => setShowReset(true)}>Reset data</button><button className="btn-ghost !py-1.5" onClick={() => { adminToken.clear(); router.push("/admin"); }}>Sign out</button></div>
      </header>
      <nav className="flex gap-1 mb-6 border-b border-rule" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-5 py-2 -mb-px border-b-2 ${tab === k ? "border-navy text-navy" : "border-transparent opacity-70 hover:opacity-100"}`}>{label}</button>
        ))}
      </nav>
      {tab === "candidates" && <CandidatesTab />}
      {tab === "questions" && <QuestionsTab />}
      {tab === "batches" && <BatchesTab />}
      {tab === "audit" && <AuditTab />}
      {showReset && <ResetDataModal onClose={() => setShowReset(false)} />}
    </main>
  );
}
