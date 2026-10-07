"use client";

import { useState } from "react";
import { TEAM } from "@/data/team";
import { TrashIcon } from "@/app/icons";

// Team members ({name, role}) for the "Checked by" dropdowns. Stored in this browser, always A–Z by name.
export const TEAM_KEY = "flc-team-v1";
export const ROLES = ["Development", "Senior Developer", "Designer", "Account Manager", "Content"];

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
  const groups = [...ROLES, ""].map((r) => [r, team.filter((m) => (m.role || "") === r)]).filter(([r, list]) => r || list.length);
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onChange([...team, { name, role }]); setName(""); setRole(""); } }} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name" aria-label="Add a name" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm sm:w-64" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role for new person" className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">Role…</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={!name.trim() || !role} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
      </form>
      {/* One card per role; drag-free: change a person's role with the small dropdown. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([r, list]) => (
          <div key={r || "none"} className={`rounded-lg border p-3 ${r ? "border-zinc-200" : "border-amber-300 bg-amber-50"}`}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{r || "No role yet"}</h3>
              <span className="text-xs text-zinc-500">{list.length}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {list.map((m) => (
                <li key={m.name} className="group flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-zinc-50">
                  <span className="flex-1 font-medium">{m.name}</span>
                  <select value={m.role} onChange={(e) => setMemberRole(m.name, e.target.value)} aria-label={`Role for ${m.name}`} title="Move to another role"
                    className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-800">
                    <option value="">Move to…</option>
                    {ROLES.filter((x) => x !== m.role).map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <button onClick={() => onChange(team.filter((x) => x.name !== m.name))} aria-label={`Remove ${m.name}`} title="Remove" className="rounded p-0.5 text-zinc-300 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-3.5 w-3.5" /></button>
                </li>
              ))}
              {!list.length && <li className="text-xs text-zinc-400">Nobody yet</li>}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">People with the matching role are listed first on each check. {shared ? "Shared with everyone using the checker." : "Saved in this browser only."}</p>
    </div>
  );
}
