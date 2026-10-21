"use client";

import { mailHref } from "@/app/mail";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { StopIcon, RefreshIcon, ExternalIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon, TrashIcon } from "@/app/icons";
import { useClaudeHandler, useClaudeJob, openClaude, markSent, sentIds, PasteHint, withTitle, ClaudeText } from "@/app/claudeInbox";
import { ProposalModal } from "@/app/proposal";
import { setEmailTemplates, staleFooterYear } from "@/lib/leadsShared";
import { IDEA_STATUSES, IDEA_KINDS, ideasFor, ideaEmail, researchPrompt, parseResearchReply, findingsLine, IDEAS_VERSION, normStatus, monthKey, monthName, clientQueue, monthlyPick, topIdeas, IDEA_SERVICES, serviceFor, hoursFor, isQuickFix, customIdea, IDEA_GREETING, internalTasks, builtByFor, iclServerIps, ideaType, supportEmail, PLANS, checkIdeasPrompt, slug, parseIdeaCheck } from "@/lib/clientIdeas";

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

// A job for the support team: an email to support@ with the client, the site and what needs fixing.
function supportHref(r, it) {
  const site = r?.website ? `https://${r.website}` : "";
  const body = [`Client: ${r?.name || ""}`, site && `Website: ${site}`, r?.manager && `Account manager: ${r.manager}`, "", `What needs fixing: ${it.title}`, it.why && `Details: ${it.why}`, it.page && `Page: ${it.page}`, "", "Found by ICL Sales client checks."].filter((x) => x !== false && x !== undefined && x !== null).join("\n");
  return mailHref("support@icldigital.com", `${r?.name || "Client"}: ${it.title}`, body);
}
// Who the idea came from: Claude or the automatic checks ("AI"), or ICL's own list and your team ("ICL").
const ideaSource = (i) => (i.ai || i.internal || ideaType(i) === "fix" ? "AI" : "ICL");

