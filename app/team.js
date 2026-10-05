"use client";

import { useState } from "react";
import { TEAM } from "@/data/team";

// Team members ({name, role}) for the "Checked by" dropdowns. Stored in this browser, always A–Z by name.
export const TEAM_KEY = "flc-team-v1";
export const ROLES = ["Development", "Designer", "Account Manager", "Content"];

// Accepts plain names (older saved lists) or {name, role} objects.
export function normaliseTeam(list) {
  const seen = new Map();
  for (const x of list || []) {
    const name = String(typeof x === "string" ? x : x?.name || "").trim();
    if (!name) continue;
    const role = ROLES.includes(x?.role) ? x.role : "";
    const key = name.toLowerCase();
    if (!seen.has(key) || (role && !seen.get(key).role)) seen.set(key, { name, role });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
export function loadTeam() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEAM_KEY) || "null");
    if (Array.isArray(saved)) return normaliseTeam(saved);
  } catch {}
  return normaliseTeam(TEAM);
}
export function saveTeam(list) {
  const s = normaliseTeam(list);
  try { localStorage.setItem(TEAM_KEY, JSON.stringify(s)); } catch {}
  return s;
}

export function TeamEditor({ team, onChange, shared }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const setMemberRole = (n, r) => onChange(team.map((m) => (m.name === n ? { ...m, role: r } : m)));
  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Role</th><th /></tr></thead>
        <tbody>
          {team.map((m) => (
            <tr key={m.name} className="border-t border-zinc-100">
              <td className="py-1.5 pr-3 font-medium">{m.name}</td>
              <td className="py-1.5 pr-3">
                <select value={m.role} onChange={(e) => setMemberRole(m.name, e.target.value)} aria-label={`Role for ${m.name}`}
                  className={`rounded-md border px-2 py-1 text-sm ${m.role ? "border-zinc-300 bg-white" : "border-amber-300 bg-amber-50"}`}>
                  <option value="">No role yet</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td className="py-1.5 text-right">
                <button onClick={() => onChange(team.filter((x) => x.name !== m.name))} aria-label={`Remove ${m.name}`} className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600">Remove</button>
              </td>
            </tr>
          ))}
          {!team.length && <tr><td colSpan={3} className="py-2 text-zinc-500">No names yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onChange([...team, { name, role }]); setName(""); setRole(""); } }} className="mt-3 flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name" aria-label="Add a name" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role for new person" className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">Role…</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={!name.trim()} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50">Add</button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">Always sorted A–Z. People with the matching role are listed first on each check. {shared ? "Shared with everyone using the checker." : "Saved in this browser only."}</p>
    </div>
  );
}
