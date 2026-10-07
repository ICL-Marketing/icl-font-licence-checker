"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PlayIcon, StopIcon, RefreshIcon, DownloadIcon, TrashIcon, ExternalIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon } from "@/app/icons";
import { LEAD_STATUSES, PROBLEMS } from "@/lib/leadsShared";
import SEED from "@/data/leads.json";

// Website leads: local businesses whose site is letting them down, found
// through Companies House and worked through a pipeline board.
const KEY = "flc-leads-v1";
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

const LIKELY = { High: "bg-green-100 text-green-800", Medium: "bg-amber-100 text-amber-800", Low: "bg-zinc-100 text-zinc-600" };
const PROBLEM_TONE = { "No website": "bg-red-600", "Parked domain": "bg-red-600", "Dead/broken site": "bg-red-600", "Broken SSL": "bg-orange-500", "Dated template": "bg-amber-500", "Stale copyright": "bg-zinc-500" };
const money = (n) => (n === null || n === undefined || n === "" ? "—" : `£${Math.round(Number(n)).toLocaleString("en-GB")}`);
const signed = (n) => (n === null || n === undefined || n === "" ? "—" : `${n < 0 ? "-" : "+"}£${Math.abs(Math.round(Number(n))).toLocaleString("en-GB")}`);

export default function LeadsArea({ onRunning, onCount, clients = [] }) {
  const [leads, setLeads] = useState({});
  const [cfg, setCfg] = useState(null); // {configured, areas, sectors}
  const [areas, setAreas] = useState(["richmond"]);
  const [place, setPlace] = useState("");
  const [sectors, setSectors] = useState(["retail", "hospitality", "trades"]);
  const [minAssets, setMinAssets] = useState(20000);
  const [run, setRun] = useState(null); // {phase, done, total, found, errors}
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("");
  const [showProblem, setShowProblem] = useState("");
  const stopRef = useRef(false);
  const sharedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      let local = load();
      if (!local) { local = Object.fromEntries(SEED.map((l) => [l.id, l])); save(local); }
      for (const l of Object.values(local)) if (l.email && !l.email.includes("\n\n")) l.email = l.email.trim().replace(/\n+/g, "\n\n"); // paragraph spacing for older drafts
      leadsRef.current = local;
      setLeads(local);
      fetch("/api/results?kind=leads").then((r) => r.json()).then((j) => {
        if (!j.shared) return;
        sharedRef.current = true;
        const next = { ...local };
        for (const [id, l] of Object.entries(j.results || {})) { if (!next[id] || String(l.updatedAt || "") >= String(next[id].updatedAt || "")) next[id] = l; }
        for (const l of Object.values(next)) if (l.email && !l.email.includes("\n\n")) l.email = l.email.trim().replace(/\n+/g, "\n\n");
        save(next);
        leadsRef.current = next;
        setLeads(next);
        // Push anything only this browser has (the seed on first load).
        for (const [id, l] of Object.entries(next)) if (!(j.results || {})[id]) push(id, l);
      }).catch(() => {});
    }, 0);
    fetch("/api/leads").then((r) => r.json()).then(setCfg).catch(() => setCfg({ configured: false, areas: {}, sectors: {} }));
    return () => clearTimeout(t);
  }, []);

  function push(id, l) {
    if (!sharedRef.current) return;
    fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "leads", site: id, data: l }) }).catch(() => {});
  }
  // Latest leads outside React's render cycle, so updates during a long scan don't race.
  const leadsRef = useRef({});
  useEffect(() => { leadsRef.current = leads; }, [leads]);
  const update = (id, fields) => {
    const l = { ...(leadsRef.current[id] || {}), ...fields, id, updatedAt: new Date().toISOString() };
    const next = { ...leadsRef.current, [id]: l };
    leadsRef.current = next;
    save(next); push(id, l);
    setLeads(next);
  };
  const remove = (id) => {
    const next = { ...leadsRef.current }; delete next[id]; leadsRef.current = next; save(next); setLeads(next);
    if (sharedRef.current) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "leads", site: id }) }).catch(() => {});
    setOpen(null);
  };

  const list = Object.values(leads);
  const openLeads = list.filter((l) => ["new", "qualified", "replied"].includes(l.status)).length;
  useEffect(() => { onCount?.(openLeads); }, [openLeads, onCount]);

  async function post(body) {
    const r = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  // Find new leads: every place in the chosen areas × chosen sectors, then enrich each new candidate.
  async function findLeads() {
    stopRef.current = false;
    onRunning?.(true);
    const places = place.trim() ? [place.trim()] : areas.flatMap((k) => PLACES[k] || []);
    const known = new Set(Object.keys(leads));
    const knownSites = clients.flatMap((c) => c.websites || []).map((w) => String(w).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    const st = { phase: "Searching Companies House…", done: 0, total: 0, found: 0, errors: [] };
    setRun({ ...st });
    try {
      const candidates = [];
      for (const pl of places) {
        if (stopRef.current) break;
        let start = 0;
        for (let page = 0; page < 5; page++) {
          const j = await post({ step: "search", place: pl, sectors, startIndex: start });
          for (const c of j.candidates) if (!known.has(c.companyNumber)) { known.add(c.companyNumber); candidates.push(c); }
          start += 100;
          st.phase = `Searching ${pl}… ${candidates.length} candidates`; setRun({ ...st });
          if (start >= j.total || j.scanned < 100) break;
        }
      }
      st.total = candidates.length;
      for (const c of candidates) {
        if (stopRef.current) break;
        st.phase = `Checking ${c.name}…`; setRun({ ...st });
        try {
          const { lead } = await post({ step: "enrich", company: c, knownSites });
          st.done++;
          if (lead.problem && (lead.netAssets === null || lead.netAssets >= minAssets)) { st.found++; update(lead.id, lead); }
          else if (lead.problem) { update(lead.id, { ...lead, status: "not-pursuing", caveats: [lead.caveats, `Net assets under £${minAssets.toLocaleString("en-GB")}`].filter(Boolean).join("; ") }); }
          // Current sites are not kept: nothing to pitch.
        } catch (e) { st.done++; st.errors.push(`${c.name}: ${e.message}`); }
        setRun({ ...st });
      }
      st.phase = stopRef.current ? "Stopped." : `Done: ${st.found} new lead${st.found === 1 ? "" : "s"} from ${st.done} companies checked.`;
      setRun({ ...st });
    } catch (e) {
      st.phase = `Stopped: ${e.message}`; setRun({ ...st });
    } finally { onRunning?.(false); }
  }

  async function recheck(l, redraft = false) {
    update(l.id, { checking: true, error: "" });
    try { const { lead } = await post({ step: redraft ? "redraft" : "recheck", lead: l }); update(l.id, { ...lead, checking: false, error: "" }); }
    catch (e) { update(l.id, { checking: false, error: e.message }); }
  }

  async function exportExcel() {
    const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "leads", results: sorted(list) }) });
    const blob = await r.blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `website-leads-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  }

  const q = filter.trim().toLowerCase();
  const visible = list.filter((l) => (!q || `${l.business} ${l.area} ${l.website} ${l.problem} ${l.notes || ""}`.toLowerCase().includes(q)) && (!showProblem || l.problem === showProblem));
  const running = !!run && !/^(Done|Stopped)/.test(run.phase);
  const current = open ? leads[open] : null;

  return (
    <div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Website Leads</h2>
        {cfg && !cfg.configured && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Companies House is not connected yet. Add the free API key in <Link href="/settings?section=connections" className="underline">Settings → Connections</Link>. The board below still works.</p>}
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <fieldset className="rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-600">Area</legend>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(cfg?.areas || {}).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setAreas((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))} className={`rounded-full border px-2.5 py-1 text-xs ${areas.includes(k) && !place.trim() ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{label}</button>
              ))}
            </div>
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="…or one town, e.g. Teddington" className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-xs" />
          </fieldset>
          <fieldset className="rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-600">Business types</legend>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(cfg?.sectors || {}).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setSectors((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))} className={`rounded-full border px-2.5 py-1 text-xs ${sectors.includes(k) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{label}</button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">Only keep companies with net assets of at least £
              <input type="number" value={minAssets} onChange={(e) => setMinAssets(Number(e.target.value) || 0)} step={5000} min={0} className="w-24 rounded-md border border-zinc-300 px-2 py-0.5" />
            </label>
          </fieldset>
          <div className="flex flex-col justify-end gap-2">
            {running
              ? <button onClick={() => { stopRef.current = true; }} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
              : <button onClick={findLeads} disabled={cfg?.configured === false || (!areas.length && !place.trim()) || !sectors.length} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Find leads</button>}
            <button onClick={exportExcel} disabled={!list.length} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><DownloadIcon className="h-4 w-4" /> Excel</button>
          </div>
        </div>
        {run && (
          <div className="mt-3 text-sm">
            <div className="flex items-center gap-2">{running && <SpinnerIcon className="h-4 w-4 text-blue-600" />}<span className={running ? "text-blue-700" : "text-zinc-700"}>{run.phase}</span>{run.total > 0 && <span className="text-xs text-zinc-500">{run.done} of {run.total} checked · {run.found} leads</span>}</div>
            {run.total > 0 && <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} /></div>}
            {run.errors.length > 0 && <details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">{run.errors.length} could not be checked</summary><ul className="list-disc pl-5">{run.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search leads" className="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
        <select value={showProblem} onChange={(e) => setShowProblem(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">All problems</option>
          {PROBLEMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-zinc-500">{visible.length} of {list.length} leads · drag a card to change its status</span>
      </div>

      <Board leads={visible} onOpen={setOpen} onMove={(id, status) => update(id, { status })} />

      {current && <LeadDrawer l={current} onClose={() => setOpen(null)} onChange={(f) => update(current.id, f)} onRemove={() => remove(current.id)} onRecheck={(redraft) => recheck(current, redraft)} />}
    </div>
  );
}

const PLACES = {
  richmond: ["Twickenham", "Hampton", "Hampton Hill", "Hampton Wick", "Teddington", "Richmond", "East Sheen", "Mortlake", "Barnes", "Kew", "St Margarets", "Whitton", "Strawberry Hill", "Ham", "Petersham"],
  kingston: ["Kingston upon Thames", "Surbiton", "New Malden", "Chessington", "Tolworth"],
  hounslow: ["Hounslow", "Chiswick", "Isleworth", "Brentford", "Feltham"],
  wandsworth: ["Putney", "Wandsworth", "Wimbledon", "Southfields", "Earlsfield"],
};

const sorted = (list) => list.slice().sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.likelihood] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.likelihood] ?? 3) || (b.netAssets || 0) - (a.netAssets || 0));

function Board({ leads, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  const cols = LEAD_STATUSES.map(([id, label]) => ({ id, label, items: sorted(leads.filter((l) => (l.status || "new") === id)) }));
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-3">
      {cols.map((c) => (
        <div key={c.id} onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/lead"); if (id) onMove(id, c.id); setOver(null); }}
          className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${over === c.id ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-100/60"}`}>
          <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-zinc-700"><span>{c.label}</span><span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">{c.items.length}</span></div>
          <div className="flex flex-1 flex-col gap-2">
            {c.items.map((l) => (
              <button key={l.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/lead", l.id); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(l.id)}
                className="cursor-grab rounded-lg border border-zinc-200 bg-white p-2.5 text-left shadow-sm hover:border-zinc-400 active:cursor-grabbing">
                <div className="flex items-start gap-1.5">
                  <span className="flex-1 text-sm font-medium leading-tight">{l.business}</span>
                  {l.likelihood && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${LIKELY[l.likelihood]}`}>{l.likelihood}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                  {l.problem && <span className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${PROBLEM_TONE[l.problem] || "bg-zinc-500"}`}>{l.problem}</span>}
                  <span>{l.area}</span>
                  {l.netAssets != null && l.netAssets !== "" && <span>· {money(l.netAssets)}</span>}
                </div>
                {l.checking && <div className="mt-1 text-[11px] text-blue-600">Checking…</div>}
              </button>
            ))}
            {!c.items.length && <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-[11px] text-zinc-400">Drop here</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return <div><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div><div className="mt-0.5 text-sm">{children}</div></div>;
}
function TextField({ label, value, onChange, rows = 2, mono = false }) {
  return (
    <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows} className={`mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm ${mono ? "font-mono text-xs" : ""}`} />
    </label>
  );
}