export default function IdeasArea({ clients = [], onRunning, onCount, onClientsChange }) {
  const [recs, setRecs] = useState({});
  const recsRef = useRef({});
  const sharedRef = useRef(false);
  const [run, setRun] = useState(null);
  const stopRef = useRef(false);
  const [open, setOpenState] = useState(null); // { id, key }
  // Every idea has its own address (?tab=client-ideas&idea=site~key).
  const setOpen = (o) => {
    setOpenState(o);
    try {
      const u = new URL(window.location.href);
      const v = o ? `${o.id}~${o.key}` : null;
      if ((u.searchParams.get("idea") || null) === v) return;
      if (v) { u.searchParams.set("tab", "client-ideas"); u.searchParams.set("idea", v); } else u.searchParams.delete("idea");
      window.history.pushState({}, "", u.search);
    } catch {}
  };
  const fromUrl = () => { const v = new URLSearchParams(window.location.search).get("idea"); if (!v) return null; const i = v.lastIndexOf("~"); return i > 0 ? { id: v.slice(0, i), key: v.slice(i + 1) } : null; };
  useEffect(() => {
    const onPop = () => setOpenState(fromUrl());
    window.addEventListener("popstate", onPop);
    const t = setTimeout(() => { const o = fromUrl(); if (o) setOpenState(o); }, 600);
    return () => { window.removeEventListener("popstate", onPop); clearTimeout(t); };
  }, []);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("");
  const [cfg, setCfg] = useState(null); // { ai, aiUsage }
  const [withAi, setWithAi] = useState(true);
  const view = "top"; // one table now; the All ideas and Replies views were retired
  const [manager, setManager] = useState("");
  const [service, setService] = useState("");
  const [size, setSize] = useState(""); // "" all, or large / medium / small
  const [showHidden, setShowHidden] = useState(false);
  // Taking a client off Client Ideas keeps them in Settings (launch checks still use them).
  const hideClient = (id, hidden) => onClientsChange?.(clients.map((c) => (c.id === id ? { ...c, ideasHidden: hidden } : c)));
  const pinClient = (id, pinned) => onClientsChange?.(clients.map((c) => (c.id === id ? { ...c, ideasPinned: pinned } : c)));
  // Only ideas big enough to be worth pitching: over this many hours (0 = any size).
  const [minHours, setMinHoursState] = useState(() => { try { return Number(localStorage.getItem("flc-ideas-min-hours") || 0) || 0; } catch { return 0; } });
  const setMinHours = (v) => { setMinHoursState(v); try { localStorage.setItem("flc-ideas-min-hours", String(v)); } catch {} };
  const [addFor, setAddFor] = useState(null); // the client group an idea is being added to
  const [deckFor, setDeckFor] = useState(null); // the client group a proposal deck is being made for
  // Feedback on bad ideas, shared with the team: fed into research prompts, and repeat offenders drop out of the top 3.
  const [feedback, setFeedback] = useState([]);
  const feedbackRef = useRef([]);
  useEffect(() => { fetch("/api/settings?key=idea-feedback").then((r) => r.json()).then((j) => { const items = Array.isArray(j.value) ? j.value : Array.isArray(j.value?.items) ? j.value.items : null; if (j.shared && items) { feedbackRef.current = items; setFeedback(items); } }).catch(() => {}); }, []);
  // A custom idea goes on the client's first site record (or a new one if they have none yet), top of the queue.
  function addIdea(g, data) {
    const c = clients.find((x) => x.id === g.clientId) || { id: g.clientId, name: g.name, manager: g.manager, emails: [], poc: "" };
    const rec = g.recs[0] || { id: recId(c, (c.websites || [])[0] || "none"), website: host((c.websites || [])[0] || ""), clientId: c.id, name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [], ideas: [] };
    const minP = Math.min(0, ...g.queue.map((i) => (Number.isFinite(i.priority) ? i.priority : 0)));
    update(rec.id, { ...rec, ideas: [...(rec.ideas || []), customIdea(data, minP - 1)], ideasVersion: rec.ideasVersion || IDEAS_VERSION });
  }
  function markBad(rec, idea, reason) {
    updateIdea(rec.id, idea.key, { status: "declined", badReason: reason, statusAt: new Date().toISOString() });
    const entry = { at: new Date().toISOString(), client: rec.name, title: idea.title, service: idea.service || serviceFor(idea.title), key: idea.ai ? "" : idea.key, reason };
    const next = [entry, ...feedbackRef.current].slice(0, 200);
    feedbackRef.current = next; setFeedback(next);
    fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "idea-feedback", value: { items: next } }) }).catch(() => {}); // the store takes objects, not lists
  }
  // Every "bad idea" mark: the shared list, plus any declined idea with a reason (so nothing is lost if the list wasn't saved).
  const seenBad = new Set(feedback.map((f) => `${f.client}|${f.title}`));
  const allFeedback = [...feedback, ...Object.values(recs).flatMap((r) => (r.ideas || []).filter((i) => i.status === "declined" && i.badReason && !seenBad.has(`${r.name}|${i.title}`)).map((i) => ({ at: i.statusAt || "", client: r.name, title: i.title, service: i.service || serviceFor(i.title), key: i.ai ? "" : i.key, reason: i.badReason })))];
  const badRuleKeys = new Set(Object.entries(allFeedback.reduce((m, f) => { if (f.key) m[f.key] = (m[f.key] || 0) + 1; return m; }, {})).filter(([, n]) => n >= 2).map(([k]) => k)); // null = closed, [] = next batch, [clientId] = that client
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

  // Closing paragraph (and other wording) from Settings → Email templates.
  useEffect(() => { fetch("/api/settings?key=email-templates").then((r) => r.json()).then((j) => { if (j.shared && j.value) setEmailTemplates(j.value); }).catch(() => {}); }, []);
  const update = (id, fields) => {
    const prev = recsRef.current[id] || {};
    const now = new Date().toISOString();
    const r = { ...prev, ...fields, id, updatedAt: now, edits: { ...(prev.edits || {}), ...Object.fromEntries(Object.keys(fields).filter((k) => k !== "edits").map((k) => [k, now])) } };
    const next = { ...recsRef.current, [id]: r };
    recsRef.current = next; save(next); setRecs(next);
    if (sharedRef.current) fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ideas", site: id, data: r }) }).catch(() => {});
  };
  // A Cookie Consent scan of a client site feeds its ideas: a consent fix, a banner, or analytics to set up.
  useEffect(() => {
    const on = (e) => {
      const { site, status, summary, ticket } = e.detail || {};
      const SIG = { GAP: { analytics: true, consent: true, consentGap: { summary, ticket } }, NO_BANNER: { analytics: true, consent: false, consentGap: null }, NO_TRACKING: { analytics: false, consentGap: null }, OK: { analytics: true, consent: true, consentGap: null } }[status];
      if (!SIG) return;
      const bare = (w) => String(w || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      for (const r of Object.values(recsRef.current)) {
        // Only sites already checked here: the other idea rules need the rest of the homepage signals.
        if (bare(r.website) !== site || !r.signals) continue;
        const signals = { ...r.signals, ...SIG };
        if (JSON.stringify(signals) === JSON.stringify(r.signals)) continue;
        update(r.id, { signals, ideas: ideasFor({ ...r, signals }, r.ideas || []) });
      }
    };
    window.addEventListener("consent-result", on);
    return () => window.removeEventListener("consent-result", on);
  });
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
    let rec = { ...prev, ...site, clientId: c.id, name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [], plan: c.plan || "", firstCheckedAt: prev.firstCheckedAt || (prev.checkedAt ? "" : new Date().toISOString()) };
    const alive = site.problem !== "Dead/broken site" && site.problem !== "Parked domain";
    if (alive && !stopRef.current) { st.phase = `Checking licences on ${host(w)}…`; setRun({ ...st }); try { const l = await post({ step: "licence", website: w }); rec.licence = l.licence; } catch {} }
    // AI research: who they really are and what would help them, from the web plus our findings.
    if (cfg?.ai && withAi && !stopRef.current) {
      st.phase = `Researching ${c.name} with AI…`; setRun({ ...st });
      const t = rec.seo?.searches?.find((x) => x.kind === "trade");
      const findings = { problem: rec.problem || "", detail: rec.problemDetail || "", platform: rec.platform || "", footerYear: staleFooterYear(rec.year), signals: rec.signals || null,
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

  async function checkAll(force = false, onlyNew = false) {
    stopRef.current = false; onRunning?.(true);
    const jobs = clients.flatMap((c) => (c.websites || []).map((w) => [c, w])).filter(([c, w]) => (onlyNew ? !recsRef.current[recId(c, w)]?.checkedAt : force || daysAgo(recsRef.current[recId(c, w)]?.checkedAt) > RECHECK_DAYS));
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
        // Claude was asked not to repeat ideas it checked, so earlier researched ideas stay unless it dropped them.
        const dropped = new Set((it.checked || []).filter((x) => x.verdict === "drop").map((x) => x.key));
        const fresh = new Set((it.ideas || []).map((a) => `ai:${slug(a.title)}`));
        const kept = (prev.ai?.ideas || []).filter((a) => !dropped.has(`ai:${slug(a.title)}`) && !fresh.has(`ai:${slug(a.title)}`));
        const rec = { ...prev, clientId: c.id, name: c.name, manager: c.manager || "", poc: c.poc || "", emails: c.emails || [], ai: { ...it, ideas: [...(it.ideas || []), ...kept] }, aiError: "" };
        rec.ideas = ideasFor(rec, prev.ideas || []);
        // Claude's verdict on the ideas we already had: keep (with its check mark) or drop.
        const verdict = new Map((it.checked || []).map((c) => [c.key, c]));
        rec.ideas = rec.ideas.map((i) => { const v = verdict.get(i.key); if (!v) return i; const claudeCheck = { at: new Date().toISOString(), verdict: v.verdict, type: v.type, hours: v.hours, reason: v.reason };
          return v.verdict === "drop" ? { ...i, claudeCheck, ...(i.status === "queued" ? { status: "declined", statusAt: claudeCheck.at } : {}) } : { ...i, claudeCheck }; });
        rec.ideasVersion = IDEAS_VERSION;
        ideasAdded += rec.ideas.filter((i) => i.ai && !(prev.ideas || []).some((p) => p.key === i.key)).length;
        update(id, rec);
      }
      clientsDone++; doneIds.push(c.id);
    }
    return { clientsDone, ideasAdded, doneIds };
  }
  // The research prompt lives in the one Claude window at the top of the page.
  useClaudeJob("client-research", { label: "Client research", order: 5, count: () => clients.filter((c) => !Object.values(recs).some((r) => r.clientId === c.id && r.ai)).length, render: (o, close) => <ResearchModal feedback={allFeedback} clients={clients} recs={recs} preset={o.preset || []} initialManager={manager} onClose={close} onImport={importResearch} /> });
  // Research replies pasted into the one "Paste from Claude" box land here.
  useClaudeHandler("client-research", (text) => {
    const list = parseResearchReply(text);
    if (!list.length) throw new Error("No clients in that reply. Make sure Claude kept the client_id values.");
    const r = importResearch(list);
    return `${r.ideasAdded} idea${r.ideasAdded === 1 ? "" : "s"} added for ${r.clientsDone} client${r.clientsDone === 1 ? "" : "s"}${r.clientsDone < list.length ? `; ${list.length - r.clientsDone} didn't match a client in Settings` : ""}.`;
  });
  async function recheckOne(id) {
    const r = recsRef.current[id]; const c = clients.find((x) => x.id === r?.clientId) || { id: r?.clientId, name: r?.name, emails: r?.emails, poc: r?.poc, manager: r?.manager };
    stopRef.current = false; onRunning?.(true);
    const st = { phase: "", done: 0, total: 1, found: 0, errors: [] };
    update(id, { checking: true });
    try { await checkOne(c, r.website, st); st.phase = `Done: ${c.name} re-checked`; } catch (e) { st.phase = `Done: ${e.message}`; }
    update(id, { checking: false }); setRun({ ...st }); onRunning?.(false);
  }

  // The wrong website on a client: swap it in Settings, drop the old site's ideas, check the new one, then open Claude research for them.
  async function changeSite(g, oldSite, next) {
    const c = clients.find((x) => x.id === g.clientId); if (!c) return;
    const url = String(next || "").trim(); if (!url || host(url) === host(oldSite)) return;
    const websites = [...new Set([...(c.websites || []).filter((w) => host(w) !== host(oldSite)), url])];
    const nc = { ...c, websites };
    onClientsChange?.(clients.map((x) => (x.id === c.id ? nc : x)));
    const oldId = recId(c, oldSite);
    if (recsRef.current[oldId]) { const nextRecs = { ...recsRef.current }; delete nextRecs[oldId]; recsRef.current = nextRecs; save(nextRecs); setRecs(nextRecs); if (sharedRef.current) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ideas", site: oldId }) }).catch(() => {}); }
    stopRef.current = false; onRunning?.(true);
    const st = { phase: `Checking ${host(url)}…`, done: 0, total: 1, found: 0, errors: [] }; setRun({ ...st });
    try { await checkOne(nc, url, st); st.phase = `Done: ${c.name} now checked on ${host(url)}. Run Client research in the Claude window for new ideas.`; } catch (e) { st.phase = `Couldn't check ${host(url)}: ${e.message}`; }
    st.done = 1; setRun({ ...st }); onRunning?.(false);
    openClaude({ job: "client-research", preset: [c.id] });
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
  // Ideas for a client deleted in Settings drop out of view (the record is kept in case the client is re-added).
  // A site taken off the client (or replaced) in Settings drops out with its ideas.
  const onClientSite = (c, r) => !r.website || !(c.websites || []).length || (c.websites || []).some((w) => host(w) === host(r.website));
  const liveRecs = clients.length ? Object.values(recs).filter((r) => clients.some((c) => (c.id === r.clientId || (!r.clientId && c.name === r.name)) && onClientSite(c, r))) : Object.values(recs);
  const cards = liveRecs.flatMap((r) => (r.ideas || []).map((i) => ({ ...i, recId: r.id, client: r.name, website: r.website, manager: r.manager })));
  const q = filter.trim().toLowerCase();
  const shown = cards.filter((c) => (!kind || c.kind === kind) && (!q || `${c.client} ${c.website} ${c.title} ${c.manager}`.toLowerCase().includes(q)));
  // Group by client for the monthly send-out.
  const byClient = new Map();
  for (const r of liveRecs) { const k = r.clientId || r.name; if (!byClient.has(k)) byClient.set(k, { clientId: r.clientId, name: r.name, manager: r.manager || "", recs: [] }); byClient.get(k).recs.push(r); }
  const iclIps = iclServerIps(Object.values(recs));
  // When a client was first checked, if that was in the last 7 days ("" otherwise).
  // Sites checked before this was recorded: their earliest idea tells when they first came in.
  const firstSeen = (r) => r.firstCheckedAt || (r.ideas || []).map((i) => i.foundAt || "").filter(Boolean).sort()[0] || "";
  const newSince = (g) => g.recs.map(firstSeen).filter((t) => t && Date.now() - Date.parse(t) < 7 * 86400000).sort().pop() || "";
  const groups = [...byClient.values()].map((g) => {
    const client = clients.find((c) => c.id === g.clientId) || { name: g.name };
    const bb = builtByFor(client, g.recs, iclIps);
    // Developer jobs (fixes on sites we built, our own checks failing) sit in the client's list with the rest, marked AI Idea.
    const ours = bb.value !== "not";
    const queue = [...clientQueue(g.recs), ...internalTasks(g.recs)];
    // Developer jobs show whatever their size (the big-ideas list leaves small ones out).
    const devJob = (i) => i.status === "queued" && (i.internal || (ours && ideaType(i) === "fix"));
    const jobs = queue.filter((i) => devJob(i) && (!service || service === "★" ? service !== "★" || i.starred : (i.service || serviceFor(i.title)) === service));
    return { ...g, client, bb, ours, queue, top: [...(size ? [] : jobs), ...topIdeas(queue.filter((i) => !devJob(i) && !badRuleKeys.has(i.key) && (!minHours || hoursFor(i) > minHours) && (service !== "★" || i.starred) && (!size || (i.size || "small") === size)), 50, service === "★" ? "" : service, { withSmall: !size || size === "small" })], pick: monthlyPick(queue, month) }; })
    .filter((g) => !!g.client?.ideasHidden === (showHidden && clients.some((c) => c.ideasHidden)))
    // Search: a client whose name (or AM, or website) matches shows all its ideas; otherwise only the ideas that match.
    .map((g) => (!q || `${g.name} ${g.manager} ${g.recs.map((r) => r.website).join(" ")}`.toLowerCase().includes(q) ? g : { ...g, top: g.top.filter((i) => `${i.title} ${i.why || ""} ${i.service || ""}`.toLowerCase().includes(q)) }))
    .filter((g) => g.queue.length && (!manager || g.manager === manager) && (!q || g.top.length))
    .filter((g) => !service || g.top.length)
    // Pinned clients first, then ones first checked in the last week (newest first), then A to Z.
    .sort((a, b) => (b.client?.ideasPinned ? 1 : 0) - (a.client?.ideasPinned ? 1 : 0) || String(newSince(b)).localeCompare(String(newSince(a))) || a.name.localeCompare(b.name));
  const starCount = [...byClient.values()].reduce((n, g) => n + clientQueue(g.recs).filter((i) => i.starred && !["declined", "done"].includes(i.status)).length, 0);
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
  const current = open ? recs[open.id] : null;
  const currentIdea = current ? (current.ideas || []).find((i) => i.key === open.key) : null;
  // A second opinion on the ideas in view (filters apply): bugs for support, medium ideas worth pitching, the rest dropped.
  // Ideas Claude has already checked are left out, so each run only covers what's new.
  const checkGroups = groups.map((g) => ({ ...g, top: g.top.filter((i) => !i.claudeCheck) })).filter((g) => g.top.length);
  // Claude's "Check ideas" reply: each idea kept as a bug or a pitch (with its check mark and hours) or dropped, plus anything new it spotted.
  useClaudeHandler("check-ideas", (text) => {
    const { checks, added } = parseIdeaCheck(text);
    if (!checks.length && !added.length) throw new Error("No ideas in that reply. Paste Claude's whole JSON block.");
    const at = new Date().toISOString(), byRec = new Map();
    for (const c of checks) { if (!byRec.has(c.recId)) byRec.set(c.recId, []); byRec.get(c.recId).push(c); }
    let kept = 0, dropped = 0, fresh = 0;
    for (const [rid, list] of byRec) {
      const r = recsRef.current[rid]; if (!r) continue;
      const by = new Map(list.map((c) => [c.key, c]));
      const ideas = (r.ideas || []).map((i) => { const c = by.get(i.key); if (!c) return i;
        const claudeCheck = { at, verdict: c.verdict === "drop" ? "drop" : "keep", type: c.verdict === "bug" ? "bug" : "idea", hours: c.hours, reason: c.reason, page: c.page, fix: c.fix };
        if (c.verdict === "drop") { dropped++; return { ...i, claudeCheck, ...(i.status === "queued" ? { status: "declined", statusAt: at } : {}) }; }
        kept++; return { ...i, claudeCheck, type: c.verdict === "bug" ? "fix" : "idea", ...(c.hours ? { hours: c.hours } : {}), ...(c.page && !i.evidenceUrl ? { evidenceUrl: c.page } : {}) }; });
      update(rid, { ideas });
    }
    for (const n of added) {
      const r = recsRef.current[n.recId] || Object.values(recsRef.current).find((x) => x.name === n.recId); if (!r) continue;
      const idea = { ...customIdea({ title: n.title, service: n.service, hours: n.hours || undefined, why: n.reason }), type: n.verdict === "bug" ? "fix" : "idea", evidenceUrl: n.page, claudeCheck: { at, verdict: "keep", type: n.verdict === "bug" ? "bug" : "idea", hours: n.hours, reason: n.reason, page: n.page } };
      update(r.id, { ideas: [...(r.ideas || []), idea] }); fresh++;
    }
    return `Idea check: ${kept} kept, ${dropped} dropped${fresh ? `, ${fresh} new` : ""}`;
  });
  useClaudeJob("check-ideas", { label: "Check ideas", order: 6, count: () => checkGroups.length, render: () => <CheckIdeasPanel groups={checkGroups} /> });

  return (
    <div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Client Ideas</h2>
        {!clients.length && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">No clients yet. Add them in <Link href="/settings?section=clients" className="underline">Settings → Clients</Link>.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {running
            ? <button onClick={() => { stopRef.current = true; }} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
            : <button onClick={() => checkAll(false)} disabled={!sitesTotal} title="Checks every client website not checked in the last 30 days" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Find ideas</button>}
          {/* Clients (or websites) added since the last check: one click to check just those. */}
          {!running && sitesTotal > sitesChecked && <button onClick={() => checkAll(false, true)} title="Checks only the client websites never checked yet" className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"><SearchIcon className="h-4 w-4" /> Check {sitesTotal - sitesChecked} new</button>}
          <button onClick={() => checkAll(true)} disabled={running || !sitesTotal} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-4 w-4" /> Re-check all</button>
          <button onClick={() => openClaude({ job: "check-ideas" })} title="A prompt asking Claude to check the ideas in view are accurate and worth doing: bugs go to support, medium ideas stay" className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-4 py-2 text-sm text-orange-900 hover:bg-orange-100">Check ideas with Claude</button>
          {cfg?.ai
            ? <label className="inline-flex items-center gap-1.5 text-sm text-zinc-700" title="Claude researches each client on the web (what they really do, where, competitors, whether the website on file is theirs) and writes ideas specific to them. Roughly 20-40p per client."><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} disabled={running} /> AI research <span className="text-xs text-zinc-400">{cfg.aiUsage?.used || 0} of {cfg.aiUsage?.cap || 0} this month</span></label>
            : null}
          <span className="text-xs text-zinc-500">{sitesChecked} of {sitesTotal} client sites checked</span>
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
        {managers.length > 0 && <select value={manager} onChange={(e) => setManager(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"><option value="">All account managers</option>{managers.map((m) => <option key={m}>{m}</option>)}</select>}
        <select value={size} onChange={(e) => setSize(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"><option value="">All ideas</option><option value="large">Big ideas</option><option value="medium">Medium ideas</option><option value="small">Small ideas</option></select>
        {clients.some((c) => c.ideasHidden) && (() => { const n = clients.filter((c) => c.ideasHidden).length, label = showHidden ? "Hide removed clients" : `Show ${n} removed client${n === 1 ? "" : "s"}`; return (
          <button onClick={() => setShowHidden((v) => !v)} aria-label={label} aria-pressed={showHidden} title={label} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm ${showHidden ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">{showHidden
              ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
              : <><path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M2 2l20 20" /></>}</svg>
            <span className="text-xs">{n}</span>
          </button>); })()}
        {manager && (() => {
          // One email to the account manager with every idea (as filtered) for each of their clients.
          const mine = groups.filter((g) => g.manager === manager && g.top.length);
          const first = manager.split(" ")[0];
          const body = `Hi ${first},\n\nHere are the ideas for your clients${size ? ` (${{ large: "big", medium: "medium", small: "small" }[size]} ideas)` : ""}:\n\n${mine.map((g) => `${g.name}${(g.recs.find((x) => x.website) || {}).website ? ` (${(g.recs.find((x) => x.website) || {}).website})` : ""}\n${g.top.map((i) => `- ${i.title} (${i.service || serviceFor(i.title)}, ~${hoursFor(i)} hrs${i.value ? `, ${i.value}` : ""})`).join("\n")}`).join("\n\n")}\n\nLet me know which ones you'd like to take forward.`;
          return <a href={mailHref("", `Client ideas for your clients (${mine.length})`, body)} target="_blank" rel="noopener" title={`Opens Outlook with every idea for ${manager}'s ${mine.length} client${mine.length === 1 ? "" : "s"}`} className={`inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 ${mine.length ? "" : "pointer-events-none opacity-40"}`}><MailIcon className="h-4 w-4" /> Create email ({mine.length} client{mine.length === 1 ? "" : "s"})</a>;
        })()}
        {view === "replies" && <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"><option value="">All kinds</option>{Object.entries(IDEA_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}
      </div>

      {view === "top" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setService("")} className={`rounded-full border px-3 py-1 text-xs font-medium ${!service ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>All services</button>
          {starCount > 0 && <button onClick={() => setService(service === "★" ? "" : "★")} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${service === "★" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>★ Starred <span className="opacity-70">{starCount}</span></button>}
          {Object.keys(IDEA_SERVICES).filter((k) => serviceCounts[k]).map((k) => (
            <button key={k} onClick={() => setService(service === k ? "" : k)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${service === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}><span className={`h-2 w-2 rounded-full ${IDEA_SERVICES[k]}`} />{k}<span className="opacity-60">{serviceCounts[k]}</span></button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-600" title="Hide ideas that would take this many hours or fewer">Over
            <select value={minHours} onChange={(e) => setMinHours(Number(e.target.value))} className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs">
              {[0, 4, 8, 16, 24, 40].map((h) => <option key={h} value={h}>{h ? `${h} hours` : "any hours"}</option>)}
            </select>
          </label>
        </div>
      )}
      {view === "top" && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500"><th className="w-52 px-4 py-2 font-semibold">Client</th><th className="px-3 py-2 font-semibold">{service === "★" ? "Starred ideas" : service ? `${service} ideas` : ""}</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {groups.length === 0 && <tr><td colSpan={2} className="p-4 text-zinc-500">No ideas yet. Use the Claude button at the top: Client research.</td></tr>}
              {groups.map((g) => (
                <tr key={g.clientId || g.name} className="align-top">
                  <td className="px-4 py-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1 font-medium">{g.name}{newSince(g) && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-blue-800" title="Added and checked in the last 7 days">New</span>}</div>{g.clientId && (g.client?.ideasHidden
                    ? <button onClick={() => hideClient(g.clientId, false)} title="Put this client back on Client Ideas" className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50">Restore</button>
                    : <><button onClick={() => pinClient(g.clientId, !g.client?.ideasPinned)} aria-label={g.client?.ideasPinned ? `Unpin ${g.name}` : `Pin ${g.name} to the top`} aria-pressed={!!g.client?.ideasPinned} title={g.client?.ideasPinned ? "Pinned to the top: click to unpin" : "Pin to the top"} className={`shrink-0 rounded p-1 hover:bg-zinc-100 ${g.client?.ideasPinned ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-900"}`}><PinIcon filled={!!g.client?.ideasPinned} /></button>
                      <button onClick={() => { if (window.confirm(`Remove ${g.name} from Client Ideas? They stay in Settings, and you can restore them from "Removed clients".`)) hideClient(g.clientId, true); }} aria-label={`Remove ${g.name} from Client Ideas`} title="Remove from Client Ideas" className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button></>)}</div>{(() => { const w = (g.recs.find((x) => x.website) || {}).website; return <span className="inline-flex items-center gap-1 text-[11px]">{w && <a href={`https://${w}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">{w} <ExternalIcon /></a>}{g.clientId && <button onClick={() => { const v = window.prompt(`${g.name}: the right website address`, w ? `https://${w}` : "https://"); if (v) changeSite(g, w || "", v); }} title="Wrong website? Change it here: the old site's ideas are dropped, the new one is checked and Claude research opens" className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">{w ? "edit" : "+ website"}</button>}</span>; })()}<div className="text-[11px] text-zinc-500">{g.manager || "No account manager"}</div><div className="mt-1.5 flex flex-wrap items-center gap-1"><button onClick={() => setAddFor(g)} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100">+ Add idea</button><button onClick={() => setDeckFor(g)} title="Make a proposal slide deck: pick ideas, add your own, Claude writes it, download the .pptx" className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-zinc-700">Proposal deck</button><button onClick={() => openClaude({ job: "client-research", preset: [g.clientId] })} title="A Claude prompt for just this client: new ideas, and a check of the ones already here" className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-orange-700">Claude</button></div></td>
                  <td className="max-w-0 px-3 py-3">
                  <div className="grid snap-x auto-cols-[calc((100%-2.25rem)/3.2)] grid-flow-col gap-3 overflow-x-auto pb-1">
                  {g.top.length === 0 && <div className="text-xs text-zinc-400">No big ideas yet.</div>}
                  {g.top.map((it, n) => {
                    const r = g.recs.find((x) => x.id === it.recId) || g.recs[0]; const to = (r?.emails || [])[0] || "";
                    const href = mailHref(to, it.subject || "", ideaEmail(r, it, to));
                    return (
                      <div key={`${it.recId}|${it.key}`} onClick={() => setOpen({ id: it.recId, key: it.key })} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen({ id: it.recId, key: it.key }); }} className={`relative cursor-pointer snap-start rounded-lg border p-2.5 pr-8 hover:border-zinc-400 hover:bg-zinc-50 ${it.starred ? "border-amber-300 bg-amber-50/40" : "border-zinc-200"}`}>
                        <button onClick={(e) => { e.stopPropagation(); updateIdea(it.recId, it.key, { starred: !it.starred }); }} aria-label={it.starred ? "Unstar" : "Star this idea"} title={it.starred ? "Starred: kept at the front. Click to unstar" : "Star a good idea to prioritise it"} className={`absolute right-2 top-2 text-lg leading-none ${it.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"}`}>{it.starred ? "★" : "☆"}</button>
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          {it.claudeCheck?.verdict === "keep" ? <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800" title={`Checked by Claude ${new Date(it.claudeCheck.at).toLocaleDateString("en-GB")}${it.claudeCheck.reason ? `: ${it.claudeCheck.reason}` : ""}`}><CheckIcon className="h-3 w-3" />Claude (check)</span> :
                          <span className={`rounded-full px-1.5 py-0.5 font-semibold ${ideaType(it) === "fix" || it.internal ? "bg-red-600 text-white" : it.ai || ideaSource(it) === "AI" ? "bg-violet-100 text-violet-800" : "bg-zinc-100 text-zinc-700"}`} title={it.internal ? "Our own check is failing on this site: sort it, nothing to send" : ideaType(it) === "fix" ? "Something broken or wrong on the site (found by the checks)" : it.ai ? "From Claude's research" : "From ICL's own list of services"}>{ideaSource(it)} Idea</span>}
                          {(() => { const sv = it.service || serviceFor(it.title); return <button onClick={(e) => { e.stopPropagation(); setService(service === sv ? "" : sv); }} title={`Show only ${sv} ideas`} className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${IDEA_SERVICES[sv] || "bg-zinc-500"}`}>{sv}</button>; })()}
                          {isQuickFix(it) ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-800">Quick fix</span> : it.size === "large" && <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 font-semibold text-white">Large</span>}
                          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-semibold text-zinc-700" title={it.hours ? "Estimated hours to deliver" : "Rough guess; research again for Claude's estimate"}>~{hoursFor(it)} hr{hoursFor(it) === 1 ? "" : "s"}</span>
                          {it.value && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800" title="Rough budget, for us only">{it.value}</span>}
                          {it.likely && <span className={`rounded-full px-1.5 py-0.5 font-semibold ${it.likely === "High" ? "bg-green-600 text-white" : it.likely === "Medium" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`} title="How likely they are to say yes">{it.likely === "High" ? "Likely yes" : `${it.likely} chance`}</span>}
                        </div>
                        <div className="mt-1 font-medium leading-snug">{it.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                          {it.status === "queued" && it.internal
                            ? <><a href={supportHref(r, it)} target="_blank" rel="noopener" title="Opens an email to support@icldigital.com with what needs fixing" className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100">Send to Support</a><button onClick={() => updateIdea(it.recId, it.key, { status: "done" })} title="Our own check: nothing to send the client" className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100">Sorted</button></>
                            : it.status === "queued"
                            ? <><a href={to ? href : undefined} aria-disabled={!to} onClick={(e) => { if (!to) e.preventDefault(); }} target="_blank" rel="noopener" title={to ? `Opens Outlook with the email to ${to}` : "No email for this client in Settings"} className={`inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100 ${to ? "" : "cursor-not-allowed opacity-40"}`}><MailIcon className="h-3 w-3" /> Outlook</a><button onClick={() => markSent(it.recId, it.key)} className="rounded-md bg-emerald-700 px-2 py-0.5 font-medium text-white hover:bg-emerald-800">Mark sent</button>{g.ours && ideaType(it) === "fix" && <a href={supportHref(r, it)} target="_blank" rel="noopener" title="Opens an email to support@icldigital.com with what needs fixing" className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100">Send to Support</a>}</>
                            : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{IDEA_STATUSES.find(([id]) => id === it.status)?.[1]}{it.sentAt ? ` ${new Date(it.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>}
                          {/* Delete: off the client's list for good, without teaching the research anything (use Bad idea in the card for that). */}
                          <button onClick={() => { if (window.confirm(`Delete “${it.title}” for ${it.client || "this client"}?`)) updateIdea(it.recId, it.key, { status: "declined", badReason: "", statusAt: new Date().toISOString() }); }} aria-label={`Delete ${it.title}`} title="Delete this idea" className="ml-auto rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-700"><TrashIcon className="h-3.5 w-3.5" /></button>
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

      {deckFor && <ProposalModal group={groups.find((x) => (x.clientId || x.name) === (deckFor.clientId || deckFor.name)) || deckFor} onClose={() => setDeckFor(null)} />}
      {addFor && <AddIdeaModal group={addFor} onResearch={addFor.clientId ? () => { setAddFor(null); openClaude({ job: "client-research", preset: [addFor.clientId] }); } : null} onClose={() => setAddFor(null)} onSave={(data) => { addIdea(addFor, data); setAddFor(null); }} />}

      {current && currentIdea && (
        <IdeaDrawer r={current} idea={currentIdea} onClose={() => setOpen(null)} onIdea={(fields) => updateIdea(current.id, currentIdea.key, fields)} onRec={(fields) => { for (const x of Object.values(recsRef.current)) if (x.clientId === current.clientId) update(x.id, fields); }} onBad={(reason) => { markBad(current, currentIdea, reason); setOpen(null); }} />
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

// A ready-to-send brief for the developer (e.g. tracking that doesn't wait for the cookie banner).
function BriefButton({ text }) {
  const [done, setDone] = useState(false);
  return <button onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 2500); }} title={text} className="mt-1 mr-3 inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">{done ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy developer brief</>}</button>;
}
// A pushpin: outline when not pinned, filled when the client is pinned to the top.
function PinIcon({ filled = false }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>;
}
function IdeaDrawer({ r, idea, onClose, onIdea, onRec, onBad }) {
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState((r.emails || [])[0] || "");
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const full = ideaEmail(r, idea, to);
  const outlook = mailHref(to, idea.subject || "", full);
  async function copy() { try { await navigator.clipboard.writeText(`Subject: ${idea.subject || ""}\n\n${full}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  const greeting = `${full.split("\n\n")[0]}\n\n${IDEA_GREETING}`;
  const site = r.website ? `https://${r.website}` : "";
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{r.name}</h3>
            {(() => { const first = (t) => { const x = String(t || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); const m = x.match(/^(.+?[.!?])(\s|$)/); const y = m ? m[1] : x; return y.length > 180 ? `${y.slice(0, 177).replace(/\s+\S*$/, "")}…` : y; };
              const line = first(r.ai?.business_summary) || [r.ai?.what_they_do, r.ai?.location].filter(Boolean).join(", ") || first(r.siteDescription) || first(r.title);
              return line ? <p className="mt-0.5 text-sm text-zinc-600">{r.ai?.business_summary || r.ai?.what_they_do ? <ClaudeText>{line}</ClaudeText> : line}</p> : null; })()}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${ideaType(idea) === "fix" || idea.internal ? "bg-red-600 text-white" : ideaSource(idea) === "AI" ? "bg-violet-100 text-violet-800" : "bg-zinc-100 text-zinc-700"}`}>{ideaSource(idea)} Idea</span>
              {(() => { const sv = idea.service || serviceFor(idea.title); return <span className={`rounded-full px-2 py-0.5 font-semibold text-white ${IDEA_SERVICES[sv] || "bg-zinc-500"}`}>{sv}</span>; })()}
              {isQuickFix(idea) ? <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">Quick fix</span> : idea.size && <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700">{idea.size[0].toUpperCase() + idea.size.slice(1)} project</span>}
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700" title="Estimated hours to deliver">~{hoursFor(idea)} hr{hoursFor(idea) === 1 ? "" : "s"}</span>
              {idea.value && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800" title="Rough budget, for us only; never in the email">{idea.value}</span>}
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700">{r.website} <ExternalIcon /></a>}
                {r.manager && <span className="text-zinc-500">{r.manager}</span>}
              </span>
            </div>
          </div>
          <button onClick={() => onIdea({ starred: !idea.starred })} aria-label={idea.starred ? "Unstar" : "Star this idea"} title={idea.starred ? "Starred: kept at the front. Click to unstar" : "Star a good idea to prioritise it"} className={`text-2xl leading-none ${idea.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"}`}>{idea.starred ? "★" : "☆"}</button>
          <select value={normStatus(idea.status)} onChange={(e) => onIdea({ status: e.target.value, ...(e.target.value === "sent" && !idea.sentAt ? { sentAt: new Date().toISOString(), sentMonth: monthKey() } : {}) })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {IDEA_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto"><div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="font-semibold">{idea.title}</div>
            <p className="mt-0.5 text-sm text-zinc-600">{idea.ai ? <ClaudeText>{idea.why}</ClaudeText> : idea.why}</p>
            {idea.resolved && <p className="mt-1 text-xs text-emerald-700">No longer found on the site at the last check.</p>}
            {idea.brief && <BriefButton text={idea.brief} />}
            {idea.evidenceUrl && <a href={idea.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 underline">{/google\.[a-z.]+\/search/.test(idea.evidenceUrl) ? "Check this search on Google" : "See what we found"} <ExternalIcon /></a>}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Email</span>
              <span className="ml-auto flex gap-2">
                {to.trim()
                  ? <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
                  : <span title="Add an email address for this client first" className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-400"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</span>}
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
  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const items = picked.map((id) => clients.find((c) => c.id === id)).filter(Boolean).map((c) => {
    const rec = Object.values(recs).find((r) => r.clientId === c.id && r.checkedAt);
    // The ideas already on their list, so Claude checks them as well as finding new ones.
    const current = Object.values(recs).filter((r) => r.clientId === c.id).flatMap((r) => (r.ideas || []).filter((i) => i.status === "queued" && !i.internal && !i.claudeCheck)).slice(0, 15)
      .map((i) => ({ key: i.key, title: i.title, why: i.why || "", service: i.service || serviceFor(i.title), hours: hoursFor(i) }));
    return { id: c.id, name: c.name, websites: c.websites || [], notes: c.notes || "", plan: c.plan ? PLANS[c.plan] : "", findings: findingsLine(rec), current };
  });
  const liked = Object.values(recs).flatMap((r) => (r.ideas || []).filter((i) => i.starred).map((i) => ({ title: i.title, service: i.service })));
  const prompt = items.length ? withTitle("Client research", items.length === 1 ? items[0].name : `${items.length} clients`, researchPrompt(items, feedback, liked)) : "";
  async function copy(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
    // Sent to Claude: move straight on to the next batch so several can run at once.
    markSent("client-research", picked); if (size !== "all") nextBatch(size, picked);
  }
  function nextBatch(n, alsoDone = [], m = mgr) { setSize(n); const waiting = sentIds("client-research"); setPicked(clients.filter((c) => mine(c, m) && !researched(c) && !alsoDone.includes(c.id) && !waiting.has(c.id)).slice(0, n === "all" ? undefined : n).map((c) => c.id)); }
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Researched clients are hidden from the picker; search looks across every account manager and finds them for a re-run.
  const list = clients.filter((c) => (q ? c.name.toLowerCase().includes(q.toLowerCase()) : mine(c) && (!researched(c) || picked.includes(c.id))));
  const doneCount = clients.filter((c) => mine(c) && researched(c)).length;
  return (
        <div className="space-y-4 text-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">1. Pick clients</span>
              <span className="text-xs text-zinc-500">Next unresearched:</span>
              {[50, 100].map((n) => <button key={n} onClick={() => nextBatch(n)} className={`rounded-full border px-2 py-0.5 text-xs ${size === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{n}</button>)}
              <button onClick={() => nextBatch("all")} title="Every client not researched yet, in one prompt" className={`rounded-full border px-2 py-0.5 text-xs ${size === "all" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>All ({clients.filter((c) => mine(c) && !researched(c)).length})</button>
              {mgrs.length > 0 && <select value={mgr} onChange={(e) => { setMgr(e.target.value); nextBatch(size, [], e.target.value); }} className="ml-auto rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs"><option value="">All account managers</option>{mgrs.map((m) => <option key={m}>{m}</option>)}</select>}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" className={`${mgrs.length ? "" : "ml-auto "}w-40 rounded-md border border-zinc-300 px-2 py-0.5 text-xs`} />
            </div>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {q && !list.length && <span className="text-xs text-zinc-500">No client called “{q}”. Add it in Settings → Clients and press Save, then come back to this tab.</span>}
              {list.map((c) => (
                <button key={c.id} onClick={() => toggle(c.id)} className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(c.id) ? "border-violet-500 bg-violet-100 text-violet-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{c.name}{researched(c) ? " ✓" : ""}</button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">{picked.length} picked{mgr ? ` from ${mgr}’s clients` : ""}.{doneCount > 0 && ` ${doneCount} already researched (hidden; type a name to re-run one).`}</p>
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
            <span className="font-semibold">3. Paste the reply</span>
            <PasteHint className="mt-1" />
          </div>
        </div>
  );
}

// Copy the "Check ideas" prompt for the ideas in view; Claude's answer is read in the chat, not pasted back.
function CheckIdeasPanel({ groups }) {
  const [copied, setCopied] = useState(false);
  const n = groups.reduce((t, g) => t + g.top.length, 0);
  const prompt = n ? withTitle("Check ideas", `${n} ideas · ${groups.length} client${groups.length === 1 ? "" : "s"}`, checkIdeasPrompt(groups)) : "";
  async function copy(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-zinc-600">Claude checks each idea in view against the live site and splits them into <b>website bugs</b> (send to support), <b>medium ideas</b> worth pitching (new pages or functionality), and ones to drop. Use the filters on Client Ideas to narrow it down first. Paste its JSON reply in step 2: kept ideas get a ✓ Claude (check) tag, dropped ones come off.</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-500">{n} ideas across {groups.length} client{groups.length === 1 ? "" : "s"}</span>
        <span className="ml-auto flex gap-2">
          <button onClick={() => copy(false)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-40">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy prompt</>}</button>
          <button onClick={() => copy(true)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"><ExternalIcon /> Copy and open Claude</button>
        </span>
      </div>
      <p className="text-xs text-zinc-500">Paste it into a new chat with web search on.</p>
      <textarea readOnly value={prompt} rows={6} className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-600" />
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

function AddIdeaModal({ group, onClose, onSave, onResearch }) {
  const [f, setF] = useState({ title: "", service: "Web design", size: "medium", hours: "", value: "", why: "", subject: "", email: "" });
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const input = "mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm";
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-zinc-500";
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3"><h3 className="text-lg font-semibold">Add an idea for {group.name}</h3><button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button></div>
        <div className="space-y-3 px-5 py-4">
          {onResearch && <button onClick={onResearch} className="flex w-full items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-left text-sm text-orange-900 hover:bg-orange-100"><span><span className="font-semibold">Let Claude research more ideas</span><span className="block text-xs text-orange-800">Opens the Client research prompt for {group.name}</span></span><span aria-hidden>→</span></button>}
          <label className={label}>Or add your own idea<input autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Online booking for consultations" className={input} /></label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className={label}>Service<select value={f.service} onChange={set("service")} className={`${input} bg-white`}>{Object.keys(IDEA_SERVICES).map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className={label}>Size<select value={f.size} onChange={set("size")} className={`${input} bg-white`}><option value="quick">Quick fix</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            <label className={label}>Hours<input type="number" min={0} value={f.hours} onChange={set("hours")} placeholder={f.size === "quick" ? "3" : f.size === "large" ? "40" : "12"} className={input} /></label>
            <label className={label}>Budget<input value={f.value} onChange={set("value")} placeholder="£3k-£6k" className={input} /></label>
          </div>
          <label className={label}>Why it would help them<textarea value={f.why} onChange={set("why")} rows={2} placeholder="One or two sentences; used in the email if you leave the email blank" className={input} /></label>
          <label className={label}>Email subject<input value={f.subject} onChange={set("subject")} placeholder="An idea for your website" className={input} /></label>
          <label className={label}>Email (optional)<textarea value={f.email} onChange={set("email")} rows={4} placeholder="Leave blank and it’s written for you in the usual style, ending with the estimate offer" className={input} /></label>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Cancel</button><button onClick={() => f.title.trim() && onSave(f)} disabled={!f.title.trim()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add idea</button></div>
        </div>
      </div>
    </div>
  );
}


