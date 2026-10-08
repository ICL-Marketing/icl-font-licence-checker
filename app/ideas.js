"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { StopIcon, RefreshIcon, ExternalIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon } from "@/app/icons";
import { IDEA_STATUSES, IDEA_KINDS, ideasFor, ideaEmail, researchPrompt, parseResearchReply, findingsLine, IDEAS_VERSION, normStatus, monthKey, monthName, clientQueue, monthlyPick, topIdeas, IDEA_SERVICES, serviceFor, hoursFor, isQuickFix } from "@/lib/clientIdeas";
import { dayGreeting, firstNameOf } from "@/lib/leadsShared";

// Client Ideas: the same engine as Website Leads, pointed at our existing clients' websites.
// Each client site is checked for free (site health, licences, homepage gaps) plus one search
// credit for their ranking, and every finding becomes an idea card with a friendly email ready.
const KEY = "flc-ideas-v1";
const RECHECK_DAYS = 30;
const host = (w) => String(w || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const recId = (c, w) => `${String(c.id || c.name).toLowerCase().replace(/[^a-z0-9-]/g, "")}:${host(w)}`;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

function AutoTextarea({ value, minRows = 3, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; }, [value]);
  return <textarea ref={ref} value={value} rows={minRows} className={`resize-none overflow-hidden ${className}`} {...rest} />;
}

