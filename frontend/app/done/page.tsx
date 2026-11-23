"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Done() {
  const r = useSearchParams().get("r");
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <section className="glass max-w-xl p-10 text-center" role="dialog" aria-modal="true" aria-labelledby="t">
        <h1 id="t" className="text-3xl text-navy mb-4">{r === "DISQUALIFIED" ? "Your assessment has ended" : "Thank you"}</h1>
        {r === "DISQUALIFIED" && <p className="mb-3">Your assessment was ended because you left the exam window too many times. Your answers up to that point have been saved.</p>}
        <p>Your responses have been saved and securely logged. The hiring team will review your assessment and get back to you for the next stage if successful. Thank you.</p>
      </section>
    </main>
  );
}
export default function Page() { return <Suspense fallback={null}><Done /></Suspense>; }
