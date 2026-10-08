"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { StopIcon, RefreshIcon, ExternalIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon } from "@/app/icons";
import { IDEA_STATUSES, IDEA_KINDS, ideasFor, ideaEmail } from "@/lib/clientIdeas";
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

  useEffect(() => {
    const local = load();
    recsRef.current = local;
    setTimeout(() => setRecs(local), 0);
    fetch("/api/results?kind=ideas").then((r) => r.json()).then((j) => {
      if (!j.shared) return;
      sharedRef.current = true;
      const next = { ...recsRef.current };
      for (const [id, v] of Object.entries(j.results || {})) if (!next[id] || String(v.updatedAt || "") >= String(next[id].updatedAt || "")) next[id] = v;
      recsRef.current = next; save(next); setRecs(next);
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
    rec.ideas = ideasFor(rec, prev.ideas || []);
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
      try { const r = await checkOne(c, w, st); st.found += (r.ideas || []).filter((i) => i.status === "idea").length; } catch (e) { st.errors.push(`${c.name}: ${e.message}`); }
      st.done++; setRun({ ...st });
    }
    st.phase = stopRef.current ? `Stopped: ${st.done} of ${st.total} client sites checked` : `Done: ${st.done} client site${st.done === 1 ? "" : "s"} checked, ${st.found} new idea${st.found === 1 ? "" : "s"}${jobs.length ? "" : " (all checked in the last 30 days; use Re-check all to force)"}`;
    setRun({ ...st }); onRunning?.(false);
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
  const openCount = cards.filter((c) => ["idea", "shortlist", "ready"].includes(c.status)).length;
  useEffect(() => { onCount?.(openCount); }, [openCount, onCount]);
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
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search clients or ideas" className="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">All kinds</option>
          {Object.entries(IDEA_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="text-xs text-zinc-500">{shown.length} of {cards.length} ideas · drag a card to change its status</span>
      </div>

      <IdeaBoard cards={shown} filtering={!!(q || kind)} onOpen={(id, key) => setOpen({ id, key })} onMove={(id, key, status) => updateIdea(id, key, { status })} />

      {current && currentIdea && (
        <IdeaDrawer r={current} idea={currentIdea} onClose={() => setOpen(null)} onIdea={(fields) => updateIdea(current.id, currentIdea.key, fields)} onPick={(key) => setOpen({ id: current.id, key })} onRecord={(fields) => update(current.id, fields)} onRecheck={() => recheckOne(current.id)} running={running} />
      )}
    </div>
  );
}

function IdeaBoard({ cards, filtering, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  const cols = IDEA_STATUSES.filter(([id]) => !filtering || cards.some((c) => c.status === id));
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-4">
      {cols.map(([id, label, blurb]) => {
        const list = cards.filter((c) => c.status === id).sort((a, b) => a.rank - b.rank || a.client.localeCompare(b.client));
        return (
          <div key={id} onDragOver={(e) => { e.preventDefault(); setOver(id); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); const [rid, key] = String(e.dataTransfer.getData("text/idea") || "").split("|"); if (rid && key) onMove(rid, key, id); setOver(null); }}
            className={`w-72 shrink-0 rounded-xl border p-2 ${over === id ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-50"} ${id === "not-now" ? "opacity-60" : ""}`}>
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

function IdeaDrawer({ r, idea, onClose, onIdea, onPick, onRecord, onRecheck, running }) {
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState((r.emails || [])[0] || "");
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const full = ideaEmail(r, idea, to);
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(idea.subject || "")}&body=${encodeURIComponent(full)}`;
  async function copy() { try { await navigator.clipboard.writeText(`Subject: ${idea.subject || ""}\n\n${full}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  const pocFirst = firstNameOf(String(r.poc || "").split(/\n|,/)[0]);
  const greeting = `${full.split("\n\n")[0]}\n\n${dayGreeting()}`;
  const others = (r.ideas || []).filter((i) => i.key !== idea.key);
  const site = r.website ? `https://${r.website}` : "";
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{r.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-semibold text-white ${IDEA_KINDS[idea.kind]?.tone || "bg-zinc-500"}`}>{IDEA_KINDS[idea.kind]?.label || idea.kind}</span>
              {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700">{r.website} <ExternalIcon /></a>}
              {r.manager && <span className="text-zinc-500">Account manager: {r.manager}</span>}
            </div>
          </div>
          <select value={idea.status} onChange={(e) => onIdea({ status: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {IDEA_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto"><div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="font-semibold">{idea.title}</div>
            <p className="mt-0.5 text-sm text-zinc-600">{idea.why}</p>
            {idea.resolved && <p className="mt-1 text-xs text-emerald-700">No longer found on the site at the last check.</p>}
          </div>

          {others.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Other ideas for {r.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{others.map((i) => <button key={i.key} onClick={() => onPick(i.key)} className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100">{i.title} <span className="text-zinc-400">· {IDEA_STATUSES.find(([id]) => id === i.status)?.[1]}</span></button>)}</div>
            </div>
          )}

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Email</span>
              <span className="ml-auto flex gap-2">
                <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
                <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy email</>}</button>
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

          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <div className="font-semibold">Search ranking</div>
            {r.seo?.searches?.find((x) => x.kind === "trade")
              ? (() => { const t = r.seo.searches.find((x) => x.kind === "trade"); return <p className="mt-1 text-zinc-700">“{t.query}”: <span className="font-semibold">{t.error ? t.error : t.position ? `#${t.position}` : "not on page 1"}</span>{t.ahead?.length ? <span className="text-zinc-500"> · behind {t.ahead.join(", ")}</span> : null} <a href={`https://www.google.com/search?q=${encodeURIComponent(t.query)}`} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">check on Google</a></p>; })()
              : <p className="mt-1 text-xs text-zinc-500">{r.searchNote || "Not searched yet."}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              <label className="inline-flex items-center gap-1">searching for <input key={`t:${r.id}:${r.tradeOverride || r.searchTrade || ""}`} defaultValue={r.tradeOverride || r.searchTrade || ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.tradeOverride || r.searchTrade || "")) onRecord({ tradeOverride: v }); }} placeholder="e.g. trophy shop" className="w-40 rounded border border-zinc-300 px-1.5 py-0.5" /></label>
              <label className="inline-flex items-center gap-1">in <input key={`w:${r.id}:${r.townOverride || r.searchTown || ""}`} defaultValue={r.townOverride || r.searchTown || ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.townOverride || r.searchTown || "")) onRecord({ townOverride: v }); }} placeholder="town" className="w-32 rounded border border-zinc-300 px-1.5 py-0.5" /></label>
              <span className="text-zinc-400">used on the next re-check</span>
            </div>
          </div>
        </div></div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-5 py-3 text-xs shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)]">
          <button onClick={onRecheck} disabled={running || r.checking} className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" /> Re-check this client</button>
          {r.checking && <span className="inline-flex items-center gap-1 text-blue-700"><SpinnerIcon className="h-3.5 w-3.5" /> Working…</span>}
          {r.checkedAt && !r.checking && <span className="text-zinc-500">Checked {new Date(r.checkedAt).toLocaleDateString("en-GB")}</span>}
          <button onClick={() => onIdea({ status: "not-now" })} className="ml-auto rounded-md px-2 py-1 text-zinc-500 hover:text-zinc-900">Not now</button>
        </div>
      </div>
    </div>
  );
}