async function post(body) {
  const r = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

export default function IdeasArea({ clients = [], onRunning, onCount }) {
  const [recs, setRecs] = useState({});
  const recsRef = useRef({});
  const sharedRef = useRef(false);
  const [run, setRun] = useState(null);
  const stopRef = useRef(false);
  const [open, setOpen] = useState(null); // { id, key }
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("");
  const [withSearch, setWithSearch] = useState(true);
  const [cfg, setCfg] = useState(null); // { ai, aiUsage }
  const [withAi, setWithAi] = useState(true);
  const [researchFor, setResearchFor] = useState(null);
  const [view, setViewState] = useState(() => { try { const v = localStorage.getItem("flc-ideas-view"); return v && v !== "month" ? v : "top"; } catch { return "top"; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem("flc-ideas-view", v); } catch {} };
  const [manager, setManager] = useState("");
  const [service, setService] = useState("");
  // Feedback on bad ideas, shared with the team: fed into research prompts, and repeat offenders drop out of the top 3.
  const [feedback, setFeedback] = useState([]);
  const feedbackRef = useRef([]);
  useEffect(() => { fetch("/api/settings?key=idea-feedback").then((r) => r.json()).then((j) => { if (j.shared && Array.isArray(j.value)) { feedbackRef.current = j.value; setFeedback(j.value); } }).catch(() => {}); }, []);
  function markBad(rec, idea, reason) {
    updateIdea(rec.id, idea.key, { status: "declined", badReason: reason, statusAt: new Date().toISOString() });
    const entry = { at: new Date().toISOString(), client: rec.name, title: idea.title, service: idea.service || serviceFor(idea.title), key: idea.ai ? "" : idea.key, reason };
    const next = [entry, ...feedbackRef.current].slice(0, 200);
    feedbackRef.current = next; setFeedback(next);
    fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "idea-feedback", value: next }) }).catch(() => {});
  }
  const badRuleKeys = new Set(Object.entries(feedback.reduce((m, f) => { if (f.key) m[f.key] = (m[f.key] || 0) + 1; return m; }, {})).filter(([, n]) => n >= 2).map(([k]) => k)); // null = closed, [] = next batch, [clientId] = that client
  useEffect(() => { fetch("/api/ideas").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  useEffect(() => {
    // Emails written with older wording are rewritten (hand-edited ones are left alone); statuses and order are kept.
    const refresh = (all) => {
      const changed = [];
      const out = { ...all };
      for (const [id, r] of Object.entries(out)) if ((r.ideasVersion || 0) < IDEAS_VERSION && (r.ideas || []).length) { out[id] = { ...r, ideas: ideasFor(r, r.ideas), ideasVersion: IDEAS_VERSION, updatedAt: new Date().toISOString() }; changed.push(id); }
      return { out, changed };
    };
    const first = refresh(load());
    recsRef.current = first.out; save(first.out);
    setTimeout(() => setRecs(first.out), 0);
    fetch("/api/results?kind=ideas").then((r) => r.json()).then((j) => {
      if (!j.shared) return;
      sharedRef.current = true;
      const merged = { ...recsRef.current };
      for (const [id, v] of Object.entries(j.results || {})) if (!merged[id] || String(v.updatedAt || "") >= String(merged[id].updatedAt || "")) merged[id] = v;
      const { out, changed } = refresh(merged);
      recsRef.current = out; save(out); setRecs(out);
      for (const id of [...new Set([...first.changed, ...changed])]) if (out[id]) fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ideas", site: id, data: out[id] }) }).catch(() => {});
    }).catch(() => {});
  }, []);

  const update = (id, fields) => {
    const prev = recsRef.current[id] || {};
    const r = { ...prev, ...fields, id, updatedAt: new Date().toISOString() };
    const next = { ...recsRef.current, [id]: r };
    recsRef.current = next; save(next); setRecs(next);
    if (sharedRef.current) fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ideas", site: id, data: r }) }).catch(() => {});
  };
  const updateIdea = (id, key, fields) => {
    const r = recsRef.current[id]; if (!r) return;
    update(id, { ideas: (r.ideas || []).map((i) => (i.key === key ? { ...i, ...fields, ...(fields.status && fields.status !== i.status ? { statusAt: new Date().toISOString() } : {}) } : i)) });
  };

  // Monthly send-out actions. Priorities are shared across a client's sites, so moves swap values.
  const month = monthKey();
  function markSent(recIdArg, key) { updateIdea(recIdArg, key, { status: "sent", sentAt: new Date().toISOString(), sentMonth: month }); }
  function undoSent(recIdArg, key) { updateIdea(recIdArg, key, { status: "queued", sentAt: "", sentMonth: "" }); }
  function queueOf(clientId) { return clientQueue(Object.values(recsRef.current).filter((r) => r.clientId === clientId)); }
  function skip(clientId, idea) { const q = queueOf(clientId); const last = Math.max(...q.map((i) => i.priority ?? 0)); updateIdea(idea.recId, idea.key, { priority: last + 1 }); }
  function move(clientId, idea, dir) {
    const q = queueOf(clientId).filter((i) => i.status === "queued");
    const at = q.findIndex((i) => i.recId === idea.recId && i.key === idea.key); const other = q[at + dir];
    if (at < 0 || !other) return;
    const a = idea.priority ?? at, b = other.priority ?? at + dir;
    updateIdea(idea.recId, idea.key, { priority: b === a ? b + dir : b });
    updateIdea(other.recId, other.key, { priority: a });
  }

  // One client site, start to finish: health + homepage gaps, licences, then (optionally) one search.
  async function checkOne(c, w, st) {
    const id = recId(c, w);
    const prev = recsRef.current[id] || {};
    st.phase = `Checking ${c.name} (${host(w)})…`; setRun({ ...st });
    const site = await post({ step: "check", website: w });
    let rec = { ...prev, ...site, clientId: c.id, name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [] };
    const alive = site.problem !== "Dead/broken site" && site.problem !== "Parked domain";
    if (alive && !stopRef.current) { st.phase = `Checking licences on ${host(w)}…`; setRun({ ...st }); try { const l = await post({ step: "licence", website: w }); rec.licence = l.licence; } catch {} }
    if (alive && withSearch && !stopRef.current) {
      st.phase = `Searching for ${c.name}…`; setRun({ ...st });
      try { const s = await post({ step: "seo", website: w, name: c.name, town: prev.townOverride || "", trade: prev.tradeOverride || "", title: site.title, siteDescription: site.siteDescription, siteHeadings: site.siteHeadings, siteBody: site.siteBody }); rec.seo = s.seo || prev.seo || null; rec.searchTown = s.town || ""; rec.searchTrade = s.trade || ""; rec.searchNote = s.skipped || ""; } catch (e) { rec.searchNote = e.message; }
    }
    // AI research: who they really are and what would help them, from the web plus our findings.
    if (cfg?.ai && withAi && !stopRef.current) {
      st.phase = `Researching ${c.name} with AI…`; setRun({ ...st });
      const t = rec.seo?.searches?.find((x) => x.kind === "trade");
      const findings = { problem: rec.problem || "", detail: rec.problemDetail || "", platform: rec.platform || "", footerYear: rec.year || 0, signals: rec.signals || null,
        licence: rec.licence ? { fonts: [...(rec.licence.fonts || []), ...(rec.licence.possibleFonts || [])].map((f) => `${f.family}: ${f.label}`), stockImages: (rec.licence.images || []).length } : null,
        search: t ? `${t.query}: ${t.position ? `#${t.position}` : "not on page 1"}` : "" };
      const ask = (quick) => fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "research", name: c.name, websites: c.websites || [], notes: c.notes || "", findings, quick }) }).then((r) => r.json());
      try {
        let j = await ask(false);
        if (j.error && /too long|did not finish/i.test(j.error) && !stopRef.current) j = await ask(true);
        if (j.research) { rec.ai = j.research; rec.aiError = ""; } else rec.aiError = j.error || "AI research failed";
      } catch (e) { rec.aiError = e.message; }
      fetch("/api/ideas").then((r) => r.json()).then(setCfg).catch(() => {});
    }
    rec.ideas = ideasFor(rec, prev.ideas || []);
    rec.ideasVersion = IDEAS_VERSION;
    update(id, rec);
    return rec;
  }

  async function checkAll(force = false) {
    stopRef.current = false; onRunning?.(true);
    const jobs = clients.flatMap((c) => (c.websites || []).map((w) => [c, w])).filter(([c, w]) => force || daysAgo(recsRef.current[recId(c, w)]?.checkedAt) > RECHECK_DAYS);
    const st = { phase: "Starting…", done: 0, total: jobs.length, found: 0, errors: [] };
    setRun({ ...st });
    for (const [c, w] of jobs) {
      if (stopRef.current) break;
      try { const r = await checkOne(c, w, st); st.found += (r.ideas || []).filter((i) => normStatus(i.status) === "queued").length; } catch (e) { st.errors.push(`${c.name}: ${e.message}`); }
      st.done++; setRun({ ...st });
    }
    st.phase = stopRef.current ? `Stopped: ${st.done} of ${st.total} client sites checked` : `Done: ${st.done} client site${st.done === 1 ? "" : "s"} checked, ${st.found} new idea${st.found === 1 ? "" : "s"}${jobs.length ? "" : " (all checked in the last 30 days; use Re-check all to force)"}`;
    setRun({ ...st }); onRunning?.(false);
  }
  // Claude's reply (from the user's own Claude plan) -> research + ideas on each client's records.
  function importResearch(items) {
    let clientsDone = 0, ideasAdded = 0; const doneIds = [];
    for (const it of items) {
      const c = clients.find((x) => String(x.id) === it.client_id) || clients.find((x) => String(x.id).toLowerCase() === it.client_id.toLowerCase());
      if (!c) continue;
      const sites = (c.websites || []).length ? c.websites : ["none"];
      for (const w of sites) {
        const id = recId(c, w);
        const prev = recsRef.current[id] || { website: w === "none" ? "" : host(w) };
        const rec = { ...prev, clientId: c.id, name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [], ai: it, aiError: "" };
        rec.ideas = ideasFor(rec, prev.ideas || []);
        rec.ideasVersion = IDEAS_VERSION;
        ideasAdded += rec.ideas.filter((i) => i.ai && !(prev.ideas || []).some((p) => p.key === i.key)).length;
        update(id, rec);
      }
      clientsDone++; doneIds.push(c.id);
    }
    return { clientsDone, ideasAdded, doneIds };
  }
  async function recheckOne(id) {
    const r = recsRef.current[id]; const c = clients.find((x) => x.id === r?.clientId) || { id: r?.clientId, name: r?.name, emails: r?.emails, poc: r?.poc, manager: r?.manager };
    stopRef.current = false; onRunning?.(true);
    const st = { phase: "", done: 0, total: 1, found: 0, errors: [] };
    update(id, { checking: true });
    try { await checkOne(c, r.website, st); st.phase = `Done: ${c.name} re-checked`; } catch (e) { st.phase = `Done: ${e.message}`; }
    update(id, { checking: false }); setRun({ ...st }); onRunning?.(false);
  }

  // Keep the client details current when Settings change (name, contacts, manager).
  useEffect(() => {
    const t = setTimeout(() => {
      for (const r of Object.values(recsRef.current)) {
        const c = clients.find((x) => x.id === r.clientId); if (!c) continue;
        if (c.name !== r.name || (c.manager || "") !== (r.manager || "") || (c.poc || "") !== (r.poc || "") || JSON.stringify(c.emails || []) !== JSON.stringify(r.emails || [])) update(r.id, { name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [] });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [clients]);

  const running = !!run && !/^(Done|Stopped)/.test(run.phase);
  const cards = Object.values(recs).flatMap((r) => (r.ideas || []).map((i) => ({ ...i, recId: r.id, client: r.name, website: r.website, manager: r.manager })));
  const q = filter.trim().toLowerCase();
  const shown = cards.filter((c) => (!kind || c.kind === kind) && (!q || `${c.client} ${c.website} ${c.title} ${c.manager}`.toLowerCase().includes(q)));
  // Group by client for the monthly send-out.
  const byClient = new Map();
  for (const r of Object.values(recs)) { const k = r.clientId || r.name; if (!byClient.has(k)) byClient.set(k, { clientId: r.clientId, name: r.name, manager: r.manager || "", recs: [] }); byClient.get(k).recs.push(r); }
  const groups = [...byClient.values()].map((g) => { const queue = clientQueue(g.recs); return { ...g, queue, top: topIdeas(queue.filter((i) => !badRuleKeys.has(i.key)), 50, service), pick: monthlyPick(queue, month) }; })
    .filter((g) => g.queue.length && (!manager || g.manager === manager) && (!q || `${g.name} ${g.manager} ${g.queue.map((i) => i.title).join(" ")}`.toLowerCase().includes(q)))
    .filter((g) => !service || g.top.length)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Service chips: how many big ideas of each type are in play (respecting the manager and search filters).
  const serviceCounts = {};
  for (const g of [...byClient.values()]) {
    if (manager && g.manager !== manager) continue;
    for (const i of topIdeas(clientQueue(g.recs).filter((x) => !badRuleKeys.has(x.key)), 99)) { const k = i.service || serviceFor(i.title); serviceCounts[k] = (serviceCounts[k] || 0) + 1; }
  }
  const dueCount = groups.reduce((n, g) => n + g.top.filter((i) => i.status === "queued").length, 0);
  const managers = [...new Set([...byClient.values()].map((g) => g.manager).filter(Boolean))].sort();
  useEffect(() => { onCount?.(dueCount); }, [dueCount, onCount]);
  const sitesTotal = clients.reduce((n, c) => n + (c.websites || []).length, 0);
  const sitesChecked = clients.reduce((n, c) => n + (c.websites || []).filter((w) => recs[recId(c, w)]?.checkedAt).length, 0);
  const noSite = clients.filter((c) => !(c.websites || []).length).length;
  const current = open ? recs[open.id] : null;
  const currentIdea = current ? (current.ideas || []).find((i) => i.key === open.key) : null;

  return (
    <div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Client Ideas</h2>
        {!clients.length && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">No clients yet. Add them in <Link href="/settings?section=clients" className="underline">Settings → Clients</Link>.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {running
            ? <button onClick={() => { stopRef.current = true; }} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
            : <button onClick={() => checkAll(false)} disabled={!sitesTotal} title="Checks every client website not checked in the last 30 days" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Find ideas</button>}
          <button onClick={() => checkAll(true)} disabled={running || !sitesTotal} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-4 w-4" /> Re-check all</button>
          <label className="inline-flex items-center gap-1.5 text-sm text-zinc-700" title="One Brave search credit per client site, shared with Website Leads"><input type="checkbox" checked={withSearch} onChange={(e) => setWithSearch(e.target.checked)} disabled={running} /> Include search ranking</label>
          {cfg?.ai
            ? <label className="inline-flex items-center gap-1.5 text-sm text-zinc-700" title="Claude researches each client on the web (what they really do, where, competitors, whether the website on file is theirs) and writes ideas specific to them. Roughly 20-40p per client."><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} disabled={running} /> AI research <span className="text-xs text-zinc-400">{cfg.aiUsage?.used || 0} of {cfg.aiUsage?.cap || 0} this month</span></label>
            : null}
          <button onClick={() => setResearchFor([])} disabled={!clients.length} title="Free: the app writes a research prompt for a batch of clients, you run it in Claude on your own plan and paste the reply back" className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-900 hover:bg-violet-100 disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Research with Claude</button>
          <span className="text-xs text-zinc-500">{sitesChecked} of {sitesTotal} client sites checked{noSite ? ` · ${noSite} client${noSite === 1 ? "" : "s"} with no website in Settings` : ""}</span>
        </div>
        {run && (
          <div className="mt-3 text-sm">
            <div className="flex items-center gap-2">{running && <SpinnerIcon className="h-4 w-4 text-blue-600" />}<span className={running ? "text-blue-700" : "text-zinc-700"}>{run.phase}</span>{run.total > 1 && <span className="text-xs text-zinc-500">{run.done} of {run.total} · {run.found} new ideas</span>}</div>
            {run.total > 1 && <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} /></div>}
            {run.errors?.length > 0 && <details className="mt-1 text-xs text-red-700"><summary>{run.errors.length} problem{run.errors.length === 1 ? "" : "s"}</summary>{run.errors.map((e, i) => <div key={i}>{e}</div>)}</details>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
          {[["top", "Top ideas"], ["clients", "All ideas"], ["replies", "Replies"]].map(([id, label]) => <button key={id} onClick={() => setView(id)} className={`rounded px-3 py-1 ${view === id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{label}</button>)}
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search clients or ideas" className="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
        {managers.length > 0 && <select value={manager} onChange={(e) => setManager(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"><option value="">All account managers</option>{managers.map((m) => <option key={m}>{m}</option>)}</select>}
        {view === "replies" && <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"><option value="">All kinds</option>{Object.entries(IDEA_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}
      </div>

      {view === "top" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setService("")} className={`rounded-full border px-3 py-1 text-xs font-medium ${!service ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>All services</button>
          {Object.keys(IDEA_SERVICES).filter((k) => serviceCounts[k]).map((k) => (
            <button key={k} onClick={() => setService(service === k ? "" : k)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${service === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}><span className={`h-2 w-2 rounded-full ${IDEA_SERVICES[k]}`} />{k}<span className="opacity-60">{serviceCounts[k]}</span></button>
          ))}
        </div>
      )}
      {view === "top" && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500"><th className="w-52 px-4 py-2 font-semibold">Client</th><th className="px-3 py-2 font-semibold">{service ? `${service} ideas` : "Ideas"}, best first <span className="normal-case tracking-normal text-zinc-400">· scroll sideways for more</span></th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {groups.length === 0 && <tr><td colSpan={2} className="p-4 text-zinc-500">No ideas yet. Use Research with Claude above.</td></tr>}
              {groups.map((g) => (
                <tr key={g.clientId || g.name} className="align-top">
                  <td className="px-4 py-3"><div className="font-medium">{g.name}</div>{(() => { const w = (g.recs.find((x) => x.website) || {}).website; return w ? <a href={`https://${w}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline">{w} <ExternalIcon /></a> : null; })()}<div className="text-[11px] text-zinc-500">{g.manager || "No account manager"}</div>{g.top.length < 3 && <button onClick={() => setResearchFor([g.clientId])} className="mt-1 text-[11px] text-orange-700 underline">Research for more big ideas</button>}</td>
                  <td className="max-w-0 px-3 py-3">
                  <div className="grid snap-x auto-cols-[calc((100%-1.5rem)/3)] grid-flow-col gap-3 overflow-x-auto pb-1">
                  {g.top.length === 0 && <div className="text-xs text-zinc-400">No big ideas yet.</div>}
                  {g.top.map((it, n) => {
                    const r = g.recs.find((x) => x.id === it.recId) || g.recs[0]; const to = (r?.emails || [])[0] || "";
                    const href = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(it.subject || "")}&body=${encodeURIComponent(ideaEmail(r, it, to))}`;
                    return (
                      <div key={`${it.recId}|${it.key}`} onClick={() => setOpen({ id: it.recId, key: it.key })} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen({ id: it.recId, key: it.key }); }} className="cursor-pointer snap-start rounded-lg border border-zinc-200 p-2.5 hover:border-zinc-400 hover:bg-zinc-50">
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          {(() => { const sv = it.service || serviceFor(it.title); return <button onClick={(e) => { e.stopPropagation(); setService(service === sv ? "" : sv); }} title={`Show only ${sv} ideas`} className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${IDEA_SERVICES[sv] || "bg-zinc-500"}`}>{sv}</button>; })()}
                          {isQuickFix(it) ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-800">Quick fix</span> : it.size === "large" && <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 font-semibold text-white">Large</span>}
                          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-semibold text-zinc-700" title={it.hours ? "Estimated hours to deliver" : "Rough guess; research again for Claude's estimate"}>~{hoursFor(it)} hr{hoursFor(it) === 1 ? "" : "s"}</span>
                          {it.value && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800" title="Rough budget, for us only">{it.value}</span>}
                          {it.likely && <span className={`rounded-full px-1.5 py-0.5 font-semibold ${it.likely === "High" ? "bg-green-600 text-white" : it.likely === "Medium" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`} title="How likely they are to say yes">{it.likely === "High" ? "Likely yes" : `${it.likely} chance`}</span>}
                        </div>
                        <div className="mt-1 font-medium leading-snug">{it.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                          {it.status === "queued"
                            ? <><a href={href} target="_blank" rel="noopener" title={to ? `Opens Outlook with the email to ${to}` : "No email for this client in Settings"} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100"><MailIcon className="h-3 w-3" /> Outlook</a><button onClick={() => markSent(it.recId, it.key)} className="rounded-md bg-emerald-700 px-2 py-0.5 font-medium text-white hover:bg-emerald-800">Mark sent</button></>
                            : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{IDEA_STATUSES.find(([id]) => id === it.status)?.[1]}{it.sentAt ? ` ${new Date(it.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "clients" && (
        <div className="mt-3 space-y-2">
          {groups.length === 0 && <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">No ideas yet.</p>}
          {groups.map((g) => (
            <details key={g.clientId || g.name} className="rounded-xl border border-zinc-200 bg-white" open={!!q}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5"><span className="font-medium">{g.name}</span><span className="text-xs text-zinc-500">{g.manager} · {g.queue.filter((i) => i.status === "queued").length} queued · {g.queue.filter((i) => i.status !== "queued").length} sent or replied</span></summary>
              <ol className="divide-y divide-zinc-100 border-t border-zinc-100">
                {g.queue.map((it) => {
                  const queuedList = g.queue.filter((i) => i.status === "queued"); const pos = queuedList.findIndex((i) => i.recId === it.recId && i.key === it.key);
                  return (
                    <li key={`${it.recId}|${it.key}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                      <span className="w-6 text-right text-xs text-zinc-400">{pos >= 0 ? pos + 1 : ""}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-white ${IDEA_KINDS[it.kind]?.tone || "bg-zinc-500"}`}>{IDEA_KINDS[it.kind]?.label}</span>
                      {it.ai && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">AI</span>}
                      <button onClick={() => setOpen({ id: it.recId, key: it.key })} className="min-w-0 flex-1 truncate text-left hover:underline">{it.title}</button>
                      {pos >= 0 && <span className="flex gap-1"><button onClick={() => move(g.clientId, it, -1)} disabled={pos === 0} aria-label="Move up" className="rounded border border-zinc-200 px-1.5 text-xs disabled:opacity-30">↑</button><button onClick={() => move(g.clientId, it, 1)} disabled={pos === queuedList.length - 1} aria-label="Move down" className="rounded border border-zinc-200 px-1.5 text-xs disabled:opacity-30">↓</button></span>}
                      <select value={it.status} onChange={(e) => updateIdea(it.recId, it.key, { status: e.target.value, ...(e.target.value === "sent" && !it.sentAt ? { sentAt: new Date().toISOString(), sentMonth: month } : {}) })} className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs">{IDEA_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                      {it.sentAt && <span className="text-[11px] text-zinc-400">sent {new Date(it.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
        </div>
      )}

      {view === "replies" && <IdeaBoard cards={shown.filter((c) => normStatus(c.status) !== "queued").map((c) => ({ ...c, status: normStatus(c.status) }))} filtering={!!(q || kind)} onOpen={(id, key) => setOpen({ id, key })} onMove={(id, key, status) => updateIdea(id, key, { status })} />}

      {researchFor && <ResearchModal feedback={feedback} clients={clients} recs={recs} preset={researchFor} initialManager={manager} onClose={() => setResearchFor(null)} onImport={importResearch} />}

      {current && currentIdea && (
        <IdeaDrawer r={current} idea={currentIdea} onClose={() => setOpen(null)} onIdea={(fields) => updateIdea(current.id, currentIdea.key, fields)} onBad={(reason) => { markBad(current, currentIdea, reason); setOpen(null); }} />
      )}
    </div>
  );
}

function IdeaBoard({ cards, filtering, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  const cols = IDEA_STATUSES.filter(([id]) => id !== "queued" && (!filtering || cards.some((c) => c.status === id)));
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-4">
      {cols.map(([id, label, blurb]) => {
        const list = cards.filter((c) => c.status === id).sort((a, b) => a.rank - b.rank || a.client.localeCompare(b.client));
        return (
          <div key={id} onDragOver={(e) => { e.preventDefault(); setOver(id); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); const [rid, key] = String(e.dataTransfer.getData("text/idea") || "").split("|"); if (rid && key) onMove(rid, key, id); setOver(null); }}
            className={`w-72 shrink-0 rounded-xl border p-2 ${over === id ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-50"} ${id === "declined" ? "opacity-60" : ""}`}>
            <div className="flex items-baseline justify-between px-1"><span className="text-sm font-semibold">{label}</span><span className="rounded-full bg-white px-2 text-xs text-zinc-500">{list.length}</span></div>
            <div className="px-1 text-[11px] text-zinc-500">{blurb}</div>
            <div className="mt-2 space-y-2">
              {list.length === 0 && <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-400">Drop here</div>}
              {list.slice(0, 80).map((c) => (
                <div key={`${c.recId}|${c.key}`} draggable onDragStart={(e) => { e.dataTransfer.setData("text/idea", `${c.recId}|${c.key}`); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(c.recId, c.key)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.recId, c.key); }}
                  className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-2.5 text-sm shadow-sm hover:border-zinc-400">
                  <div className="font-medium">{c.client}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${IDEA_KINDS[c.kind]?.tone || "bg-zinc-500"}`}>{IDEA_KINDS[c.kind]?.label || c.kind}</span>
                    {c.ai && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800" title="From AI research on this client">AI</span>}
                    {c.resolved && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800" title="No longer found on the site">Fixed on site</span>}
                  </div>
                  <div className="mt-1 text-zinc-700">{c.title}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">{c.website}{c.manager ? ` · ${c.manager}` : ""}</div>
                </div>
              ))}
              {list.length > 80 && <div className="px-1 text-xs text-zinc-500">{list.length - 80} more; search to narrow down</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IdeaDrawer({ r, idea, onClose, onIdea, onBad }) {
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState((r.emails || [])[0] || "");
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const full = ideaEmail(r, idea, to);
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(idea.subject || "")}&body=${encodeURIComponent(full)}`;
  async function copy() { try { await navigator.clipboard.writeText(`Subject: ${idea.subject || ""}\n\n${full}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  const pocFirst = firstNameOf(String(r.poc || "").split(/\n|,/)[0]);
  const greeting = `${full.split("\n\n")[0]}\n\n${dayGreeting()}`;
  const site = r.website ? `https://${r.website}` : "";
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{r.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {(() => { const sv = idea.service || serviceFor(idea.title); return <span className={`rounded-full px-2 py-0.5 font-semibold text-white ${IDEA_SERVICES[sv] || "bg-zinc-500"}`}>{sv}</span>; })()}
              {isQuickFix(idea) ? <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">Quick fix</span> : idea.size && <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700">{idea.size[0].toUpperCase() + idea.size.slice(1)} project</span>}
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700" title="Estimated hours to deliver">~{hoursFor(idea)} hr{hoursFor(idea) === 1 ? "" : "s"}</span>
              {idea.value && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800" title="Rough budget, for us only; never in the email">{idea.value}</span>}
              {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700">{r.website} <ExternalIcon /></a>}
              {r.manager && <span className="text-zinc-500">Account manager: {r.manager}</span>}
            </div>
          </div>
          <select value={normStatus(idea.status)} onChange={(e) => onIdea({ status: e.target.value, ...(e.target.value === "sent" && !idea.sentAt ? { sentAt: new Date().toISOString(), sentMonth: monthKey() } : {}) })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {IDEA_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto"><div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="font-semibold">{idea.title}</div>
            <p className="mt-0.5 text-sm text-zinc-600">{idea.why}</p>
            {idea.resolved && <p className="mt-1 text-xs text-emerald-700">No longer found on the site at the last check.</p>}
            {idea.evidenceUrl && <a href={idea.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 underline">See what we found <ExternalIcon /></a>}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Email</span>
              <span className="ml-auto flex gap-2">
                <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
                <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy email</>}</button>
                {normStatus(idea.status) === "queued"
                  ? <button onClick={() => onIdea({ status: "sent", sentAt: new Date().toISOString(), sentMonth: monthKey() })} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800">Mark sent</button>
                  : idea.sentAt && <span className="self-center text-xs text-emerald-700">Sent {new Date(idea.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
              </span>
            </div>
            <label className="mt-2 block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">To</div>
              {(r.emails || []).length > 1
                ? <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">{r.emails.map((e) => <option key={e}>{e}</option>)}</select>
                : <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="No email for this client in Settings" className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" />}
            </label>
            {!pocFirst && <p className="mt-1 text-[11px] text-zinc-500">No contact name in Settings → Clients, so the greeting uses the email address or “Hi there”.</p>}
            <label className="mt-2 block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Subject</div>
              <input value={idea.subject || ""} onChange={(e) => onIdea({ subject: e.target.value, edited: true })} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
            <pre className="mt-2 whitespace-pre-wrap rounded-t-md border border-b-0 border-zinc-200 bg-zinc-50 px-2 py-1.5 font-sans text-sm text-zinc-600" title="Written automatically on the day you send">{greeting}</pre>
            <AutoTextarea value={idea.email || ""} onChange={(e) => onIdea({ email: e.target.value, edited: true })} className="w-full rounded-b-md border border-zinc-300 px-2 py-1 text-sm" />
            {idea.edited && <button onClick={() => { const fresh = ideasFor({ ...r, ideas: [] }).find((i) => i.key === idea.key); if (fresh) onIdea({ subject: fresh.subject, email: fresh.email, edited: false }); }} className="mt-1 text-xs text-zinc-500 underline">Restore the app’s draft</button>}
          </div>

          <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes</div>
            <AutoTextarea value={idea.notes || ""} onChange={(e) => onIdea({ notes: e.target.value })} minRows={2} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>

        </div></div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-5 py-3 text-xs shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)]">
          <BadIdea idea={idea} onBad={(reason) => onBad(reason)} />
        </div>
      </div>
    </div>
  );
}

// Free research on your own Claude plan: pick clients, copy the prompt into Claude, paste the reply back.
function ResearchModal({ feedback = [], clients, recs, preset, initialManager = "", onClose, onImport }) {
  const researched = (c) => Object.values(recs).some((r) => r.clientId === c.id && r.ai);
  // Account managers can work through just their own clients.
  const [mgr, setMgr] = useState(initialManager);
  const mgrs = [...new Set(clients.map((c) => c.manager).filter(Boolean))].sort();
  const mine = (c, m = mgr) => !m || c.manager === m;
  const [size, setSize] = useState(5);
  const [picked, setPicked] = useState(() => (preset.length ? preset : clients.filter((c) => mine(c) && !researched(c)).slice(0, 5).map((c) => c.id)));
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const items = picked.map((id) => clients.find((c) => c.id === id)).filter(Boolean).map((c) => {
    const rec = Object.values(recs).find((r) => r.clientId === c.id && r.checkedAt);
    return { id: c.id, name: c.name, websites: c.websites || [], notes: c.notes || "", findings: findingsLine(rec) };
  });
  const prompt = items.length ? researchPrompt(items, feedback) : "";
  async function copy(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  function nextBatch(n, alsoDone = [], m = mgr) { setSize(n); setPicked(clients.filter((c) => mine(c, m) && !researched(c) && !alsoDone.includes(c.id)).slice(0, n).map((c) => c.id)); }
  function doImport() {
    try {
      const list = parseResearchReply(reply);
      if (!list.length) { setMsg("No clients found in the reply. Make sure Claude kept the client_id values."); return; }
      const { clientsDone, ideasAdded, doneIds } = onImport(list);
      setMsg(`Added ${ideasAdded} idea${ideasAdded === 1 ? "" : "s"} for ${clientsDone} client${clientsDone === 1 ? "" : "s"}.${clientsDone < list.length ? ` ${list.length - clientsDone} didn't match a client in Settings.` : ""} The next ${size} are selected.`);
      setReply("");
      nextBatch(size, doneIds);
    } catch (e) { setMsg(e.message); }
  }
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const list = clients.filter((c) => mine(c) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3">
          <h3 className="text-lg font-semibold">Research with Claude</h3>
          <span className="text-xs text-zinc-500">Free on your Claude plan</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">1. Pick clients</span>
              <span className="text-xs text-zinc-500">Next unresearched:</span>
              {[1, 3, 5, 8].map((n) => <button key={n} onClick={() => nextBatch(n)} className={`rounded-full border px-2 py-0.5 text-xs ${size === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{n}</button>)}
              {mgrs.length > 0 && <select value={mgr} onChange={(e) => { setMgr(e.target.value); nextBatch(size, [], e.target.value); }} className="ml-auto rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs"><option value="">All account managers</option>{mgrs.map((m) => <option key={m}>{m}</option>)}</select>}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" className={`${mgrs.length ? "" : "ml-auto "}w-40 rounded-md border border-zinc-300 px-2 py-0.5 text-xs`} />
            </div>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {list.map((c) => (
                <button key={c.id} onClick={() => toggle(c.id)} className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(c.id) ? "border-violet-500 bg-violet-100 text-violet-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{c.name}{researched(c) ? " ✓" : ""}</button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">{picked.length} picked{mgr ? ` from ${mgr}’s ${list.length} clients (${list.filter((c) => !researched(c)).length} still to research)` : ""}. Around 5 at a time works well; ✓ means already researched.</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">2. Run it in Claude</span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => copy(false)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-40">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy prompt</>}</button>
                <button onClick={() => copy(true)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"><ExternalIcon /> Copy and open Claude</button>
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Paste it into a new chat with web search on. Research mode gives the most thorough answers.</p>
            <textarea readOnly value={prompt} rows={6} className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-600" />
          </div>
          <div>
            <span className="font-semibold">3. Paste Claude’s reply</span>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} placeholder="Paste the whole reply here (the JSON block)" className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs" />
            <div className="mt-1 flex items-center gap-2">
              <button onClick={doImport} disabled={!reply.trim()} className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Add ideas</button>
              {msg && <span className="text-xs text-zinc-700">{msg}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// "Bad idea": park it with a reason; the reason teaches future research what to avoid.
function BadIdea({ idea, onBad }) {
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  if (idea.badReason) return <span className="ml-auto text-xs text-red-700">Marked a bad idea: {idea.badReason}</span>;
  if (!asking) return <button onClick={() => setAsking(true)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50">Bad idea</button>;
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && why.trim()) onBad(why.trim()); if (e.key === "Escape") setAsking(false); }} placeholder="Why is it a bad idea? e.g. they already have this, too small for them, not something we offer" className="min-w-0 flex-1 rounded-md border border-red-300 px-2 py-1 text-sm" />
      <button onClick={() => why.trim() && onBad(why.trim())} disabled={!why.trim()} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white disabled:opacity-40">Save</button>
      <button onClick={() => setAsking(false)} className="text-zinc-500">Cancel</button>
    </div>
  );
}