function LeadDrawer({ l, onClose, onChange, onRemove, onRecheck }) {
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const full = `Subject: ${l.subject || ""}\n\n${l.email || ""}`;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(l.emailAddress || "")}&subject=${encodeURIComponent(l.subject || "")}&body=${encodeURIComponent(l.email || "")}`;
  async function copy() { try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  const site = l.website ? (/^https?:/.test(l.website) ? l.website : `https://${l.website}`) : "";
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start gap-2 border-b border-zinc-200 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            <input value={l.business || ""} onChange={(e) => onChange({ business: e.target.value })} className="w-full rounded border border-transparent text-lg font-semibold hover:border-zinc-300 focus:border-zinc-400" />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {l.problem && <span className={`rounded-full px-2 py-0.5 font-semibold text-white ${PROBLEM_TONE[l.problem] || "bg-zinc-500"}`}>{l.problem}</span>}
              {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">{l.website} <ExternalIcon /></a>}
              {l.companyNumber && <a href={`https://find-and-update.company-information.service.gov.uk/company/${l.companyNumber}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">Companies House {l.companyNumber} <ExternalIcon /></a>}
            </div>
          </div>
          <select value={l.status || "new"} onChange={(e) => onChange({ status: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {LEAD_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><CloseIcon /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Likelihood"><select value={l.likelihood || ""} onChange={(e) => onChange({ likelihood: e.target.value })} className={`rounded px-1.5 py-0.5 text-sm font-semibold ${LIKELY[l.likelihood] || ""}`}><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></Field>
            <Field label="Net assets">{money(l.netAssets)}</Field>
            <Field label="RE change">{signed(l.reChange)}</Field>
            <Field label="Area"><input value={l.area || ""} onChange={(e) => onChange({ area: e.target.value })} className="w-full rounded border border-transparent hover:border-zinc-300" /></Field>
          </div>
          <TextField label="Problem detail" value={l.problemDetail} onChange={(v) => onChange({ problemDetail: v })} rows={1} />
          <TextField label="Likelihood rationale" value={l.likelihoodWhy} onChange={(v) => onChange({ likelihoodWhy: v })} rows={2} />
          <TextField label="Background" value={l.background} onChange={(v) => onChange({ background: v })} rows={2} />
          <TextField label="Pitch angle" value={l.pitch} onChange={(v) => onChange({ pitch: v })} rows={2} />
          <TextField label="Caveats" value={l.caveats} onChange={(v) => onChange({ caveats: v })} rows={1} />
          <TextField label="Notes / next action" value={l.notes} onChange={(v) => onChange({ notes: v })} rows={3} />

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Outreach email</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
                <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy email</>}</button>
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">To</div>
                <input value={l.emailAddress || ""} onChange={(e) => onChange({ emailAddress: e.target.value })} placeholder={l.emailNote || "email address"} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
              <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Contact first name</div>
                <input value={l.contactName || ""} onChange={(e) => onChange({ contactName: e.target.value })} placeholder="Used for “Hi Steve,”" className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
            </div>
            <label className="mt-2 block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Subject</div>
              <input value={l.subject || ""} onChange={(e) => onChange({ subject: e.target.value })} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
            <textarea value={l.email || ""} onChange={(e) => onChange({ email: e.target.value })} rows={9} className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs">
            {l.website && <button onClick={() => onRecheck(false)} disabled={l.checking} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" /> Re-check website</button>}
            {l.problem && <button onClick={() => onRecheck(true)} disabled={l.checking} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-40"><PlayIcon className="h-3.5 w-3.5" /> Redraft email</button>}
            {l.checking && <span className="inline-flex items-center gap-1 text-blue-700"><SpinnerIcon className="h-3.5 w-3.5" /> Working…</span>}
            {l.error && <span className="text-red-700">{l.error}</span>}
            {l.checkedAt && !l.checking && <span className="text-zinc-500">Checked {new Date(l.checkedAt).toLocaleDateString("en-GB")}</span>}
            <span className="ml-auto">
              {asking
                ? <><button onClick={onRemove} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white"><TrashIcon className="h-3.5 w-3.5" /> Delete</button> <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1">Keep</button></>
                : <button onClick={() => setAsking(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-zinc-400 hover:text-red-600"><TrashIcon className="h-3.5 w-3.5" /> Delete lead</button>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
