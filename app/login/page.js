"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (r.ok) { router.push("/"); router.refresh(); }
    else setErr("Wrong password");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Font licence checker</h1>
        <p className="mt-1 text-sm text-zinc-500">ICL Digital internal tool</p>
        <label className="mt-5 block text-sm font-medium">Password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button
          disabled={busy || !pw}
          className="mt-4 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
