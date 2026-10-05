"use client";

import { useState } from "react";
import { TEAM } from "@/data/team";

// Team names for the "Checked by" dropdowns. Stored in this browser, always A–Z.
export const TEAM_KEY = "flc-team-v1";
export const sortNames = (a) => [...new Set(a.map((n) => n.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" }));
export function loadTeam() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEAM_KEY) || "null");
    if (Array.isArray(saved)) return sortNames(saved);
  } catch {}
  return sortNames(TEAM);
}
export function saveTeam(list) {
  const s = sortNames(list);
  try { localStorage.setItem(TEAM_KEY, JSON.stringify(s)); } catch {}
  return s;
}

export function TeamEditor({ team, onChange, shared }) {
  const [name, setName] = useState("");
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {team.map((n) => (
          <span key={n} className="flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-sm text-zinc-800">
            {n}
            <button onClick={() => onChange(team.filter((x) => x !== n))} aria-label={`Remove ${n}`} className="rounded-full px-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600">×</button>
          </span>
        ))}
        {!team.length && <span className="text-sm text-zinc-500">No names yet.</span>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onChange([...team, name]); setName(""); } }} className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name" aria-label="Add a name" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
        <button type="submit" disabled={!name.trim()} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50">Add</button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">Always sorted A–Z. {shared ? "Shared with everyone using the checker." : "Saved in this browser only (connect shared storage to share with the team)."}</p>
    </div>
  );
}
