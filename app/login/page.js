"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [setup, setSetup] = useState(false); // first time: team password, then their own
  const [team, setTeam] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    if (setup && pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true); setErr("");
    const body = setup ? { email, teamPassword: team, newPassword: pw } : { email, password: pw };
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { const next = new URLSearchParams(window.location.search).get("next") || ""; router.push(next.startsWith("/") && !next.startsWith("//") ? next : "/?tab=leads"); router.refresh(); return; }
    if (j.needsSetup) { setSetup(true); setPw(""); setErr(""); return; }
    setErr(j.error || "Couldn't sign in.");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">ICL Sales</h1>
        <p className="mt-1 text-sm text-zinc-500">{setup ? "First time here: create your password." : "Sign in with your ICL email."}</p>
        <label className="mt-5 block text-sm font-medium">Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setSetup(false); }} autoFocus placeholder="you@icldigital.com" className={input} />
        </label>
        {setup && (
          <label className="mt-3 block text-sm font-medium">Team password
            <input type="password" autoComplete="off" value={team} onChange={(e) => setTeam(e.target.value)} className={input} />
            <span className="mt-1 block text-xs font-normal text-zinc-500">The shared ICL password, once, to show you&apos;re on the team. Ask Chris if you don&apos;t have it.</span>
          </label>
        )}
        <label className="mt-3 block text-sm font-medium">{setup ? "Your new password" : "Password"}
          <input type="password" autoComplete={setup ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} className={input} />
          {setup && <span className="mt-1 block text-xs font-normal text-zinc-500">At least 10 characters. Only you will know it.</span>}
        </label>
        {setup && (
          <label className="mt-3 block text-sm font-medium">Type it again
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={input} />
          </label>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button disabled={busy || !email || !pw || (setup && (!team || !pw2))} className="mt-4 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "One moment…" : setup ? "Create password and sign in" : "Sign in"}
        </button>
        {setup && <button type="button" onClick={() => { setSetup(false); setErr(""); }} className="mt-2 w-full text-xs text-zinc-500 hover:text-zinc-900">Back to sign in</button>}
      </form>
    </main>
  );
}
