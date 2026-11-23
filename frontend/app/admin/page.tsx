"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adm, adminToken } from "@/lib/adminApi";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await adm("/login", { method: "POST", body: { email, password } }); adminToken.set(r.token); router.push("/admin/dashboard"); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <form onSubmit={submit} className="glass w-full max-w-md p-8">
        <h1 className="text-3xl text-navy mb-6">Recruitment console</h1>
        <label className="block mb-1" htmlFor="e">Email</label>
        <input id="e" type="email" className="field mb-4" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label className="block mb-1" htmlFor="p">Password</label>
        <input id="p" type="password" className="field mb-4" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <p role="alert" className="text-crimson mb-3">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
