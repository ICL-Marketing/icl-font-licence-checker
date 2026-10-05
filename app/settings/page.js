"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamEditor, loadTeam, saveTeam, normaliseTeam } from "@/app/team";

export default function Settings() {
  const [team, setTeam] = useState([]);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTeam(loadTeam()), 0);
    fetch("/api/team").then((r) => r.json()).then((j) => {
      if (!j.shared) return;
      setShared(true);
      if (Array.isArray(j.team) && j.team.length) setTeam(normaliseTeam(j.team));
    }).catch(() => {});
    return () => clearTimeout(t);
  }, []);
  async function change(list) {
    const local = saveTeam(list);
    setTeam(local);
    if (shared) {
      const j = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: local }) }).then((r) => r.json()).catch(() => ({}));
      if (Array.isArray(j.team)) setTeam(normaliseTeam(j.team));
    }
  }
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">← Back to Website Checker</Link>
      <h1 className="mt-3 text-2xl font-semibold">Settings</h1>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Team names</h2>
        <p className="mb-3 text-sm text-zinc-500">Names and roles offered in the &quot;Checked by&quot; dropdowns on launch checks.</p>
        <TeamEditor team={team} onChange={change} shared={shared} />
      </section>
    </main>
  );
}
