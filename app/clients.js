"use client";

import { useState } from "react";
import CLIENTS_DEFAULT from "@/data/clients.json";
import { normaliseClients } from "@/lib/clients";
import { ROLES } from "@/app/team";
import { DownloadIcon, TrashIcon, CheckIcon } from "@/app/icons";

// Client list for sign-offs (account manager) and client emails (addresses).
// Stored in this browser; shared through /api/clients when storage is set up.
export const CLIENTS_KEY = "flc-clients-v1";
export function loadClients() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLIENTS_KEY) || "null");
    if (Array.isArray(saved)) return normaliseClients(saved);
  } catch {}
  return normaliseClients(CLIENTS_DEFAULT);
}
export function saveClients(list) {
  const s = normaliseClients(list);
  try { localStorage.setItem(CLIENTS_KEY, JSON.stringify(s)); } catch {}
  return s;
}

const inputCls = "w-full rounded-md border border-zinc-300 px-2 py-1 text-xs";

function ClientRow({ c, team, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...c, [k]: v });
  // While editing, websites and emails are plain text; they become lists on save.
  // Lists show one entry per line.
  const asText = (v) => (Array.isArray(v) ? v.join("\n") : String(v || ""));
  const rows = (v) => Math.min(6, Math.max(1, asText(v).split("\n").length));
  const area = `${inputCls} resize-y leading-5`;
  const websitesEmpty = !asText(c.websites).trim();
  const managers = team.filter((m) => m.role === "Account Manager");
  const known = managers.some((m) => c.manager && (m.name.toLowerCase() === c.manager.toLowerCase() || c.manager.toLowerCase().startsWith(m.name.toLowerCase())));
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="py-1.5 pr-2"><input value={c.name} onChange={(e) => set("name", e.target.value)} aria-label="Client" className={`${inputCls} font-medium`} /></td>
      <td className="py-1.5 pr-2"><textarea value={asText(c.websites)} onChange={(e) => set("websites", e.target.value)} rows={rows(c.websites)} placeholder="example.co.uk (one per line)" aria-label="Websites" className={`${area} ${websitesEmpty ? "border-amber-300 bg-amber-50" : ""}`} /></td>
      <td className="py-1.5 pr-2">
        <select value={known ? managers.find((m) => c.manager.toLowerCase().startsWith(m.name.toLowerCase()))?.name : c.manager ? "__other" : ""} onChange={(e) => set("manager", e.target.value === "__other" ? c.manager : e.target.value)} aria-label="Account manager" className={`${inputCls} bg-white`}>
          <option value="">—</option>
          {managers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          {c.manager && !known && <option value="__other">{c.manager} (not in team)</option>}
        </select>
      </td>
      <td className="py-1.5 pr-2"><textarea value={c.poc} onChange={(e) => set("poc", e.target.value)} rows={rows(c.poc)} aria-label="Point of contact" className={area} /></td>
      <td className="py-1.5 pr-2"><textarea value={asText(c.emails)} onChange={(e) => set("emails", e.target.value)} rows={rows(c.emails)} placeholder="one address per line" aria-label="Email addresses" className={area} /></td>
      <td className="py-1.5 text-right"><button onClick={onRemove} aria-label={`Remove ${c.name}`} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600"><TrashIcon /></button></td>
    </tr>
  );
}

export function ClientsEditor({ clients, team, onChange, shared }) {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState(clients);
  const [dirty, setDirty] = useState(false);
  // Edits are kept locally until Save, so typing stays snappy on 100+ rows.
  const list = dirty ? draft : clients;
  const edit = (next) => { setDraft(next); setDirty(true); };
  const update = (i, c) => edit(list.map((x, n) => (n === i ? c : x)));
  const remove = (i) => edit(list.filter((_, n) => n !== i));
  const add = () => edit([{ id: `c${Date.now().toString(36)}`, name: "New client", websites: [], manager: "", poc: "", emails: [], phone: "", type: "Website", notes: "" }, ...list]);
  const save = () => { onChange(list); setDirty(false); setMsg("Saved."); setTimeout(() => setMsg(""), 1500); };

  async function importFile(file) {
    if (!file) return;
    setBusy("import"); setMsg("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const j = await (await fetch("/api/clients/file", { method: "POST", body: fd })).json();
      if (j.error) { setMsg(j.error); return; }
      // Merge by client name: imported rows update existing ones, new names are added.
      const byName = new Map(list.map((c) => [c.name.toLowerCase(), c]));
      for (const c of j.clients) { const cur = byName.get(c.name.toLowerCase()); byName.set(c.name.toLowerCase(), cur ? { ...cur, ...c, id: cur.id, websites: c.websites.length ? c.websites : cur.websites, manager: c.manager || cur.manager } : c); }
      onChange([...byName.values()]); setDirty(false);
      setMsg(`Imported ${j.clients.length} clients from "${j.sheet}".`);
    } catch (e) { setMsg(`Import failed: ${e.message}`); }
    finally { setBusy(""); }
  }
  async function exportFile() {
    setBusy("export");
    try {
      const r = await fetch("/api/clients/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clients: list }) });
      const blob = await r.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `web-clients-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
    } finally { setBusy(""); }
  }

  const ql = q.trim().toLowerCase();
  const rows = list.map((c, i) => ({ c, i })).filter(({ c }) => !ql || [c.name, c.manager, c.poc, String(c.emails), String(c.websites)].join(" ").toLowerCase().includes(ql));
  const unmatched = list.filter((c) => !(Array.isArray(c.websites) ? c.websites.length : String(c.websites || "").trim())).length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
        <button onClick={add} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">+ Add client</button>
        <label className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">
          {busy === "import" ? "Importing…" : "Import Excel"}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button onClick={exportFile} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50"><DownloadIcon /> {busy === "export" ? "Building…" : "Export Excel"}</button>
        <button onClick={save} disabled={!dirty} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"><CheckIcon /> Save changes</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {list.length} clients{unmatched ? `, ${unmatched} without a website (amber): add the domain so scans can find the client` : ""}. Websites and emails: one per line. {shared ? "Shared with everyone using the checker." : "Saved in this browser only."} {msg && <span className="font-medium text-green-700">{msg}</span>}
      </p>
      <div className="mt-2 max-h-[60vh] overflow-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="sticky top-0 bg-white"><tr className="text-left text-zinc-500">
            <th className="py-1 pr-2">Client</th><th className="py-1 pr-2">Website(s)</th><th className="py-1 pr-2">Account manager</th><th className="py-1 pr-2">Contact</th><th className="py-1 pr-2">Email(s)</th><th />
          </tr></thead>
          <tbody>{rows.map(({ c, i }) => <ClientRow key={c.id} c={c} team={team} onChange={(nc) => update(i, nc)} onRemove={() => remove(i)} />)}</tbody>
        </table>
      </div>
      {!managers(team).length && <p className="mt-2 text-xs text-amber-700">No one has the Account Manager role yet. Set roles in Team names above so account managers can be picked.</p>}
    </div>
  );
}
const managers = (team) => team.filter((m) => m.role === "Account Manager");
export { ROLES };
