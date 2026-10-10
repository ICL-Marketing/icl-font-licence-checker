"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { PlayIcon, StopIcon, RefreshIcon, DownloadIcon, TrashIcon, ExternalIcon, PinIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon } from "@/app/icons";
import { LEAD_STATUSES, PROBLEMS, DRAFT_VERSION, CONTACTS_VERSION, draftFollowUp, parkStatus, issuesFor, pickIssue, draftFor, fullEmail, dayGreeting, roleGroup, sicDescription, contactExhausted, MAPS_TYPES, findSitesPrompt, parseSitesReply, findLeadsPrompt, parseFoundLeads, SEEN_ON_SITE, REVIEW_PATHS, suggestPath, draftPrompt, parseDraftReply, firstNameOf, GENERIC_BOX_RE, websiteIsVerified, isFrozen, leadCheckPrompt, parseLeadCheck } from "@/lib/leadsShared";
import SEED from "@/data/leads.json";
import { useClaudeHandler, markSent, sentIds, PasteHint } from "@/app/claudeInbox";

// Website leads: local businesses whose site is letting them down, found
// through Companies House and worked through a pipeline board.
const KEY = "flc-leads-v1";
const SCAN_KEY = "flc-leads-scan-v1"; // an interrupted scan, so it can be continued after a reload
// Every company the finder has already checked, kept or discarded, so a new scan never
// re-reads the same accounts and websites. Re-checked after SEEN_DAYS in case things changed.
const SEEN_KEY = "flc-leads-seen-v1";
const SEEN_DAYS = 90;
const loadSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch { return {}; } };
const saveSeen = (v) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch {} };
const loadScan = () => { try { return JSON.parse(localStorage.getItem(SCAN_KEY) || "null"); } catch { return null; } };
// Rebrand / new-director checks already run, so a long patch is worked through over several sessions.
const TRIG_KEY = "flc-leads-triggers";
const loadTrig = () => { try { return JSON.parse(localStorage.getItem(TRIG_KEY) || "{}") || {}; } catch { return {}; } };
const saveTrig = (v) => { try { localStorage.setItem(TRIG_KEY, JSON.stringify(v)); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|llp|plc)\b/g, "").replace(/[^a-z0-9]+/g, "");
// Where a lead came from, when it is not the plain Companies House sweep.
export const LEAD_SOURCES = [
  ["all", "All companies", "Every active company in the area (Companies House)"],
  ["triggers", "Rebrands & new directors", "Companies in the area that changed name, or took on a new director or owner, in the last 6 months"],
  ["new", "New businesses", "Companies set up in the area in the last 90 days"],
  ["jobs", "Hiring for marketing", "Local firms advertising marketing or digital jobs in the last 30 days (Adzuna)"],
  ["maps", "Google Maps", "Businesses listed on Google Maps in the area, sole traders included"],
  ["claude", "Ask Claude (free)", "Claude searches the web for local businesses with weak or missing websites"],
];
const TRIGGER_TAG = { rebrand: "Rebrand", director: "New director", owner: "New owner", new: "New business", jobs: "Hiring", maps: "Google Maps", claude: "Claude find" };
const saveScan = (v) => { try { if (v) localStorage.setItem(SCAN_KEY, JSON.stringify(v)); else localStorage.removeItem(SCAN_KEY); } catch {} };
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

const LIKELY = { High: "bg-green-100 text-green-800", Medium: "bg-amber-100 text-amber-800", Low: "bg-zinc-100 text-zinc-600" };
const PROBLEM_TONE = { "No website": "bg-red-600", "Parked domain": "bg-red-600", "Dead/broken site": "bg-red-600", "Broken SSL": "bg-orange-500", "Dated template": "bg-amber-500", "Stale copyright": "bg-zinc-500", "Licence risk": "bg-purple-600", "Low search visibility": "bg-blue-600" };
const money = (n) => (n === null || n === undefined || n === "" ? "—" : `£${Math.round(Number(n)).toLocaleString("en-GB")}`);
// Plain-English company size for the cards: £1.4m, £198k.
const compact = (n) => { const v = Number(n); if (n === null || n === undefined || n === "" || !Number.isFinite(v)) return ""; const a = Math.abs(v); return `${v < 0 ? "-" : ""}£${a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : Math.round(a)}`; };
// The website says one thing at a time: someone (you or Claude) confirmed it, or there is a doubt, or it is verified.
// What an email raises when it didn't come from one of the checker's issues: the review choice, else the problem.
function raisedIn(l) {
  const k = l.review?.lead || "";
  if (/^(you|own):/.test(k)) return k.slice(4);
  if (k === "claude") return oneLine(l.claude?.angle || l.claude?.issue_note);
  if (k === "why-now") return l.trigger || "";
  if (k.startsWith("chk:")) return (issuesFor(l).find((i) => `chk:${i.id}` === k) || {}).label || l.problem || "";
  return l.problem || "";
}
const STALE_WHY = /site is current|no outreach planned/i;
const humanConfirmed = (l) => !!l.websiteConfirmed || ["confirmed by you", "checked by Claude"].includes(l.websiteVerified || "");
const siteDoubt = (l) => !!(l.website && l.websiteDoubt && !humanConfirmed(l));
const signed = (n) => (n === null || n === undefined || n === "" ? "—" : `${n < 0 ? "-" : "+"}£${Math.abs(Math.round(Number(n))).toLocaleString("en-GB")}`);

export default function LeadsArea({ onRunning, onCount, clients = [] }) {
  const [leads, setLeads] = useState({});
  const [cfg, setCfg] = useState(null); // {configured, areas, sectors}
  const [minAssets, setMinAssetsState] = useState(() => { try { return Number(localStorage.getItem("flc-leads-floor") || 20000) || 20000; } catch { return 20000; } });
  const floorTimer = useRef(null);
  // Changing the floor re-sorts the board: parked-as-too-small leads above the new floor come back,
  // open leads below it are parked. Leads already in conversation, won or lost are left alone.
  function applyFloor(floor) {
    const at = new Date().toISOString();
    const next = { ...leadsRef.current };
    let changed = 0;
    for (const [id, l] of Object.entries(next)) {
      if (!l.companyNumber || l.netAssets === null || l.netAssets === undefined) continue;
      const tooSmallCaveat = /Net assets under £[\d,]+/i;
      const parkedSmall = l.status === "not-pursuing" && tooSmallCaveat.test(l.caveats || "");
      if (parkedSmall && l.netAssets >= floor) {
        const caveats = (l.caveats || "").split("; ").filter((x) => !tooSmallCaveat.test(x)).join("; ");
        const status = !l.problem ? "not-pursuing" : l.emailAddress ? ("new") : "no-contact";
        if (status !== "not-pursuing") { next[id] = { ...l, caveats, status, contactUnverified: !l.emailAddress, statusAt: at, updatedAt: at }; changed++; push(id, next[id]); }
      } else if (["new", "qualified", "no-contact"].includes(l.status) && l.netAssets < floor) {
        next[id] = { ...l, caveats: [l.caveats, `Net assets under £${floor.toLocaleString("en-GB")}`].filter(Boolean).join("; "), status: "not-pursuing", statusAt: at, updatedAt: at }; changed++; push(id, next[id]);
      } else if (parkedSmall && !(l.caveats || "").includes(`under £${floor.toLocaleString("en-GB")}`)) {
        // Still too small: the reason should quote the floor as it is now, not as it was.
        next[id] = { ...l, caveats: (l.caveats || "").replace(tooSmallCaveat, `Net assets under £${floor.toLocaleString("en-GB")}`), updatedAt: at }; push(id, next[id]);
      }
    }
    if (changed) { leadsRef.current = next; save(next); setLeads(next); }
    return changed;
  }
  useEffect(() => { const t = setTimeout(() => { if (Object.keys(leadsRef.current).length) applyFloor(minAssets); }, 1500); return () => clearTimeout(t); }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps
  function setMinAssets(v) {
    setMinAssetsState(v);
    try { localStorage.setItem("flc-leads-floor", String(v)); } catch {}
    clearTimeout(floorTimer.current);
    floorTimer.current = setTimeout(() => { const n = applyFloor(v); if (n) setRun({ kind: "floor", phase: `Done: floor set to £${v.toLocaleString("en-GB")}, ${n} lead${n === 1 ? "" : "s"} moved between columns.`, done: 0, total: 0, found: 0, errors: [] }); }, 700);
  }
  const [run, setRun] = useState(null); // {phase, done, total, found, errors}
  // Scan area: locations + radius, shared with the team. The server turns it into postcode districts.
  const [areaCentres, setAreaCentres] = useState(["Richmond"]);
  const [areaMiles, setAreaMiles] = useState(10);
  const [areaMilesDraft, setAreaMilesDraft] = useState("10");
  const [areaDraft, setAreaDraft] = useState("");
  const [areaState, setAreaState] = useState({ busy: false, error: "", outcodes: 0 });
  const areaRef = useRef(null); // { outcodes:[], places:[] } once mapped
  useEffect(() => {
    fetch("/api/settings?key=lead-area").then((r) => r.json()).then((j) => {
      const a = j.shared && j.value;
      if (a?.outcodes?.length) { areaRef.current = a; setAreaCentres(a.centres?.length ? a.centres : ["Richmond"]); setAreaMiles(a.miles || 10); setAreaMilesDraft(String(a.miles || 10)); setAreaState({ busy: false, error: "", outcodes: a.outcodes.length, places: a.places?.length || 0, found: a.found }); }
    }).catch(() => {});
  }, []);
  async function saveArea(centres, miles) {
    const list = [...new Set(centres.map((x) => String(x).trim()).filter(Boolean))];
    if (!list.length) return;
    setAreaCentres(list); setAreaMiles(miles); setAreaMilesDraft(String(miles));
    setAreaState((s) => ({ ...s, busy: true, error: "" }));
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "area", centres: list, miles }) });
      const j = await r.json();
      if (j.outcodes?.length) { areaRef.current = j; setAreaState({ busy: false, error: j.missing?.length ? `Couldn't find ${j.missing.join(", ")}` : "", outcodes: j.outcodes.length, places: j.places?.length || 0, found: j.found }); }
      else setAreaState({ busy: false, error: j.error || "Couldn't map that area", outcodes: 0 });
    } catch { setAreaState({ busy: false, error: "Couldn't map that area. Check the connection.", outcodes: 0 }); }
  }
  const [pending, setPending] = useState(null); // interrupted scan found on load
  const [open, setOpen] = useState(null);
  const [leadSource, setLeadSourceState] = useState(() => { try { return localStorage.getItem("flc-leads-source") || "all"; } catch { return "all"; } });
  const setLeadSource = (v) => { setLeadSourceState(v); try { localStorage.setItem("flc-leads-source", v); } catch {} };
  const [mapsWhat, setMapsWhatState] = useState(() => { try { return localStorage.getItem("flc-leads-maps") || ""; } catch { return ""; } });
  const setMapsWhat = (v) => { setMapsWhatState(v); try { localStorage.setItem("flc-leads-maps", v); } catch {} };
  const [findClaude, setFindClaude] = useState(false);
  const [sitesFor, setSitesFor] = useState(null); // null closed, { ids: [] } next batch, { ids: [id] } one lead
  const [claudeFor, setClaudeFor] = useState(null); // null closed, [] next batch, [id] one lead
  const [filter, setFilter] = useState("");
  const [showProblem, setShowProblem] = useState("");
  // Today's work by default: parked and lost leads hidden, and only High and Medium leads in To assess.
  const [showParked, setShowParked] = useState(false);
  const [showLow, setShowLow] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const stopRef = useRef(false);
  const sharedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      let local = load();
      if (!local) { local = Object.fromEntries(SEED.map((l) => [l.id, l])); save(local); }
      for (const l of Object.values(local)) if (l.email && !l.email.includes("\n\n")) l.email = l.email.trim().replace(/\n+/g, "\n\n"); // paragraph spacing for older drafts
      // Dormant companies scored before the rule existed: Low, parked, with the reason.
      for (const l of Object.values(local)) if (/dormant/i.test(l.caveats || "") && (l.likelihood !== "Low" || !/dormant/i.test(l.likelihoodWhy || ""))) { l.likelihood = "Low"; l.likelihoodWhy = "Filed as dormant at Companies House, so not trading through this company; nothing to sell to"; if (["new", "qualified", "no-contact"].includes(l.status)) l.status = "not-pursuing"; l.updatedAt = new Date().toISOString(); }
      // A lead with nothing to pitch (site current, no licence risk) does not belong in an open column.
      for (const l of Object.values(local)) if (!l.problem && ["new", "qualified", "no-contact"].includes(l.status) && websiteIsVerified(l) && !(l.websiteConfirmed && !l.claude)) { l.status = "not-pursuing"; l.likelihood = "Low"; l.likelihoodWhy = l.likelihoodWhy || "Site is current; no outreach planned"; l.updatedAt = new Date().toISOString(); }
      // Open leads with no verified email address are parked, whatever column they were in.
      for (const l of Object.values(local)) if (!l.emailAddress && (l.contactUnverified || l.contactsTried) && ["new", "qualified"].includes(l.status)) { l.contactUnverified = true; l.status = parkStatus(l); l.updatedAt = new Date().toISOString(); }
      // Contact not verified, and every route tried: nothing more to do, so park it.
      // Qualified was folded into To assess.
      for (const l of Object.values(local)) if (l.status === "qualified") { l.status = "new"; l.updatedAt = new Date().toISOString(); }
      // A Claude check made before the website was confirmed or replaced no longer applies.
      for (const l of Object.values(local)) if (l.claude && l.website && l.websiteConfirmed && l.claude.website_is_theirs === false && l.website !== l.claude.correct_website) { l.claude = null; l.claudeFields = []; if (l.status === "not-pursuing" && !l.review?.done && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = "new"; l.statusAt = new Date().toISOString(); } l.updatedAt = new Date().toISOString(); }
      // Claude said skip: parked for good, whichever column it was left in.
      for (const l of Object.values(local)) if (claudeSkip(l) && ["new", "no-contact"].includes(l.status)) { l.status = "not-pursuing"; l.statusAt = l.updatedAt = new Date().toISOString(); }
      // Parked earlier only because Claude couldn't confirm the issue, though it said to contact them: bring back.
      for (const l of Object.values(local)) if (l.status === "not-pursuing" && !l.review?.done && websiteUnknown(l) && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = "new"; l.websiteNeeded = true; l.statusAt = l.updatedAt = new Date().toISOString(); }
      for (const l of Object.values(local)) if (l.status === "not-pursuing" && !l.review?.done && l.claude?.worth_contacting && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = l.emailAddress ? "new" : "no-contact"; l.contactUnverified = !l.emailAddress; l.statusAt = l.updatedAt = new Date().toISOString(); }
      for (const l of Object.values(local)) if (l.status === "no-contact" && contactExhausted(l)) { l.status = "not-pursuing"; l.contactUnverified = true; l.updatedAt = new Date().toISOString(); }
      // "info", "hello" and the like are inboxes, not people: the email opens "Hi there," instead.
      for (const l of Object.values(local)) if (l.status !== "not-pursuing" && STALE_WHY.test(l.likelihoodWhy || "")) { l.likelihoodWhy = ""; l.caveats = String(l.caveats || "").split("; ").filter((x) => x && !STALE_WHY.test(x)).join("; "); }
      for (const l of Object.values(local)) if (!isFrozen(l) && l.contactName && !firstNameOf(l.contactName)) { l.contactName = ""; l.updatedAt = new Date().toISOString(); }
      // Company-name searches are no longer run; drop any stored ones so only the trade search shows.
      for (const l of Object.values(local)) if (!isFrozen(l) && l.seo?.searches?.some((x) => x.kind !== "trade")) { l.seo = { ...l.seo, searches: l.seo.searches.filter((x) => x.kind === "trade") }; l.updatedAt = new Date().toISOString(); }
      // Parked only for a missing contact? That has its own column now.
      for (const l of Object.values(local)) if (l.status === "not-pursuing" && !l.review?.done && l.contactUnverified && !l.emailAddress && parkStatus(l) === "no-contact") { l.status = "no-contact"; l.updatedAt = new Date().toISOString(); }
      // One-off: every lead imported from the Client Matrix sheet was closed as Lost (7 Oct 2026).
      for (const l of Object.values(local)) if (l.source === "Client Matrix v4.1" && !l.sheetLost) { l.status = "lost"; l.sheetLost = true; l.updatedAt = new Date().toISOString(); }
      leadsRef.current = local;
      setLeads(local);
      fetch("/api/results?kind=leads").then((r) => r.json()).then((j) => {
        if (!j.shared) return;
        sharedRef.current = true;
        const next = { ...local };
        for (const [id, l] of Object.entries(j.results || {})) { if (!next[id] || String(l.updatedAt || "") >= String(next[id].updatedAt || "")) next[id] = l; }
        for (const l of Object.values(next)) if (l.email && !l.email.includes("\n\n")) l.email = l.email.trim().replace(/\n+/g, "\n\n");
        for (const l of Object.values(next)) if (/dormant/i.test(l.caveats || "") && (l.likelihood !== "Low" || !/dormant/i.test(l.likelihoodWhy || ""))) { l.likelihood = "Low"; l.likelihoodWhy = "Filed as dormant at Companies House, so not trading through this company; nothing to sell to"; if (["new", "qualified", "no-contact"].includes(l.status)) l.status = "not-pursuing"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!l.problem && ["new", "qualified", "no-contact"].includes(l.status) && websiteIsVerified(l) && !(l.websiteConfirmed && !l.claude)) { l.status = "not-pursuing"; l.likelihood = "Low"; l.likelihoodWhy = l.likelihoodWhy || "Site is current; no outreach planned"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!l.emailAddress && (l.contactUnverified || l.contactsTried) && ["new", "qualified"].includes(l.status)) { l.contactUnverified = true; l.status = parkStatus(l); l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "qualified") { l.status = "new"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.claude && l.website && l.websiteConfirmed && l.claude.website_is_theirs === false && l.website !== l.claude.correct_website) { l.claude = null; l.claudeFields = []; if (l.status === "not-pursuing" && !l.review?.done && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = "new"; l.statusAt = new Date().toISOString(); } l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (claudeSkip(l) && ["new", "no-contact"].includes(l.status)) { l.status = "not-pursuing"; l.statusAt = l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "not-pursuing" && !l.review?.done && websiteUnknown(l) && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = "new"; l.websiteNeeded = true; l.statusAt = l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "not-pursuing" && !l.review?.done && l.claude?.worth_contacting && !l.optedOut && !/under £|already a client|dormant/i.test(parkReason(l))) { l.status = l.emailAddress ? "new" : "no-contact"; l.contactUnverified = !l.emailAddress; l.statusAt = l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "no-contact" && contactExhausted(l)) { l.status = "not-pursuing"; l.contactUnverified = true; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!isFrozen(l) && l.contactName && !firstNameOf(l.contactName)) { l.contactName = ""; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!isFrozen(l) && l.seo?.searches?.some((x) => x.kind !== "trade")) { l.seo = { ...l.seo, searches: l.seo.searches.filter((x) => x.kind === "trade") }; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "not-pursuing" && !l.review?.done && l.contactUnverified && !l.emailAddress && parkStatus(l) === "no-contact") { l.status = "no-contact"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.source === "Client Matrix v4.1" && !l.sheetLost) { l.status = "lost"; l.sheetLost = true; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        save(next);
        leadsRef.current = next;
        setLeads(next);
        // Push anything only this browser has (the seed on first load).
        for (const [id, l] of Object.entries(next)) if (!(j.results || {})[id]) push(id, l);
      }).catch(() => {});
    }, 0);
    fetch("/api/leads").then((r) => r.json()).then(setCfg).catch(() => setCfg({ configured: false, areas: {}, sectors: {} }));
    setTimeout(() => { const sc = loadScan(); if (sc && (sc.queue?.length || sc.ids?.length)) setPending(sc); }, 0);
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
    const prev = leadsRef.current[id] || {};
    const l = { ...prev, ...fields, id, updatedAt: new Date().toISOString() };
    if (fields.status && fields.status !== prev.status) {
      l.statusAt = new Date().toISOString();
      // "Site is current; no outreach planned" stops being true the moment someone decides to pursue it.
      if (fields.status !== "not-pursuing" && STALE_WHY.test(l.likelihoodWhy || "")) { l.likelihoodWhy = ""; l.caveats = String(l.caveats || "").split("; ").filter((x) => x && !STALE_WHY.test(x)).join("; "); }
    }
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

  const moveMany = (ids, status) => {
    const at = new Date().toISOString();
    const next = { ...leadsRef.current };
    for (const id of ids) if (next[id]) { next[id] = { ...next[id], status, updatedAt: at, ...(next[id].status !== status ? { statusAt: at } : {}) }; push(id, next[id]); }
    leadsRef.current = next; save(next); setLeads(next);
  };
  const removeMany = (ids) => {
    const next = { ...leadsRef.current };
    for (const id of ids) { delete next[id]; if (sharedRef.current) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "leads", site: id }) }).catch(() => {}); }
    leadsRef.current = next; save(next); setLeads(next); setSelected(new Set());
  };
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectIds = (ids, on) => setSelected((prev) => { const n = new Set(prev); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });

  const list = Object.values(leads);
  const openLeads = list.filter((l) => ["new", "qualified", "ready", "replied"].includes(l.status)).length;
  useEffect(() => { onCount?.(openLeads); }, [openLeads, onCount]);

  // Seen registry: local copy merged with the team's, pushed after each scan.
  const seenRef = useRef({});
  useEffect(() => {
    seenRef.current = loadSeen();
    fetch("/api/settings?key=leads-seen").then((r) => r.json()).then((j) => { if (j.shared && j.value) { seenRef.current = { ...seenRef.current, ...j.value }; saveSeen(seenRef.current); } }).catch(() => {});
  }, []);
  useEffect(() => { for (const l of Object.values(leads)) if (l.companyNumber && !seenRef.current[l.companyNumber]) seenRef.current[l.companyNumber] = { at: (l.addedAt || new Date().toISOString()).slice(0, 10), outcome: l.status }; saveSeen(seenRef.current); }, [leads]);
  const markSeen = (companyNumber, outcome) => { seenRef.current[companyNumber] = { at: new Date().toISOString().slice(0, 10), outcome }; saveSeen(seenRef.current); };
  const pushSeen = () => fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "leads-seen", value: seenRef.current }) }).catch(() => {});
  const seenRecently = (companyNumber) => { const v = seenRef.current[companyNumber]; return !!v && (Date.now() - new Date(v.at).getTime()) / 86400000 < SEEN_DAYS; };

  // Pages on icldigital.com the emails link to (shared setting, edited in Settings → Connections).
  const linksRef = useRef({});
  const [followUp, setFollowUp] = useState(FOLLOW_UP_DEFAULTS);
  useEffect(() => { fetch("/api/settings?key=lead-links").then((r) => r.json()).then((j) => { if (j.shared && j.value) { linksRef.current = j.value; if (j.value.followUp) setFollowUp({ ...FOLLOW_UP_DEFAULTS, ...j.value.followUp }); } }).catch(() => {}); }, []);

  // Silence moves leads along: Contacted → Cold after coldDays, Cold → Lost after lostDays.
  // Replied or Meeting at any point resets the clock, because the status changed.
  useEffect(() => {
    const now = Date.now();
    const age = (l) => (now - new Date(l.statusAt || l.updatedAt || l.addedAt || now).getTime()) / 86400000;
    for (const l of Object.values(leadsRef.current)) {
      if (l.status === "contacted" && age(l) >= followUp.coldDays) update(l.id, { status: "cold", autoMoved: `Cold: no reply ${followUp.coldDays} days after contact` });
      else if (l.status === "cold" && age(l) >= followUp.lostDays) update(l.id, { status: "lost", autoMoved: `Lost: still nothing ${followUp.lostDays} days after going cold` });
    }
  }, [leads, followUp]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stop aborts the request in flight as well, so it does not wait for the current company to finish.
  const abortRef = useRef(null);
  function stopNow() { stopRef.current = true; try { abortRef.current?.abort(); } catch {} setRun((r) => (r ? { ...r, phase: "Stopping…" } : r)); }
  async function post(body) {
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const r = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, links: linksRef.current }), signal: ctrl.signal }).catch((e) => { if (e?.name === "AbortError") throw new Error("Stopped"); throw e; });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  // Find new leads: every town around Richmond, every trade, then enrich each new candidate.
  async function findLeads(resume = null) {
    const mode = resume?.mode || leadSource;
    if (!resume && mode === "claude") { setFindClaude(true); return; }
    if (!resume && ["jobs", "maps"].includes(mode)) return findOutside(mode);
    stopRef.current = false;
    onRunning?.(true);
    setPending(null);
    const area = areaRef.current;
    const places = area?.places?.length ? area.places : [...new Set(Object.values(PLACES).flat())];
    const areaPostcodes = area?.outcodes?.length ? area.outcodes : [];
    const known = new Set(Object.keys(leadsRef.current));
    let skipped = 0;
    const knownSites = clients.flatMap((c) => c.websites || []).map((w) => String(w).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    const st = resume ? { kind: "find", phase: "Continuing…", done: resume.done || 0, total: resume.total || 0, found: resume.found || 0, errors: [] } : { kind: "find", phase: "Searching Companies House…", done: 0, total: 0, found: 0, errors: [] };
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const floor = resume ? resume.minAssets : minAssets;
    setRun({ ...st });
    try {
      let candidates = resume ? resume.queue : [];
      if (!resume) {
        for (const pl of places) {
          if (stopRef.current) break;
          let start = 0;
          for (let page = 0; page < 5; page++) {
            let j; try { j = await post({ step: "search", place: pl, startIndex: start, areas: [], postcodes: areaPostcodes, ...(mode === "new" ? { incorporatedFrom: since, minAgeYears: 0 } : {}) }); } catch (e) { if (stopRef.current) break; throw e; }
            for (const c of j.candidates) {
              // Rebrand checks look at companies already on the board too: a new name or new people is a reason to go back.
              if (mode === "triggers") { if (!candidates.some((x) => x.companyNumber === c.companyNumber)) candidates.push(c); continue; }
              if (known.has(c.companyNumber)) continue; known.add(c.companyNumber); if (seenRecently(c.companyNumber)) { skipped++; continue; }
              candidates.push(mode === "new" ? { ...c, source: "New business", triggerKind: "new", trigger: `Set up on ${new Date(c.incorporated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`, triggerAt: c.incorporated } : c);
            }
            start += 100;
            st.phase = `Searching ${pl}… ${candidates.length} new companies${skipped ? `, ${skipped} already checked` : ""}`; setRun({ ...st });
            if (start >= j.total || j.scanned < 100) break;
          }
        }
        st.total = candidates.length;
        if (mode === "triggers") candidates = await triggerFilter(candidates, st);
      }
      while (candidates.length) {
        if (stopRef.current) break;
        const c = candidates[0];
        saveScan({ kind: "find", mode, queue: candidates, done: st.done, total: st.total, found: st.found, minAssets: floor });
        st.phase = `Checking ${c.name}…`; setRun({ ...st });
        const why = c.trigger ? { source: c.source, trigger: c.trigger, triggerKind: c.triggerKind, triggerAt: c.triggerAt } : {};
        try {
          let { lead } = await post({ step: "enrich", company: c, knownSites, minAssets: floor });
          lead = { ...lead, ...why };
          const tooSmall = lead.netAssets !== null && lead.netAssets !== undefined && lead.netAssets < floor;
          // Licence sweep only for sites we might pitch (not parked/dead, not too small).
          if (!tooSmall && lead.website && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site") { try { st.phase = `Checking licences on ${lead.website}…`; setRun({ ...st }); ({ lead } = await post({ step: "licence", lead })); } catch {} }
          st.done++;
          if (lead.problem && !tooSmall) { if (["new", "qualified"].includes(lead.status)) st.found++; else st.parked = (st.parked || 0) + 1; update(lead.id, lead); markSeen(c.companyNumber, lead.status); }
          else if (lead.problem) { st.parked = (st.parked || 0) + 1; update(lead.id, { ...lead, status: "not-pursuing" }); markSeen(c.companyNumber, "too-small"); }
          else { st.parked = (st.parked || 0) + 1; update(lead.id, { ...lead, status: "not-pursuing", likelihood: "Low", likelihoodWhy: lead.likelihoodWhy || "Site is current; no outreach planned", caveats: [lead.caveats, "Site is current"].filter(Boolean).join("; ") }); markSeen(c.companyNumber, "site-fine"); } // nothing to pitch, but it goes on the board so you can see it was checked
        } catch (e) { if (stopRef.current) break; st.done++; st.errors.push(`${c.name}: ${e.message}`); }
        candidates = candidates.slice(1);
        setRun({ ...st });
      }
      if (candidates.length) saveScan({ kind: "find", mode, queue: candidates, done: st.done, total: st.total, found: st.found, minAssets: floor }); else saveScan(null);
      pushSeen();
      st.phase = stopRef.current ? `Stopped with ${candidates.length} companies still to check.` : `Done: ${st.found} new lead${st.found === 1 ? "" : "s"} from ${st.done} companies checked${st.parked ? `, ${st.parked} parked` : ""}${skipped ? `, ${skipped} skipped as already checked in the last ${SEEN_DAYS} days` : ""}.`;
      setRun({ ...st });
      if (candidates.length) setPending(loadScan());
      fetch("/api/leads").then((r) => r.json()).then(setCfg).catch(() => {});
    } catch (e) {
      st.phase = `Stopped: ${e.message}`; setRun({ ...st });
      setPending(loadScan());
    } finally { onRunning?.(false); }
  }

  // Rebrands and new directors/owners: one Companies House call per company, paced at 2 a second
  // (their limit is 600 per 5 minutes). Results are remembered for 14 days, so Stop and carry on later.
  async function triggerFilter(list, st) {
    const cache = loadTrig();
    const fresh = (n) => cache[n] && Date.now() - cache[n].at < 14 * 86400000;
    const todo = list.filter((c) => !fresh(c.companyNumber));
    st.total = todo.length; st.done = 0;
    for (let i = 0; i < todo.length; i += 6) {
      if (stopRef.current) break;
      const batch = todo.slice(i, i + 6), t0 = Date.now();
      const hits = list.filter((c) => fresh(c.companyNumber) && cache[c.companyNumber].t.length).length;
      st.phase = `Looking for rebrands and new directors… ${hits} found so far`; setRun({ ...st });
      let j;
      try { j = await post({ step: "triggers", companyNumbers: batch.map((c) => c.companyNumber), months: 6 }); }
      catch (e) {
        if (stopRef.current) break;
        if (/rate limit/i.test(e.message)) { st.phase = "Companies House limit reached: pausing for a minute…"; setRun({ ...st }); await sleep(60000); i -= 6; continue; }
        throw e;
      }
      for (const c of batch) cache[c.companyNumber] = { at: Date.now(), t: j.triggers?.[c.companyNumber] || [] };
      saveTrig(cache);
      st.done = Math.min(i + 6, todo.length); setRun({ ...st });
      const wait = 3000 - (Date.now() - t0); if (wait > 0) await sleep(wait);
    }
    const out = [];
    for (const c of list) {
      const t = fresh(c.companyNumber) ? cache[c.companyNumber].t[0] : null;
      if (!t) continue;
      const why = { source: "Rebrand / new people", trigger: t.text, triggerKind: t.kind, triggerAt: t.date };
      const have = leadsRef.current[c.companyNumber];
      // Already on the board: tag it with the news rather than checking it again.
      if (have) { if (have.triggerAt !== t.date && !isFrozen(have)) update(have.id, { trigger: t.text, triggerKind: t.kind, triggerAt: t.date }); continue; }
      out.push({ ...c, ...why });
    }
    st.done = 0; st.total = out.length;
    return out;
  }

  // Businesses found outside the Companies House sweep: Google Maps, job ads, Claude.
  async function findOutside(mode, items = null) {
    stopRef.current = false;
    onRunning?.(true);
    setPending(null);
    const area = areaRef.current;
    const st = { kind: "find", phase: mode === "maps" ? "Searching Google Maps…" : mode === "jobs" ? "Searching job ads…" : "Adding Claude's finds…", done: 0, total: 0, found: 0, errors: [] };
    setRun({ ...st });
    const knownSites = clients.flatMap((c) => c.websites || []).map((w) => String(w).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    const all = Object.values(leadsRef.current);
    const haveName = new Set(all.map((l) => slug(l.business)));
    const haveSite = new Set(all.map((l) => String(l.website || "").toLowerCase()).filter(Boolean));
    const outcodes = new Set((area?.outcodes || []).map((x) => String(x).toUpperCase()));
    const inPatch = (pc) => !pc || !outcodes.size || outcodes.has(String(pc).toUpperCase().trim().split(/\s+/)[0]);
    const isNew = (x) => !haveName.has(slug(x.name)) && !(x.website && haveSite.has(String(x.website).toLowerCase())) && !(x.companyNumber && leadsRef.current[x.companyNumber]);
    try {
      let list = items || [];
      if (mode === "maps") {
        const what = MAPS_TYPES.some(([, t]) => t.includes(mapsWhat)) ? mapsWhat : "";
        if (!what) throw new Error("Pick a business type first.");
        const seen = new Set();
        let spent = 0;
        // One search per location covers the whole radius. More pages only while they keep turning up new businesses.
        for (const centre of areaCentres) {
          let token = "";
          for (let page = 0; page < 3; page++) {
            if (stopRef.current) break;
            st.phase = `Searching Google Maps for ${what.toLowerCase()} around ${centre}… ${list.length} found`; setRun({ ...st });
            const j = await post({ step: "places", query: what, centre, miles: areaMiles, page, pageToken: token });
            if (!j.cached) spent++;
            if (j.usage) setCfg((c) => (c ? { ...c, placesUsage: j.usage } : c));
            let fresh = 0;
            for (const x of j.items || []) {
              if (seen.has(x.placeId) || !inPatch(x.postcode)) continue; seen.add(x.placeId);
              const item = { id: `gm:${x.placeId}`, name: x.name, address: x.address, postcode: x.postcode, town: x.town, website: x.website, websiteEvidence: x.website ? "listed on their Google Business profile" : "", source: "Google Maps", triggerKind: "maps", trigger: x.website ? `${x.type || "Business"} on Google Maps${x.reviews ? ` · ${x.rating}★ from ${x.reviews} reviews` : ""}` : "On Google Maps with no website", google: { rating: x.rating, reviews: x.reviews, mapsUrl: x.mapsUrl, phone: x.phone, type: x.type }, trade: what.toLowerCase().replace(/s$/, "") };
              if (isNew(item)) fresh++;
              list.push(item);
            }
            token = j.next || "";
            if (!token || fresh < 8) break; // mostly businesses we already have: not worth another search
          }
        }
        st.spent = spent;
      } else if (mode === "jobs") {
        const km = Math.round((areaMiles || 10) * 1.609);
        const by = new Map();
        for (const pl of areaCentres) {
          for (let page = 1; page <= 3; page++) {
            if (stopRef.current) break;
            st.phase = `Searching job ads near ${pl}… ${by.size} firms hiring`; setRun({ ...st });
            const j = await post({ step: "jobs", place: pl, km, page });
            for (const c of j.companies || []) { const k = slug(c.name); if (!by.has(k)) by.set(k, { ...c, jobs: [] }); by.get(k).jobs.push(...c.jobs); }
            if (!j.more) break;
          }
        }
        list = [...by.values()].map((c) => ({ id: `job:${slug(c.name)}`, name: c.name, town: c.town, source: "Hiring", triggerKind: "jobs", trigger: `Hiring: ${c.jobs[0].title}${c.jobs.length > 1 ? ` (+${c.jobs.length - 1} more)` : ""}`, triggerAt: c.jobs[0].posted, jobs: c.jobs.slice(0, 5) }));
      }
      const before = list.length;
      list = list.filter(isNew);
      st.total = list.length; st.phase = `${list.length} new to check${before > list.length ? ` (${before - list.length} already on the board)` : ""}…`; setRun({ ...st });
      for (const x of list) {
        if (stopRef.current) break;
        st.phase = `Checking ${x.name}…`; setRun({ ...st });
        try {
          const { lead } = await post({ step: "enrich-outside", item: x, knownSites, minAssets });
          // Matched to a company already on the board: just tag it.
          const have = leadsRef.current[lead.id];
          if (have) { if (!isFrozen(have)) update(have.id, { trigger: lead.trigger, triggerKind: lead.triggerKind, triggerAt: lead.triggerAt, ...(lead.google ? { google: lead.google } : {}), ...(lead.jobs ? { jobs: lead.jobs } : {}) }); }
          else { update(lead.id, lead); if (["new", "no-contact"].includes(lead.status)) st.found++; else st.parked = (st.parked || 0) + 1; }
        } catch (e) { if (stopRef.current) break; st.errors.push(`${x.name}: ${e.message}`); }
        st.done++; setRun({ ...st });
      }
      st.phase = stopRef.current ? "Stopped." : `Done: ${st.found} new lead${st.found === 1 ? "" : "s"} from ${st.done} checked${st.parked ? `, ${st.parked} parked` : ""}.${mode === "maps" ? ` ${st.spent || 0} Google search${st.spent === 1 ? "" : "es"} used.` : ""}`;
      setRun({ ...st });
    } catch (e) { st.phase = `Stopped: ${e.message}`; setRun({ ...st }); }
    finally { onRunning?.(false); }
  }

  // Explicit: spend one Hunter credit on this lead now, whatever the free routes found.
  async function hunterLookup(l) {
    update(l.id, { checking: true, error: "" });
    try {
      const r = await post({ step: "contacts", lead: l, useHunter: true, forceHunter: true });
      const best = r.people.find((p) => p.email) || null;
      const f = { contacts: r.people, channels: r.channels, contactsAt: r.contactsAt, ...addressFields(r), ...(r.hunterOnFile !== undefined && r.hunterOnFile !== null ? { hunterOnFile: r.hunterOnFile } : {}), contactsTried: true, contactsStamp: contactsStamp(cfg), hunterTried: !!r.hunterUsed, ...(r.hunterUsed ? {} : { hunterOnFile: 0 }), checking: false, error: r.hunterNote || (best || r.hunterDomain ? "" : l.website ? "Hunter had nothing for this domain." : "Hunter did not recognise the company name.") };
      if (r.hunterUsed) f.hunterDomain = r.hunterDomain || String(l.website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (!l.website && r.hunterDomain) { f.website = r.hunterDomain; f.websiteConfirmed = false; f.websiteVerified = ""; f.websiteEvidence = "Hunter's company lookup"; f.caveats = [l.caveats, `Website ${r.hunterDomain} came from Hunter's company lookup; double-check it is theirs`].filter(Boolean).join("; "); }
      if (!best && !l.emailAddress && !r.hunterDomain && ["no-contact", "new", "qualified"].includes(l.status)) { f.status = "not-pursuing"; f.contactUnverified = true; }
      if (best && !l.emailAddress) { f.emailAddress = best.email; f.contactName = l.contactName || best.name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").split(" ")[0]; if (["no-contact", "not-pursuing"].includes(l.status) && l.contactUnverified) { f.status = "new"; f.contactUnverified = false; } }
      update(l.id, f);
      fetch("/api/leads").then((x) => x.json()).then(setCfg).catch(() => {});
      // A website found by name is checked straight away so the problem and the email are right.
      if (!l.website && r.hunterDomain) { try { const { lead } = await post({ step: "recheck", lead: { ...leadsRef.current[l.id], website: r.hunterDomain, emailEdited: false }, redraft: true }); update(l.id, { ...lead, checking: false }); } catch {} }
    } catch (e) { update(l.id, { checking: false, error: e.message }); }
  }
  async function findContacts(l) {
    update(l.id, { checking: true, error: "" });
    try {
      const r = await post({ step: "contacts", lead: l, useHunter: false });
      const best = r.people.find((p) => p.email) || null; const generic = r.channels.find((c) => c.kind === "email");
      const f = { contacts: r.people, channels: r.channels, contactsAt: r.contactsAt, ...addressFields(r), ...(r.hunterOnFile !== undefined && r.hunterOnFile !== null ? { hunterOnFile: r.hunterOnFile } : {}), contactsTried: true, contactsStamp: contactsStamp(cfg), hunterTried: l.hunterTried || r.hunterUsed, checking: false, error: r.people.length ? "" : "No named people found; the Companies House directors need the API key, and the site has no team page." };
      if (!l.emailAddress && (best || generic)) { f.emailAddress = best ? best.email : generic.value; if (best && !l.contactName) f.contactName = firstNameOf(best.name); }
      if (["new", "qualified", "no-contact"].includes(l.status) || (l.status === "not-pursuing" && l.contactUnverified)) { if (f.emailAddress || l.emailAddress) { f.status = "new"; f.contactUnverified = false; } else { f.contactUnverified = true; f.status = parkStatus(l); } }
      update(l.id, f);
    }
    catch (e) { update(l.id, { checking: false, error: e.message }); }
  }
  // Re-run the finder's checks on existing leads with the latest rules (statuses and notes are kept).
  const [pendingRescan, setPendingRescan] = useState(() => new Set());
  async function refreshLeads(ids) {
    stopRef.current = false;
    onRunning?.(true);
    setPendingRescan(new Set(ids)); // hidden from the board until their fresh data is in
    const knownSites = clients.flatMap((c) => c.websites || []).map((w) => String(w).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    const st = { kind: "refresh", phase: "Refreshing leads…", done: 0, total: ids.length, found: 0, errors: [] };
    setRun({ ...st });
    setPending(null);
    let left = [...ids];
    for (const id of ids) {
      if (stopRef.current) break;
      saveScan({ kind: "refresh", ids: left, done: st.done, total: st.total, found: st.found });
      left = left.slice(1);
      const l = leadsRef.current[id];
      if (!l) { st.done++; continue; }
      st.phase = `Refreshing ${l.business}…`; setRun({ ...st });
      try {
        let { lead } = await post({ step: "refresh", lead: l, knownSites });
        if (lead.website && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site") { try { st.phase = `Checking licences on ${lead.website}…`; setRun({ ...st }); ({ lead } = await post({ step: "licence", lead })); } catch {} }
        // A site you confirmed with nothing found yet is not parked: Claude decides. Claude's location beats the footer address.
        if (lead.websiteConfirmed && !lead.problem && !lead.claude && lead.status === "not-pursuing" && !l.optedOut && !l.review?.done) { lead.status = "new"; lead.likelihood = ""; lead.likelihoodWhy = "Site looks current; check with Claude for another angle"; lead.statusAt = new Date().toISOString(); }
        if (lead.claude?.location && !/^(national|online|uk|nationwide)$/i.test(lead.claude.location)) { lead.tradingTown = lead.claude.location; lead.tradesElsewhere = false; }
        update(id, lead); st.found++;
        setPendingRescan((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
      catch (e) { if (stopRef.current) { left = [id, ...left]; break; } st.errors.push(`${l.business}: ${e.message}`); setPendingRescan((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
      st.done++; setRun({ ...st });
    }
    setPendingRescan(new Set());
    if (stopRef.current && left.length) { saveScan({ kind: "refresh", ids: left, done: st.done, total: st.total, found: st.found }); setPending(loadScan()); } else saveScan(null);
    st.phase = stopRef.current ? `Stopped with ${left.length} leads still to rescan.` : `Done: ${st.found} lead${st.found === 1 ? "" : "s"} refreshed with the latest checks.`;
    setRun({ ...st });
    onRunning?.(false);
  }
  // Parked for "contact not verified": look for contacts again (new decoding, Hunter) and bring back any that now have an address.
  async function retryContacts(ids) {
    stopRef.current = false; onRunning?.(true); setPending(null);
    // Most valuable first, so the Hunter credits go where they count: High before Medium before Low,
    // bigger balance sheets first. Low leads get the free routes only.
    const rank = { High: 0, Medium: 1, Low: 2 };
    ids = ids.slice().sort((a, b) => { const x = leadsRef.current[a] || {}, y = leadsRef.current[b] || {}; return (rank[x.likelihood] ?? 3) - (rank[y.likelihood] ?? 3) || (y.netAssets || 0) - (x.netAssets || 0); });
    const st = { kind: "contacts", phase: "Looking for contacts again…", done: 0, total: ids.length, found: 0, errors: [] };
    setRun({ ...st });
    for (const id of ids) {
      if (stopRef.current) break;
      const l = leadsRef.current[id]; if (!l) { st.done++; continue; }
      const useHunter = !!cfg?.hunter && l.likelihood === "High" && !l.hunterTried && !!l.website && l.hunterOnFile !== 0;
      st.phase = `Contacts for ${l.business}${useHunter ? " (Hunter)" : ""}…`; setRun({ ...st });
      try {
        const r = await post({ step: "contacts", lead: l, useHunter });
        if (r.hunterNote && /cap reached|out of searches/i.test(r.hunterNote)) st.phase = "Hunter credits used up for this month; carrying on with the free routes only.";
        const best = r.people.find((p) => p.email) || null; const generic = r.channels.find((c) => c.kind === "email");
        const f = { contacts: r.people, channels: r.channels, contactsAt: r.contactsAt, ...addressFields(r), ...(r.hunterOnFile !== undefined && r.hunterOnFile !== null ? { hunterOnFile: r.hunterOnFile } : {}), contactsTried: true, contactsStamp: contactsStamp(cfg), hunterTried: l.hunterTried || r.hunterUsed };
        if (best || generic) { f.emailAddress = best ? best.email : generic.value; if (best) f.contactName = firstNameOf(l.contactName) || firstNameOf(best.name); f.contactUnverified = false; f.status = "new"; st.found++; }
        update(id, f);
      } catch (e) { if (stopRef.current) break; st.errors.push(`${l.business}: ${e.message}`); }
      st.done++; setRun({ ...st });
    }
    st.phase = stopRef.current ? "Stopped." : `Done: ${st.found} of ${st.done} now have a verified contact and are back on the board.`;
    setRun({ ...st }); onRunning?.(false);
    fetch("/api/leads").then((r) => r.json()).then(setCfg).catch(() => {});
  }
  function continueScan() {
    const sc = pending || loadScan();
    if (!sc) return;
    if (sc.kind === "refresh") { const st = sc; setRun({ kind: "refresh", phase: "Continuing…", done: st.done || 0, total: st.total || 0, found: st.found || 0, errors: [] }); refreshLeads(sc.ids || []); }
    else findLeads(sc);
  }
  // Leads that have never had a contact lookup get one automatically, one at a time in the background.
  const contactsRunRef = useRef(false);
  useEffect(() => {
    if (contactsRunRef.current) return;
    const todo = Object.values(leads).filter((l) => !l.contactsAt && !l.contactsTried && (l.companyNumber || l.website) && !["won", "lost", "not-pursuing"].includes(l.status));
    if (!todo.length) return;
    contactsRunRef.current = true;
    (async () => {
      for (const l of todo) {
        try {
          const r = await post({ step: "contacts", lead: l, useHunter: false });
          const cur = leadsRef.current[l.id]; if (!cur) continue;
          const best = r.people.find((p) => p.email) || null;
          const f = { contacts: r.people, channels: r.channels, contactsAt: r.contactsAt, ...addressFields(r), ...(r.hunterOnFile !== undefined && r.hunterOnFile !== null ? { hunterOnFile: r.hunterOnFile } : {}), contactsTried: true, contactsStamp: contactsStamp(cfg) };
          const generic = r.channels.find((c) => c.kind === "email");
          if (!cur.emailAddress && (best || generic)) { f.emailAddress = best ? best.email : generic.value; if (best && !cur.contactName) f.contactName = firstNameOf(best.name); }
          const email = f.emailAddress || cur.emailAddress;
          if (["new", "qualified", "no-contact"].includes(cur.status)) { if (email) { f.status = "new"; f.contactUnverified = false; } else { f.contactUnverified = true; f.status = parkStatus(cur); } }
          update(l.id, f);
        } catch { update(l.id, { contactsTried: true }); }
      }
      contactsRunRef.current = false;
    })();
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Emails written before the current wording get redrafted automatically on load.
  const redraftingRef = useRef(false);
  useEffect(() => {
    const stale = Object.values(leads).filter((l) => l.problem && !l.emailEdited && !isFrozen(l) && l.status !== "ready" && (l.draftVersion || 0) < DRAFT_VERSION);
    if (!stale.length || redraftingRef.current) return;
    redraftingRef.current = true;
    (async () => {
      try {
        const r = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "redraft-many", leads: stale, links: linksRef.current }) });
        const j = await r.json();
        for (const l of j.leads || []) update(l.id, { ...l, draftVersion: DRAFT_VERSION });
      } catch {}
      redraftingRef.current = false;
    })();
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps
  // Claude's checks (run on the user's own Claude plan) applied to each lead: website, contact, verdict, draft.
  function applyLeadCheck(items) {
    let done = 0, left = 0; const rescan = []; const doneIds = []; const moved = { skip: 0, back: 0 };
    for (const it of items) {
      const l = leadsRef.current[it.lead_id]; if (!l) continue;
      // Only leads still being assessed take Claude's answers. Ready to send and anything in conversation are never touched.
      if (!["new", "no-contact", "not-pursuing"].includes(l.status) || isFrozen(l) || (l.review?.done && l.status === "not-pursuing")) { left++; continue; }
      const f = { claude: it };
      const site = String(l.website || "").toLowerCase().replace(/^www\./, "");
      if (!it.website_is_theirs && site) {
        f.rejectedSites = [...new Set([...(l.rejectedSites || []), site])];
        if (it.correct_website && it.correct_website !== site) { f.website = it.correct_website; f.websiteConfirmed = true; f.websiteVerified = "checked by Claude"; f.websiteEvidence = it.website_evidence; rescan.push(l.id); }
        else { f.website = ""; f.websiteConfirmed = false; f.websiteVerified = ""; f.problem = "No website"; f.problemDetail = `${site} belongs to a different business; Claude couldn't find their real site`; f.websiteNeeded = true; }
        if (l.emailAddress && site && l.emailAddress.endsWith("@" + site)) { f.emailAddress = ""; f.contactName = ""; }
      } else if (!l.website && it.correct_website) { f.website = it.correct_website; f.websiteConfirmed = true; f.websiteVerified = "checked by Claude"; f.websiteEvidence = it.website_evidence; rescan.push(l.id); }
      else if (l.website && !websiteIsVerified(l)) { f.websiteVerified = "checked by Claude"; f.websiteEvidence = it.website_evidence; f.websiteDoubt = ""; }
      const c = it.contact;
      if (c.name && (c.email || c.linkedin)) {
        const contacts = [...(l.contacts || [])];
        const same = contacts.find((p) => (c.email && (p.email === c.email || p.emailGuess === c.email)) || p.name.toLowerCase() === c.name.toLowerCase());
        const person = { name: c.name, role: c.role || "Contact", source: "Claude research", why: c.email_source ? `Address published at ${c.email_source}` : "Found by Claude", ...(c.email ? { email: c.email, emailStatus: `Found by Claude${c.email_source ? `: ${c.email_source}` : ""}` } : {}), ...(c.linkedin ? { linkedin: c.linkedin } : {}) };
        if (same) Object.assign(same, { ...person, name: same.name, source: /Claude/.test(same.source || "") ? same.source : `${same.source} + Claude` }); else contacts.unshift(person);
        f.contacts = contacts;
        const current = String(f.emailAddress ?? l.emailAddress ?? "");
        if (c.email && (!current || GENERIC_BOX_RE.test(current.split("@")[0]))) { f.emailAddress = c.email; f.contactName = firstNameOf(c.name); f.contactUnverified = false; if (["no-contact", "not-pursuing"].includes(l.status) && l.contactUnverified) f.status = "new"; }
      }
      if (it.email_body && !l.emailEdited) Object.assign(f, { emailPrevious: l.email, email: it.email_body, subject: it.email_subject || l.subject, emailEdited: false, claudeDraft: true });
      // Fill the lead's fields with what Claude confirmed (shown in orange in the drawer).
      const filled = [];
      if (it.what_they_do) { f.whatTheyDo = it.what_they_do; filled.push("whatTheyDo"); if (!l.tradeOverride) f.tradeOverride = it.what_they_do.toLowerCase().replace(/[^a-z0-9 &'-]/g, "").trim().split(/\s+/).slice(0, 4).join(" "); }
      if (it.location && !/^(national|online|uk|nationwide)$/i.test(it.location.trim())) { f.tradingTown = it.location; f.tradesElsewhere = false; filled.push("tradingTown"); }
      if (it.issue_note && l.problem) { f.problemDetail = it.issue_note; filled.push("problemDetail"); }
      if (it.likelihood) { f.likelihood = it.likelihood; filled.push("likelihood"); }
      if (it.likelihood_reason || it.reason) { f.likelihoodWhy = it.likelihood_reason || it.reason; filled.push("likelihoodWhy"); }
      if (it.background) { f.background = it.background; filled.push("background"); }
      if (f.contacts) filled.push("contacts");
      if (f.email) filled.push("email");
      f.claudeFields = filled;
      // Claude's verdict decides the column, unless a conversation has already started or it was sorted by hand.
      if (!isFrozen(l) && !l.optedOut && ["new", "no-contact", "not-pursuing"].includes(l.status)) {
        const skip = !it.worth_contacting && !f.websiteNeeded && !(it.website_is_theirs === false && !it.correct_website);
        const email = f.emailAddress ?? l.emailAddress;
        if (skip) { f.status = "not-pursuing"; moved.skip++; }
        else if (email) { f.status = "new"; f.contactUnverified = false; if (l.status !== "new") moved.back++; }
        else { f.status = "no-contact"; f.contactUnverified = true; }
      }
      update(l.id, f); done++; doneIds.push(l.id);
    }
    // Once Claude's answers are in: rescan any lead on a new website, then look for contacts again on every
    // checked lead that still has no address (the site, Companies House, then Hunter under the usual rules).
    setTimeout(async () => {
      for (const id of doneIds) { const x = leadsRef.current[id]; if (x && !x.website && x.problem === "No website" && !isFrozen(x)) await tryObviousDomain(id); }
      if (rescan.length) await refreshLeads(rescan);
      const need = doneIds.filter((id) => { const x = leadsRef.current[id]; return x && x.website && !x.emailAddress && !isFrozen(x) && !x.optedOut && !claudeSkip(x) && !/under £|already a client|dormant/i.test(parkReason(x)); });
      // A contact found here moves the lead to To assess (retryContacts does that for every lead it finds an address for).
      if (need.length && !stopRef.current) await retryContacts(need);
    }, 100);
    return { done, left, doneIds, rescanned: rescan.length, moved, retry: doneIds.length };
  }
  // Claude's website search: a site it can tie to the company becomes the lead's website (confirmed, then
  // rescanned and contacts retried); a proper search that finds nothing confirms they have no website.
  // Before a lead is stamped "no website": try the company name on .co.uk and .com. A live site goes on the
  // lead for someone to confirm (and the lead is rescanned on it); true if one was found.
  async function tryObviousDomain(id) {
    const l = leadsRef.current[id];
    if (!l || l.website) return false;
    let domain = "";
    try { ({ domain } = await post({ step: "domain-check", name: l.business })); } catch { return false; }
    if (!domain || (l.rejectedSites || []).includes(domain)) return false;
    const cur = leadsRef.current[id];
    update(id, { website: domain, websiteConfirmed: false, websiteVerified: "", websiteEvidence: "the company name on .co.uk / .com", websiteNeeded: false, noWebsiteConfirmed: false, ...(cur.problem === "No website" ? { problem: "", problemDetail: "" } : {}), ...(cur.claude ? { claude: { ...cur.claude, issue_confirmed: false } } : {}), notesLog: [...(cur.notesLog || []), { at: new Date().toISOString(), text: `Found ${domain} by trying the company name before marking it as having no website` }] });
    await refreshLeads([id]);
    return true;
  }
  async function applySites(list) {
    let found = 0, none = 0, unsure = 0, left = 0;
    const rescan = [];
    for (const it of list) {
      const l = leadsRef.current[it.lead_id];
      if (!l || l.website || !siteSearchable(l)) { left++; continue; }
      const at = new Date().toISOString();
      const rejected = (l.rejectedSites || []).map((x) => String(x).toLowerCase());
      if (it.website && it.confidence !== "low" && !rejected.includes(it.website)) {
        const parkedForFacts = /under £|already a client|dormant/i.test(parkReason(l));
        update(l.id, { website: it.website, websiteConfirmed: true, websiteVerified: "checked by Claude", websiteEvidence: it.evidence || "checked by Claude", websiteNeeded: false, websiteDoubt: "", siteUrl: "", sitesCheckedAt: at, noWebsiteConfirmed: false, claude: null, claudeFields: [], ...(l.problem === "No website" ? { problem: "", problemDetail: "" } : {}), ...(["not-pursuing", "no-contact"].includes(l.status) && !parkedForFacts ? { status: "new" } : {}), caveats: String(l.caveats || "").split("; ").filter((x) => x && !/no website|not found by name|confirm the website/i.test(x)).join("; ") });
        rescan.push(l.id); found++;
      } else if (it.website) {
        update(l.id, { sitesCheckedAt: at, siteSuggestion: it.website, notesLog: [...(l.notesLog || []), { at, text: `Claude thinks the website might be ${it.website} but isn’t sure: ${it.evidence}` }] });
        unsure++;
      } else if (it.has_website === false) {
        if (await tryObviousDomain(l.id)) { found++; continue; }
        update(l.id, { websiteNeeded: false, noWebsiteConfirmed: true, sitesCheckedAt: at, problem: "No website", problemDetail: `Claude searched and found no website${it.other ? ` (only ${it.other})` : ""}.`, caveats: String(l.caveats || "").split("; ").filter((x) => x && !/not found by name|could trade under another name/i.test(x)).join("; ") });
        none++;
      } else { update(l.id, { sitesCheckedAt: at }); unsure++; }
    }
    setTimeout(async () => {
      if (rescan.length) await refreshLeads(rescan);
      const need = rescan.filter((id) => { const x = leadsRef.current[id]; return x && x.website && !x.emailAddress && !isFrozen(x) && !x.optedOut; });
      if (need.length && !stopRef.current) await retryContacts(need);
    }, 100);
    return { found, none, unsure, left, ids: list.map((x) => x.lead_id) };
  }
  // Replies pasted into the one "Paste from Claude" box land here, whichever prompt they came from.
  useClaudeHandler("lead-check", (text) => {
    const list = parseLeadCheck(text);
    if (!list.length) throw new Error("No leads in that reply. Make sure Claude kept the lead_id values.");
    const r = applyLeadCheck(list);
    return [`${r.done} lead${r.done === 1 ? "" : "s"} updated`, r.left && `${r.left} left alone (Ready to send or in conversation)`, r.moved.back && `${r.moved.back} back to To assess`, r.moved.skip && `${r.moved.skip} to Not pursuing`, r.rescanned && `${r.rescanned} rescanning on a new website`].filter(Boolean).join(" · ");
  });
  useClaudeHandler("find-sites", async (text) => {
    const r = await applySites(parseSitesReply(text));
    return [r.found && `${r.found} website${r.found === 1 ? "" : "s"} found (rescanning)`, r.none && `${r.none} confirmed with no website`, r.unsure && `${r.unsure} unsure (noted on the lead)`, r.left && `${r.left} left alone`].filter(Boolean).join(" · ") || "Nothing to update.";
  });
  useClaudeHandler("find-leads", (text) => {
    const items = parseFoundLeads(text);
    if (!items.length) throw new Error("No businesses in that reply.");
    if (running) throw new Error("A scan is running. Paste this again when it finishes.");
    findOutside("claude", items.map((x) => ({ id: `cl:${slug(x.name)}${slug(x.town)}`, name: x.name, companyNumber: x.companyNumber, website: x.website, websiteEvidence: x.website ? "checked by Claude" : "", town: x.town, postcode: x.postcode, whatTheyDo: x.whatTheyDo, issue: x.issue, why: x.why, contact: x.contact, source: "Claude", triggerKind: "claude", trigger: x.why })));
    return `Checking ${items.length} business${items.length === 1 ? "" : "es"}: they appear on the board as each one is done.`;
  });
  useClaudeHandler("draft", (text) => {
    const d = parseDraftReply(text);
    let id = ""; try { const m = String(text).match(/"lead_id"\s*:\s*"([^"]+)"/); id = m ? m[1] : ""; } catch {}
    const l = leadsRef.current[id] || (open ? leadsRef.current[open] : null);
    if (!l) throw new Error("Couldn't tell which lead this draft is for. Open the lead, then paste again.");
    update(l.id, { subject: d.subject || l.subject, email: d.body, emailEdited: true, emailPrevious: l.email && l.email !== d.body ? l.email : l.emailPrevious, review: { ...(l.review || {}), step: 3, drafted: new Date().toISOString() } });
    return `Draft added to ${l.business}.`;
  });
  async function checkLicence(l) {
    update(l.id, { checking: true, error: "" });
    try { const { lead } = await post({ step: "licence", lead: l }); update(l.id, { ...lead, checking: false, error: lead.licence?.error || "" }); }
    catch (e) { update(l.id, { checking: false, error: e.message }); }
  }
  async function recheck(l, redraft = false) {
    update(l.id, { checking: true, error: "" });
    const person = redraft ? ((l.contacts || []).find((p) => p.email && p.email === l.emailAddress) || null) : null;
    try { const { lead } = await post({ step: redraft ? "redraft" : "recheck", lead: { ...l, emailEdited: false }, person }); update(l.id, { ...lead, emailEdited: false, emailPrevious: l.email && l.email !== lead.email ? l.email : l.emailPrevious, checking: false, error: "" }); }
    catch (e) { update(l.id, { checking: false, error: e.message }); }
  }

  async function exportExcel() {
    const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "leads", results: sorted(list) }) });
    const blob = await r.blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `website-leads-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  }

  // Leaving mid-scan loses nothing (it can be continued), but warn anyway.
  // A run is in progress only while its loop is going; summary lines (Done, Stopped, floor changes) are not runs.
  const running = !!run && run.kind !== "floor" && !/^(Done|Stopped)/.test(run.phase);
  // Admin jobs live in Settings → Lead maintenance, which opens this page with ?admin=rescan or ?admin=contacts.
  const adminRef = useRef(false);
  useEffect(() => {
    if (adminRef.current || !list.length || running) return;
    const job = new URLSearchParams(window.location.search).get("admin");
    if (!job) return;
    adminRef.current = true;
    const u = new URL(window.location.href); u.searchParams.delete("admin"); window.history.replaceState(null, "", u.toString());
    setTimeout(() => {
      if (job === "rescan") refreshLeads(list.filter((l) => !["won", "lost", "not-pursuing", "ready"].includes(l.status)).map((l) => l.id));
      if (job === "contacts") retryContacts(list.filter((l) => !isFrozen(l) && (l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified && !contactExhausted(l)))).map((l) => l.id));
    }, 300);
  }, [list.length, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const areaTitle = areaState.outcodes ? `Every active trading company registered within ${areaMiles} miles of ${areaCentres.join(", ")}: ${areaState.outcodes} postcode areas, searched as ${areaState.places || 0} towns and districts. Anything registered further out is dropped. Type a town or postcode and press Enter to add it.` : "Type a town or postcode and press Enter. Until an area is set, the scan covers about 20 minutes around Richmond.";
  // Licence and search checks run on their own for any lead that never had them (older leads, or ones
  // parked as "site is current" before search visibility counted), a few at a time, when nothing else is running.
  const catchingUpRef = useRef(false);
  useEffect(() => {
    if (running || catchingUpRef.current) return;
    const siteOk = (l) => l.website && l.problem !== "Parked domain" && l.problem !== "Dead/broken site" && !l.checking;
    const open = (l) => ["new", "qualified", "no-contact"].includes(l.status) && !!l.problem;
    // Leads from before websites were verified get the free check (company number, postcode, director on the site).
    const toVerify = Object.values(leadsRef.current).filter((l) => siteOk(l) && l.websiteVerified === undefined && !isFrozen(l)).sort((x, y) => (open(x) ? 0 : 1) - (open(y) ? 0 : 1));
    const todo = Object.values(leadsRef.current).filter((l) => siteOk(l) && open(l) && websiteIsVerified(l) && !l.licence);
    if (!toVerify.length && !todo.length) return;
    catchingUpRef.current = true;
    (async () => {
      for (const l of toVerify) {
        if (stopRef.current) break;
        try { const v = await post({ step: "verify-site", lead: l }); update(l.id, { websiteVerified: v.evidence || "", websiteEvidence: v.evidence || v.soft || leadsRef.current[l.id]?.websiteEvidence || "name on the site", ...(v.conflict ? { websiteDoubt: `Website may be wrong: ${v.conflict}, not ${l.companyNumber}. Check it, or mark it as not theirs.` } : {}) }); }
        catch { update(l.id, { websiteVerified: "" }); }
      }
      for (const l of todo) {
        if (stopRef.current) break;
        const cur = leadsRef.current[l.id]; if (!cur) continue;
        if (!cur.licence) await checkLicence(cur);
      }
      catchingUpRef.current = false;
    })();
  }, [leads, running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return;
    const h = (e) => { e.preventDefault(); e.returnValue = "A lead scan is still running. Leave anyway? You can continue it from where it stopped."; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  const q = filter.trim().toLowerCase();
  const visible = list.filter((l) => !pendingRescan.has(l.id) && (!q || `${l.business} ${l.area} ${l.website} ${l.problem} ${l.notes || ""}`.toLowerCase().includes(q)) && (!showProblem || l.problem === showProblem));
  const isLowNew = (l) => (l.status || "new") === "new" && l.likelihood === "Low";
  const parkedCount = visible.filter((l) => ["not-pursuing", "lost"].includes(l.status)).length;
  const lowCount = visible.filter(isLowNew).length;
  const filtering = !!q || !!showProblem;
  const onBoard = visible.filter((l) => (showParked || filtering || !["not-pursuing", "lost"].includes(l.status)) && (showLow || filtering || !isLowNew(l)));
  const current = open ? leads[open] : null;
  // Review one by one: the next lead in the same column that hasn't been reviewed (skipped ones go to the back).
  const skippedRef = useRef(new Set());
  function reviewNext(status, afterId = null) {
    if (afterId) skippedRef.current.add(afterId);
    const col = sorted(Object.values(leadsRef.current).filter((x) => (x.status || "new") === status && !x.review?.done && !x.optedOut && x.id !== afterId));
    const next = col.find((x) => !skippedRef.current.has(x.id)) || null;
    if (!next) skippedRef.current = new Set();
    setOpen(next ? next.id : null);
  }

  return (
    <div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Website Leads</h2>
        {cfg && !cfg.configured && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Companies House is not connected yet. Add the free API key in <Link href="/settings?section=connections" className="underline">Settings → Connections</Link>. The board below still works.</p>}
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex min-w-[16rem] flex-1 flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1 ${areaState.error ? "border-red-300" : "border-zinc-300"}`} title={areaTitle}>
              <PinIcon className="h-4 w-4 shrink-0 text-zinc-400" />
              {areaCentres.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">{c}<button onClick={() => saveArea(areaCentres.filter((x) => x !== c), areaMiles)} disabled={running} aria-label={`Remove ${c}`} className="text-zinc-400 hover:text-red-600 disabled:opacity-40">×</button></span>
              ))}
              <input value={areaDraft} onChange={(e) => setAreaDraft(e.target.value)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && areaDraft.trim()) { e.preventDefault(); saveArea([...areaCentres, areaDraft.trim()], areaMiles); setAreaDraft(""); } else if (e.key === "Backspace" && !areaDraft && areaCentres.length > 1) saveArea(areaCentres.slice(0, -1), areaMiles); }} onBlur={() => { if (areaDraft.trim()) { saveArea([...areaCentres, areaDraft.trim()], areaMiles); setAreaDraft(""); } }} disabled={running} placeholder={areaCentres.length ? "Add a town or postcode" : "Town or postcode"} className="min-w-[9rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none" />
              <span className="shrink-0 text-xs text-zinc-500">{areaState.busy ? "Mapping…" : areaState.error ? <span className="text-red-700">{areaState.error}</span> : areaState.outcodes ? `${areaState.outcodes} postcode areas` : ""}</span>
            </div>
            <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700" title="How far from the locations to look. Companies registered outside it are dropped.">within
              <input type="number" min={1} max={30} value={areaMilesDraft} onChange={(e) => setAreaMilesDraft(e.target.value)} onBlur={() => { const n = Math.max(1, Math.min(30, Number(areaMilesDraft) || areaMiles)); setAreaMilesDraft(String(n)); if (n !== areaMiles) saveArea(areaCentres, n); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} disabled={running} className="w-12 rounded border border-zinc-200 px-1 py-0.5 text-sm" /> miles
            </label>
            {!running && pending && (
              <button onClick={continueScan} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"><PlayIcon className="h-4 w-4" /> Continue {pending.kind === "refresh" ? "rescan" : "scan"} ({(pending.queue || pending.ids || []).length} left)</button>
            )}
            <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} disabled={running} title={(LEAD_SOURCES.find((x) => x[0] === leadSource) || [])[2]} className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm disabled:opacity-40">
              {LEAD_SOURCES.map(([k, label]) => <option key={k} value={k}>{label}{k === "jobs" && cfg && !cfg.jobs ? " (connect Adzuna)" : k === "maps" && cfg && !cfg.places ? " (connect Google)" : ""}</option>)}
            </select>
            {leadSource === "maps" && (
              <select value={MAPS_TYPES.some(([, t]) => t.includes(mapsWhat)) ? mapsWhat : ""} onChange={(e) => setMapsWhat(e.target.value)} disabled={running} title="What kind of business to look for on Google Maps" className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm disabled:opacity-40">
                <option value="">Business type…</option>
                {MAPS_TYPES.map(([group, types]) => <optgroup key={group} label={group}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>)}
              </select>
            )}
            {running
              ? <button onClick={stopNow} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
              : <button onClick={() => findLeads()} disabled={cfg?.configured === false} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><SearchIcon className="h-4 w-4" /> {leadSource === "claude" ? "Ask Claude" : "Find leads"}</button>}
            <button onClick={exportExcel} disabled={!list.length} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><DownloadIcon className="h-4 w-4" /> Excel</button>
          </div>
        </div>
        {leadSource === "maps" && cfg?.places && <p className="mt-2 text-xs text-zinc-500">Google Maps searches this month: <span className="font-semibold">{cfg.placesUsage?.used || 0}</span> of {cfg.placesUsage?.cap || 900} free. Each run uses 1 to 3 per location; repeating a search within 30 days is free.</p>}
        {leadSource === "jobs" && <p className="mt-2 text-xs text-zinc-500"><a href="https://www.adzuna.co.uk" target="_blank" rel="noreferrer" className="underline">Jobs by Adzuna</a>. Recruitment agencies are left out.</p>}
        {cfg?.hunter && cfg.hunterUsage?.cap > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {cfg?.hunter && cfg.hunterUsage?.cap > 0 && <span title="One Hunter credit per lead, spent only on High leads where the site and Companies House gave no address, and only when Hunter holds named people. Medium and Low leads and background lookups never use one.">Hunter.io credits used this month: <span className={cfg.hunterUsage.used >= cfg.hunterUsage.cap ? "font-semibold text-red-700" : "font-semibold"}>{cfg.hunterUsage.used}</span> of {cfg.hunterUsage.cap}. Spent only on High leads the free routes couldn&apos;t find an address for.</span>}
          </p>
        )}
        {run && (
          <div className="mt-3 text-sm">
            <div className="flex items-center gap-2">{running && <SpinnerIcon className="h-4 w-4 text-blue-600" />}<span className={running ? "text-blue-700" : "text-zinc-700"}>{run.phase}</span>{run.total > 0 && <span className="text-xs text-zinc-500">{run.kind === "refresh" ? `${run.done} of ${run.total} rescanned` : run.kind === "contacts" ? `${run.done} of ${run.total} looked up · ${run.found} now have a contact` : `${run.done} of ${run.total} checked · ${run.found} new lead${run.found === 1 ? "" : "s"}${run.parked ? ` · ${run.parked} parked` : ""}`}</span>}</div>
            {run.total > 0 && <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} /></div>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search leads" className="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
        <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700" title="Company size: what the company is worth on paper (net assets in its latest accounts). Only keep companies worth at least this. Changing it re-sorts the board: parked leads above the new floor come back, open leads below it are parked. Leads already in conversation are left alone.">Company size ≥ £<input type="number" value={minAssets} onChange={(e) => setMinAssets(Number(e.target.value) || 0)} step={5000} min={0} className="w-20 rounded border border-zinc-200 px-1.5 py-0.5 text-sm" /></label>
        <select value={showProblem} onChange={(e) => setShowProblem(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">All problems</option>
          {PROBLEMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {parkedCount > 0 && <button onClick={() => setShowParked((v) => !v)} className={`rounded-full border px-2.5 py-1 text-xs ${showParked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{showParked ? "Hide" : "Show"} Not pursuing &amp; Lost ({parkedCount})</button>}
        {lowCount > 0 && <button onClick={() => setShowLow((v) => !v)} className={`rounded-full border px-2.5 py-1 text-xs ${showLow ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{showLow ? "Hide" : "Show"} Low in To assess ({lowCount})</button>}
        <span className="text-xs text-zinc-500">{onBoard.length} of {list.length} leads · drag a card to change its status{pendingRescan.size ? <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">{pendingRescan.size} hidden until rescanned</span> : null}</span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm shadow-sm">
          <span className="font-medium">{selected.size} selected</span>
          <label className="inline-flex items-center gap-1.5">Move to
            <select defaultValue="" onChange={(e) => { if (e.target.value) { moveMany([...selected], e.target.value); setSelected(new Set()); e.target.value = ""; } }} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
              <option value="" disabled>status…</option>
              {LEAD_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <button onClick={() => { const ids = [...selected]; setSelected(new Set()); refreshLeads(ids); }} disabled={running} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" /> Rescan selected</button>
          <button onClick={() => setSelected(new Set())} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100">Clear selection</button>
          <button onClick={() => { if (confirm(`Delete ${selected.size} lead${selected.size === 1 ? "" : "s"}?`)) removeMany([...selected]); }} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"><TrashIcon className="h-3.5 w-3.5" /> Delete</button>
        </div>
      )}
      {findClaude && <FindLeadsModal area={areaCentres.join(", ")} miles={areaMiles} exclude={list.slice(-80).map((l) => l.business)} onClose={() => setFindClaude(false)} />}
      {sitesFor && <FindSitesModal leads={list} preset={sitesFor.ids} onClose={() => setSitesFor(null)} onApply={applySites} />}
      {claudeFor && <LeadCheckModal leads={list} preset={claudeFor.ids} column={claudeFor.col} onClose={() => setClaudeFor(null)} onApply={applyLeadCheck} />}
      <Board onFindSites={() => setSitesFor({ ids: [] })} onReview={(col) => { skippedRef.current = new Set(); reviewNext(col); }} onClaude={(col) => setClaudeFor({ col, ids: [] })} hideCols={showParked || filtering ? [] : ["not-pursuing", "lost"]} leads={onBoard} followUp={followUp} filtering={!!q || !!showProblem} selected={selected} onToggle={toggle} onSelectColumn={selectIds} onOpen={setOpen}
        onMove={(id, status) => { if (selected.has(id)) { moveMany([...selected], status); setSelected(new Set()); } else update(id, { status }); }} />

      {current && <LeadDrawer key={current.id} onNoSite={async (extra = {}) => { if (await tryObviousDomain(current.id)) return false; update(current.id, { websiteNeeded: false, noWebsiteConfirmed: true, problem: "No website", problemDetail: "Checked by hand: they have no website", ...extra }); return true; }} onFindSite={() => setSitesFor({ ids: [current.id] })} onNext={(status, done) => { if (done) skippedRef.current.delete(current.id); reviewNext(status, current.id); }} onClaude={() => setClaudeFor({ col: current.status === "no-contact" || current.status === "not-pursuing" ? current.status : "new", ids: [current.id] })} l={current} followUp={followUp} hunterOn={!!cfg?.hunter} subjects={linksRef.current?.subjects || {}} onClose={() => setOpen(null)} onChange={(f) => update(current.id, f)} onRemove={() => remove(current.id)} onRecheck={(redraft) => recheck(current, redraft)} onContacts={() => findContacts(current)} onHunter={() => hunterLookup(current)} onLicence={() => checkLicence(current)} onRefresh={() => refreshLeads([current.id])} />}
    </div>
  );
}

// The real reason a lead sits in Not pursuing, if there is one beyond a missing contact.
const parkReason = (l) => { const m = `${l.caveats || ""}; ${l.likelihoodWhy || ""}`.split(/;\s*/).find((x) => /under £|already a client|site is current|dormant/i.test(x)); if (m) return m.trim().replace(/\.$/, ""); if (claudeSkip(l)) return "Not worth contacting (AI check)"; if (contactExhausted(l)) return "Verified email not found"; return ""; };
// First sentence only, no bracketed asides, kept short.
const oneLine = (t) => { let x = String(t || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); const m = x.match(/^(.+?[.!?])(\s|$)/); if (m) x = m[1]; return x.length > 170 ? `${x.slice(0, 167).replace(/\s+\S*$/, "")}…` : x; };
// Only Claude's own verdict parks a lead: an unconfirmed issue is fine when Claude still says to contact them.
// Claude couldn't find their real website: that's for us to look up, not a reason to park the lead.
const websiteUnknown = (l) => !!l.claude && l.claude.website_is_theirs === false && !l.claude.correct_website && !l.website && !l.noWebsiteConfirmed;
const claudeSkip = (l) => !!l.claude && !l.claude.worth_contacting && !websiteUnknown(l) && !l.websiteNeeded;
// Parked for a reason Claude could change (contact, site, issue), not a fact like size, dormancy or being a client.
// No website found yet and still worth one: open, not opted out, not parked for size, dormancy or being a client.
const siteSearchable = (l) => !isFrozen(l) && !l.optedOut && !l.noWebsiteConfirmed && ["new", "no-contact", "not-pursuing"].includes(l.status || "new") && !/under £|already a client|dormant/i.test(parkReason(l));
const recheckable = (l) => !isFrozen(l) && !l.optedOut && !(l.review?.done && l.status === "not-pursuing") && !claudeSkip(l) && (l.status === "no-contact" || (l.status === "not-pursuing" && !/under £|already a client|dormant/i.test(parkReason(l))));
// The same reason spelled out with the numbers, for the top of the lead page.
function parkExplain(l) {
  const r = parkReason(l);
  if (!r) {
    if (l.contactUnverified && !l.emailAddress) return "No verified email address was found on the site or at Companies House, so there is nobody to write to.";
    if (!l.problem) return "The site is current and no licence problems were found, so there is nothing to pitch.";
    if (l.autoMoved) return l.autoMoved + ".";
    return "Moved here by hand; no automatic reason was recorded.";
  }
  if (/dormant/i.test(r)) return `Filed as dormant at Companies House (accounts to ${l.accountsDate || "the last filing"}). The company isn't trading, so whatever the site looks like there is nobody to sell to.`;
  if (/under £/i.test(r)) { const floor = (r.match(/£([\d,]+)/) || [])[1]; return `Net assets are ${l.netAssets != null ? `£${Math.round(l.netAssets).toLocaleString("en-GB")}` : "unknown"}${l.reChange != null && l.reChange < 0 ? ` and fell by £${Math.abs(Math.round(l.reChange)).toLocaleString("en-GB")} last year` : ""}, under the £${floor || "20,000"} floor set for the scan. Too small to have a budget for this.`; }
  if (/already a client/i.test(r)) return `${l.website || "This site"} is already one of ours.`;
  if (/^Claude/.test(r)) return `Claude checked it and suggests skipping: ${l.claude.reason || "not worth contacting"}${!l.claude.issue_confirmed && l.claude.issue_note ? ` The issue: ${l.claude.issue_note}` : ""}`;
  if (/site is current/i.test(r)) return "The site is current and no licence problems were found, so there is nothing to pitch.";
  if (/Verified email not found/i.test(r)) return `No verified email address anywhere: the website and Companies House gave nothing${l.hunterTried ? " and a Hunter credit was spent with no result" : l.hunterOnFile === 0 ? " and Hunter has nothing on file" : ""}. Add an address by hand if you find one and it comes straight back.`;
  return r;
}
const addressFields = (r) => ({ ...(r.tradingPostcode ? { tradingPostcode: r.tradingPostcode, tradingAddress: r.tradingAddressText, tradesElsewhere: !!r.tradesElsewhere, ...(r.caveats !== undefined ? { caveats: r.caveats } : {}) } : {}), ...(r.websiteDoubt !== undefined ? { websiteDoubt: r.websiteDoubt || "" } : {}) });
const FOLLOW_UP_DEFAULTS = { chaseDays: 7, coldDays: 21, lostDays: 60 };
// What a contact lookup "knows": the logic version plus whether Hunter was available. A parked lead
// is only worth retrying when this has changed since its last lookup.
const contactsStamp = (cfg) => `${CONTACTS_VERSION}${cfg?.hunter ? "h" : ""}`;
const daysSince = (l) => (Date.now() - new Date(l.statusAt || l.updatedAt || l.addedAt || Date.now()).getTime()) / 86400000;
const needsChase = (l, f) => l.status === "contacted" && daysSince(l) >= f.chaseDays && !l.chasedAt && !l.optedOut;
const PLACES = {
  richmond: ["Twickenham", "Hampton", "Hampton Hill", "Hampton Wick", "Teddington", "Richmond", "East Sheen", "Mortlake", "Barnes", "Kew", "St Margarets", "Whitton", "Strawberry Hill", "Ham", "Petersham"],
  kingston: ["Kingston upon Thames", "Surbiton", "New Malden", "Chessington", "Tolworth"],
  hounslow: ["Hounslow", "Chiswick", "Isleworth", "Brentford", "Feltham"],
  wandsworth: ["Putney", "Wandsworth", "Wimbledon", "Southfields", "Earlsfield"],
  spelthorne: ["Sunbury-on-Thames", "Sunbury", "Shepperton", "Staines-upon-Thames", "Staines", "Ashford", "Walton-on-Thames", "Hersham", "East Molesey", "West Molesey", "Weybridge", "Hanworth"],
};

// Anything moved into a column in the last day sits at the top (newest first); the rest by likelihood and size.
// Newest arrival in the column first (moved or added), then likelihood and size for ties.
const arrived = (l) => Date.parse(l.statusAt || l.addedAt || "") || 0;
const sorted = (list) => list.slice().sort((a, b) => arrived(b) - arrived(a) || ({ High: 0, Medium: 1, Low: 2 }[a.likelihood] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.likelihood] ?? 3) || (b.netAssets || 0) - (a.netAssets || 0));

function Board({ leads, followUp, filtering, selected, onToggle, onSelectColumn, onOpen, onMove, onClaude, onReview, onFindSites, hideCols = [] }) {
  const [over, setOver] = useState(null);
  const [shown, setShown] = useState({}); // cards rendered per column; big columns page in
  // While searching or filtering, only columns with a match are shown.
  const cols = LEAD_STATUSES.map(([id, label, hint]) => ({ id, label, hint, items: sorted(leads.filter((l) => (l.status || "new") === id)) })).filter((c) => !hideCols.includes(c.id) && (!filtering || c.items.length));
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-3">
      {!cols.length && <p className="text-sm text-zinc-500">No leads match.</p>}
      {cols.map((c) => (
        <div key={c.id} onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/lead"); if (id) onMove(id, c.id); setOver(null); }}
          className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${over === c.id ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-100/60"} ${c.id === "lost" ? "opacity-50 hover:opacity-100" : ""}`}>
          <div className="flex items-center gap-1.5 px-1 text-xs font-semibold text-zinc-700">
            <input type="checkbox" aria-label={`Select everything in ${c.label}`} title="Select everything in this column" checked={c.items.length > 0 && c.items.every((l) => selected.has(l.id))} onChange={(e) => onSelectColumn(c.items.map((l) => l.id), e.target.checked)} disabled={!c.items.length} className="h-3.5 w-3.5" />
            <span>{c.label}</span><span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">{c.items.length}</span>
          </div>
          <div className="px-1 pb-2 text-[11px] font-normal text-zinc-500">{c.hint}</div>
          {(() => { const n = c.items.filter((l) => !l.website && siteSearchable(l) && !l.sitesCheckedAt).length; return n > 0 && <button onClick={onFindSites} title="Free on your Claude plan: Claude searches for each company's real website, or confirms they don't have one" className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100">Find websites with Claude ({n})</button>; })()}
          {(c.id === "new" || c.id === "no-contact") && c.items.some((l) => !l.review?.done) && <button onClick={() => onReview(c.id)} title="Go through these one at a time: look at the site, pick the issue and approach, then draft the email with Claude" className="mb-2 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100">Review one by one ({c.items.filter((l) => !l.review?.done).length})</button>}
          {(c.id === "new" || c.id === "no-contact" || c.id === "not-pursuing") && (() => { const todo = c.items.filter((l) => !l.claude && (c.id === "new" || recheckable(l))).length; return c.items.length > 0 && <button onClick={() => onClaude(c.id)} title={c.id === "new" ? "Free on your Claude plan: Claude checks the website, the issue and the best contact for a batch of leads" : "Claude re-checks parked leads: anything worth pursuing with a published email moves back to To assess (size, dormant and existing clients are left out)"} className="mx-1 mb-2 inline-flex items-center justify-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-900 hover:bg-orange-100"><SearchIcon className="h-3 w-3" /> {c.id === "new" ? "Check" : "Re-check"} with Claude ({todo ? `${todo} new of ${c.items.length}` : `all ${c.items.length}`})</button>; })()}
          <div className="flex flex-1 flex-col gap-2">
            {c.items.slice(0, shown[c.id] || 60).map((l) => (
              <div key={l.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/lead", l.id); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(l.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(l.id); }}
                className={`cursor-grab rounded-lg border bg-white p-2.5 text-left shadow-sm hover:border-zinc-400 active:cursor-grabbing ${selected.has(l.id) ? "border-blue-500 ring-1 ring-blue-300" : "border-zinc-200"}`}>
                <div className="flex items-start gap-1.5">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggle(l.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${l.business}`} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-sm font-medium leading-tight">{l.business}</span>
                  {["new", "no-contact"].includes(c.id) && (!l.claude
                    ? <span className="whitespace-nowrap rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800" title="Not checked by Claude yet: use Check with Claude at the top of the column">Needs checking</span>
                    : l.likelihood && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${LIKELY[l.likelihood]}`} title={l.likelihoodWhy || ""}>{l.likelihood}</span>)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                  {l.problem && <span className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${PROBLEM_TONE[l.problem] || "bg-zinc-500"}`}>{l.problem}</span>}
                  {l.review?.step > 1 && !l.review?.done && ["new", "no-contact"].includes(c.id) && <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 font-semibold text-zinc-700" title="Review in progress">Step {l.review.step}/3</span>}
                  {TRIGGER_TAG[l.triggerKind] && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800" title={l.trigger}>{TRIGGER_TAG[l.triggerKind]}</span>}
                  {l.contactUnverified && c.id !== "no-contact" && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">Contact not verified</span>}
                  {l.noWebsiteConfirmed && !l.website && <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 font-semibold text-zinc-700" title={l.problemDetail}>No site ✓</span>}
                  {l.websiteNeeded && !l.website && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="Claude couldn't find their real website. Open the lead to paste it in, or confirm they have none.">Find website</span>}
                  {l.claude && !l.websiteNeeded && <span className={`rounded-full px-1.5 py-0.5 font-semibold ${l.claude.worth_contacting ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800"}`} title={l.claude.reason}>{l.claude.worth_contacting ? "AI checked ✓" : "Not worth it"}</span>}
                  {l.optedOut && <span className="rounded-full bg-red-600 px-1.5 py-0.5 font-semibold text-white" title={`Asked not to be contacted${l.optedOutAt ? ` on ${new Date(l.optedOutAt).toLocaleDateString("en-GB")}` : ""}`}>Opted out</span>}
                  {l.tradesElsewhere && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-800" title={`Website address: ${l.tradingAddress}`}>Trades elsewhere</span>}
                  {siteDoubt(l) && websiteIsVerified(l) && !isFrozen(l) && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-800" title={l.websiteDoubt}>Check website</span>}
                  {!websiteIsVerified(l) && !isFrozen(l) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="The website was matched on its name only. Open the lead and confirm it is theirs before anything goes out.">Confirm website</span>}
                  {needsChase(l, followUp) && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 font-semibold text-white" title={`No reply ${Math.floor(daysSince(l))} days after contact: send the follow-up`}>Chase</span>}
                  {l.status === "contacted" && l.chasedAt && <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-zinc-700">Chased {new Date(l.chasedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  <span>{l.area}</span>
                  {l.netAssets != null && l.netAssets !== "" && <span title={`Company worth ${money(l.netAssets)} (net assets)`}>· {compact(l.netAssets)}</span>}
                </div>
                {c.id === "not-pursuing" && <div className="mt-1 truncate text-[11px] font-medium text-red-700" title={parkExplain(l)}>{parkReason(l) || (l.contactUnverified && !l.emailAddress ? "No verified email address" : !l.problem ? "Site is current" : "Moved by hand")}</div>}
                {l.checking && <div className="mt-1 text-[11px] text-blue-600">Checking…</div>}
              </div>
            ))}
            {!c.items.length && <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-[11px] text-zinc-400">Drop here</div>}
            {c.items.length > (shown[c.id] || 60) && <button onClick={() => setShown({ ...shown, [c.id]: (shown[c.id] || 60) + 100 })} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">Show {Math.min(100, c.items.length - (shown[c.id] || 60))} more of {c.items.length}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

const accountsYear = (d) => { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
// Is the figure from the most recent accounts? Companies House says when the next set is due and whether it is late.
function accountsNote(l) {
  if (!l.accountsDate || l.netAssets === null || l.netAssets === undefined) return null;
  const due = l.accountsNextDue ? new Date(l.accountsNextDue).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const months = (Date.now() - new Date(l.accountsDate).getTime()) / (30.4 * 86400000);
  if (l.accountsOverdue) return <div className="text-[11px] text-red-700">Older year: newer accounts {due ? `were due ${due}` : "are overdue"}</div>;
  if (months <= 21) return <div className="text-[11px] text-emerald-700">Latest accounts filed{due ? ` · next due ${due}` : ""}</div>;
  return <div className="text-[11px] text-amber-700">Older year{due ? ` · next due ${due}` : ""}</div>;
}
// A textarea that always shows its whole text: it grows (and shrinks) to fit, so nothing needs dragging out.
function AutoTextarea({ value, minRows = 2, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} rows={minRows} className={`resize-none overflow-hidden ${className}`} {...rest} />;
}
function Field({ label, title, children }) {
  return <div title={title}><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div><div className="mt-0.5 text-sm">{children}</div></div>;
}
function TextField({ label, value, onChange, rows = 2, mono = false, ai = false }) {
  return (
    <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}{ai && <span className="ml-1 normal-case tracking-normal text-orange-600">· from Claude</span>}</div>
      <AutoTextarea value={value || ""} onChange={(e) => onChange(e.target.value)} minRows={rows} className={`mt-0.5 w-full rounded-md border px-2 py-1 text-sm ${ai ? "border-orange-300 bg-orange-50/60" : "border-zinc-300"} ${mono ? "font-mono text-xs" : ""}`} />
    </label>
  );
}

// Pick a person: their address goes in To and the greeting uses their first name.
function pickPerson(l, p, onChange, subjects = {}) {
  const first = firstNameOf(p.name);
  const email = p.email || l.emailAddress || "";
  const verified = !!p.email;
  // Remember the draft for the person we are leaving, bring back the one for this person if there is one,
  // otherwise write a fresh one on the issue their role would care about (not one already given to a colleague).
  const drafts = { ...(l.drafts || {}) };
  if (l.emailAddress && l.email) drafts[l.emailAddress] = { subject: l.subject || "", email: l.email, issueId: l.issueId || "", edited: !!l.emailEdited };
  let next = drafts[email];
  if (!next) {
    const taken = Object.entries(drafts).filter(([k]) => k !== email).map(([, d]) => d.issueId).filter(Boolean);
    const issue = pickIssue(l, p, taken);
    const d = draftFor(l, p, issue, subjects);
    next = { subject: d.subject, email: d.body, issueId: d.issueId, edited: false };
  }
  onChange({ emailAddress: email, contactName: first, subject: next.subject, email: next.email, issueId: next.issueId, emailEdited: next.edited, drafts, ...((l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified)) && verified ? { status: "new", contactUnverified: false } : {}) });
}

// Who decides on a website: owners, directors, founders, general/managing/practice/office managers,
// anyone in marketing, brand, digital, communications or business development.
const DECIDES_RE = /\b(owner|founder|co-?founder|proprietor|partner|principal|director|managing|chief|ceo|coo|cmo|md|chair|head of|general manager|practice manager|office manager|business manager|operations? manager|marketing|brand|digital|communications?|comms|business development|sales manager|sales director|commercial)\b/i;
const NOT_DECIDES_RE = /\b(finance director|financial|hr|human resources|food safety|health and safety|safety|compliance|chef|cashier|accounts?|accountant|bookkeeper|payroll|warehouse|driver|engineer|technician|nurse|receptionist|support|helpdesk|customer service|assistant|intern|apprentice|cleaner|security|it manager|it support|quality)\b/i;
const decides = (p) => { const r = `${p.role || ""} ${p.why || ""}`; if (/marketing|brand|digital|business development|owner|founder|managing director|ceo|chief executive/i.test(r)) return true; if (NOT_DECIDES_RE.test(r)) return false; return DECIDES_RE.test(r); };

function Contacts({ l, onChange, onContacts, onHunter, cfgHunter = false, subjects = {} }) {
  const all = l.contacts || [];
  const siteHost = String(l.website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const hunterAt = l.hunterDomain || siteHost;
  const [showOthers, setShowOthers] = useState(false);
  const deciders = all.filter(decides);
  const others = all.filter((p) => !decides(p));
  const people = showOthers ? [...deciders, ...others] : deciders;
  const channels = l.channels || [];
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Who to contact</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {cfgHunter && (l.hunterTried
            ? <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-500" title="Hunter has already been asked about this domain">Hunter used{hunterAt ? ` · ${hunterAt}` : " · by company name"}</span>
            : l.hunterOnFile === 0
            ? <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-500" title="Checked free: Hunter holds no named people here (at most shared inboxes like info@, which are on their site anyway), so a credit would buy nothing">Hunter has no named people</span>
            : !(l.hunterOnFile > 0) ? null
            : <button onClick={onHunter} disabled={l.checking} title={l.website ? "Ask Hunter.io for named people at this domain with their roles and addresses. Spends one credit." : "No website on file: Hunter looks the company up by name, which can also turn up the domain. Spends one credit."} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-40"><SearchIcon className="h-3.5 w-3.5" /> Use a Hunter credit · {l.hunterOnFile} named {l.hunterOnFile === 1 ? "person" : "people"} {siteHost ? `at ${siteHost}` : "under the company name (Hunter picks the domain)"}</button>)}
          <button onClick={onContacts} disabled={l.checking} title="Companies House and the website, free" className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"><SearchIcon className="h-3.5 w-3.5" /> {people.length ? "Look again" : "Find contacts"}</button>
        </span>
      </div>
      {!all.length && !channels.length && <p className="mt-2 text-xs text-zinc-500">Nothing found yet. Find contacts reads the directors and owners from Companies House and any named people on the website.</p>}
      {all.length > 0 && !deciders.length && !showOthers && <p className="mt-2 text-xs text-zinc-500">Nobody here looks like a website decision-maker.</p>}
      {people.length > 0 && (
        <ul className="mt-2 divide-y divide-zinc-100">
          {people.map((p, i) => (
            <li key={i} className={`flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm ${decides(p) ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{p.role}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{p.source}</span>
                </div>
                <div className="text-xs text-zinc-500">{p.why}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  {p.email && <span className="text-green-800">{p.email} <span className="text-zinc-500">· {p.emailStatus}</span></span>}
                  {p.linkedin && <a href={/^https?:/.test(p.linkedin) ? p.linkedin : `https://${p.linkedin}`} target="_blank" rel="noreferrer" className="text-blue-700 underline">LinkedIn profile</a>}
                  <a href={p.linkedinSearch} target="_blank" rel="noreferrer" className="text-blue-700 underline">Find on LinkedIn</a>
                  <a href={p.googleSearch} target="_blank" rel="noreferrer" className="text-blue-700 underline">Google</a>
                </div>
              </div>
              {p.email
                ? <button onClick={() => pickPerson(l, p, onChange, subjects)} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100" title="Put this person in To and the greeting">Email this person</button>
                : <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700" title="No verified email address found for this person">No email found</span>}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <button onClick={() => setShowOthers((v) => !v)} className="mt-1 text-xs text-zinc-500 underline">{showOthers ? "Hide" : "Show"} {others.length} other {others.length === 1 ? "person" : "people"} (not website decision-makers)</button>
      )}
      {channels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-100 pt-2 text-xs">
          {channels.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5">
              <span className="text-zinc-500">{c.label}:</span>
              {c.kind === "linkedin" ? <a href={c.value} target="_blank" rel="noreferrer" className="text-blue-700 underline">{c.value.replace(/^https?:\/\/(www\.)?/, "")}</a>
                : c.kind === "email" ? <button onClick={() => onChange({ emailAddress: c.value })} className="text-blue-700 underline" title="Use as To">{c.value}</button>
                : <span>{c.value}</span>}
            </span>
          ))}
        </div>
      )}
      {l.contactsAt && <div className="mt-1 text-[11px] text-zinc-400">Looked up {new Date(l.contactsAt).toLocaleDateString("en-GB")}</div>}
    </div>
  );
}

// Two-line nudge for a lead that has gone quiet after the first email.
function FollowUp({ l, onChange }) {
  const [copied, setCopied] = useState(false);
  const draft = draftFollowUp(l);
  const subject = l.followUpSubject || draft.subject;
  const body = l.followUpEmail || draft.body;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(l.emailAddress || "")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  async function copy() { try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-amber-900">{l.chasedAt ? `Chased on ${new Date(l.chasedAt).toLocaleDateString("en-GB")}` : `No reply for ${Math.floor(daysSince(l))} days: send the follow-up`}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy</>}</button>
          {!l.chasedAt && <button onClick={() => onChange({ chasedAt: new Date().toISOString(), notesLog: [...(l.notesLog || []), { at: new Date().toISOString(), text: "Follow-up email sent" }] })} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"><CheckIcon className="h-3.5 w-3.5" /> Mark as chased</button>}
        </span>
      </div>
      <input value={subject} onChange={(e) => onChange({ followUpSubject: e.target.value })} className="mt-2 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-sm" />
      <AutoTextarea value={body} onChange={(e) => onChange({ followUpEmail: e.target.value })} minRows={4} className="mt-1 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-sm" />
      {(l.followUpEmail || l.followUpSubject) && <button onClick={() => onChange({ followUpEmail: "", followUpSubject: "" })} className="mt-1 text-[11px] text-zinc-500 underline">Back to the suggested wording</button>}
    </div>
  );
}

function LeadDrawer({ onNoSite, onFindSite, onNext, onClaude, l, followUp = FOLLOW_UP_DEFAULTS, hunterOn = false, subjects = {}, onClose, onChange, onRemove, onRecheck, onContacts, onHunter, onLicence, onRefresh }) {
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [optingOut, setOptingOut] = useState(false);
  const reviewable = ["new", "no-contact"].includes(l.status) && !isFrozen(l);
  const [view, setView] = useState(() => (reviewable && !l.review?.done ? "review" : "details"));
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // Older drafts carry the greeting inside the text; new ones get it written on the day.
  const emailText = /^Hi\b/.test(l.email || "") ? (l.email || "") : fullEmail(l, l.email || "");
  const greetingPreview = /^Hi\b/.test(l.email || "") ? "" : `${firstNameOf(l.contactName) ? `Hi ${firstNameOf(l.contactName)},` : "Hi there,"}\n\n${dayGreeting()}`;
  const genericBox = GENERIC_BOX_RE.test(String(l.emailAddress || "").split("@")[0]);
  const full = `Subject: ${l.subject || ""}\n\n${emailText}`;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(l.emailAddress || "")}&subject=${encodeURIComponent(l.subject || "")}&body=${encodeURIComponent(emailText)}`;
  const cf = l.claudeFields || [];
  const issues = issuesFor(l);
  const current = issues.find((i) => i.id === l.issueId) || null;
  const person = (l.contacts || []).find((p) => p.email && p.email === l.emailAddress) || null;
  // No issue chosen yet (or the old one no longer applies): land on the one this person would care about.
  const shownIssue = current || (issues.length ? pickIssue(l, person || { role: "owner" }, []) : null);
  useEffect(() => {
    if (!shownIssue || current || l.emailEdited || isFrozen(l)) return;
    const d = draftFor(l, person, shownIssue, subjects);
    onChange({ subject: d.subject, email: d.body, issueId: d.issueId, emailEdited: false, emailPrevious: l.email && l.email !== d.body ? l.email : l.emailPrevious });
  }, [l.id, l.issueId, issues.length]); // eslint-disable-line react-hooks/exhaustive-deps
  function chooseIssue(id) {
    const issue = issues.find((i) => i.id === id) || null;
    if (l.emailEdited && !confirm("This email was edited by hand. Replace it with the draft for the chosen issue?")) return;
    const d = draftFor(l, person, issue, subjects);
    onChange({ subject: d.subject, email: d.body, issueId: d.issueId, emailEdited: false, emailPrevious: l.email && l.email !== d.body ? l.email : l.emailPrevious });
  }
  // The website field is committed on blur, Enter or paste, not on every keystroke (uncontrolled, re-keyed per lead).
  // A website you confirm (button) or paste/type counts as verified by you. The lead is rescanned straight away
  // so the problem, licence, search and contacts all come from the real site, and its status is decided again.
  function commitWebsite(value, force = false) {
    const host = String(value || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    if (!host || (!force && host === String(l.website || "").toLowerCase() && websiteIsVerified(l))) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return;
    const fromOld = (e) => e && l.website && e.endsWith("@" + String(l.website).replace(/^www\./, "")) && host !== String(l.website).toLowerCase();
    onChange({ website: host, websiteNeeded: false, claude: null, claudeFields: [], status: ["not-pursuing", "no-contact"].includes(l.status) && !l.optedOut ? "new" : l.status, websiteConfirmed: true, websiteVerified: "confirmed by you", websiteEvidence: "confirmed by you", websiteDoubt: "", siteUrl: "", ...(l.problem === "No website" ? { problem: "", problemDetail: "" } : {}), ...(fromOld(l.emailAddress) ? { emailAddress: "", contactName: "" } : {}), caveats: String(l.caveats || "").split("; ").filter((x) => x && !/no website|not found by name|confirm the website/i.test(x)).join("; ") });
    setTimeout(() => onRefresh(), 50);
  }
  // Wrong website: remember it as rejected, drop everything that came from it, rescan without it.
  function rejectWebsite() {
    const host = String(l.website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    const fromCH = (l.contacts || []).filter((p) => /Companies House/.test(p.source || "")).map((p) => ({ ...p, source: p.source.replace(/\s*\+\s*Hunter\.io/, ""), email: p.email && p.email.endsWith("@" + host) ? "" : p.email, emailStatus: p.email && p.email.endsWith("@" + host) ? "" : p.emailStatus }));
    const fromOld = (e) => !!e && e.endsWith("@" + host);
    onChange({ rejectedSites: [...new Set([...(l.rejectedSites || []), host])], website: "", websiteConfirmed: false, websiteVerified: "", websiteEvidence: "", websiteDoubt: "", siteUrl: "", problem: "No website", problemDetail: `${host} belongs to a different business; no site found`, licence: null, seo: null, contacts: fromCH, channels: [], emailAddress: fromOld(l.emailAddress) ? "" : l.emailAddress, contactName: fromOld(l.emailAddress) ? "" : l.contactName, hunterOnFile: null, hunterDomain: "", drafts: {}, emailEdited: false, caveats: [...String(l.caveats || "").split("; ").filter((x) => x && !/came from Hunter|different business/i.test(x)), `${host} was a different business`].join("; ") });
    setTimeout(() => onRefresh(), 50);
  }
  const withEmail = (l.contacts || []).filter((p) => p.email);
  const [showAllWriteTo, setShowAllWriteTo] = useState(false);
  const writeToOthers = withEmail.filter((p) => !decides(p) && p.email !== l.emailAddress);
  const writeTo = showAllWriteTo ? withEmail : withEmail.filter((p) => !writeToOthers.includes(p));
  async function copy() { try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  const site = l.siteUrl || (l.website ? (/^https?:/.test(l.website) ? l.website : `${l.problem === "Broken SSL" ? "http" : "https"}://${l.website}`) : "");
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-start gap-2 border-b border-zinc-200 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            <input value={l.business || ""} onChange={(e) => onChange({ business: e.target.value })} className="w-full rounded border border-transparent text-lg font-semibold hover:border-zinc-300 focus:border-zinc-400" />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {l.problem && <span className={`rounded-full px-2 py-0.5 font-semibold text-white ${PROBLEM_TONE[l.problem] || "bg-zinc-500"}`}>{l.problem}</span>}
              <span className="inline-flex items-center gap-1">
                <input key={`${l.id}:${l.website || ""}`} defaultValue={l.website || ""} onBlur={(e) => commitWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitWebsite(e.currentTarget.value); e.currentTarget.blur(); } }} onPaste={(e) => { const t = e.clipboardData?.getData("text"); if (t && /\./.test(t)) { e.preventDefault(); e.currentTarget.value = t.trim(); commitWebsite(t); } }} placeholder="website (paste or type to correct)" title="Paste or type their website. It counts as confirmed by you and the lead is rescanned straight away." style={{ width: `${Math.max(10, (l.website || "").length + 1)}ch` }} className="rounded border border-transparent px-1 text-xs text-blue-700 hover:border-zinc-300 focus:border-zinc-400" />
                {site && <a href={site} target="_blank" rel="noreferrer" aria-label="Open website" className="-ml-1 text-blue-700"><ExternalIcon /></a>}
              </span>
              {(l.tradingTown || l.area) && <span className={`inline-flex items-center gap-1 text-xs ${l.tradesElsewhere ? "text-red-700" : cf.includes("tradingTown") ? "text-orange-700" : "text-zinc-600"}`} title={l.tradingAddress ? `Address on their website: ${l.tradingAddress}${l.area && l.tradingTown && l.tradingTown !== l.area ? ` (registered office: ${l.area})` : ""}` : `Registered office: ${l.address || l.area}`}><PinIcon /> {l.tradingTown || l.area}{l.tradingTown && l.area && l.tradingTown.toLowerCase() !== l.area.toLowerCase() ? <span className="text-zinc-400"> · registered in {l.area}</span> : null}</span>}
              {l.companyNumber && <a href={`https://find-and-update.company-information.service.gov.uk/company/${l.companyNumber}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">Companies House {l.companyNumber} <ExternalIcon /></a>}
              {l.website && (siteDoubt(l) || (!websiteIsVerified(l) && isFrozen(l))) && <button onClick={rejectWebsite} title="This website belongs to a different business. It is dropped, remembered as wrong, and the lead is rescanned without it." className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800 hover:bg-red-100">Not their website</button>}
            </div>
            {siteDoubt(l) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                <span><span className="font-semibold">Check the website.</span> {l.websiteDoubt.replace(/\s*Check it, or mark it as not theirs\.?/, "")}{l.websiteVerified ? ` It does show ${l.websiteVerified}, so open it and decide.` : ""}</span>
                <span className="ml-auto flex gap-2">
                  {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs hover:bg-red-100">Open site <ExternalIcon /></a>}
                  <button onClick={() => commitWebsite(l.website, true)} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">Yes, it’s theirs</button>
                  <button onClick={rejectWebsite} className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-800 hover:bg-red-50">Not theirs</button>
                </span>
              </div>
            )}
            {l.website && !websiteIsVerified(l) && !siteDoubt(l) && !isFrozen(l) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span><span className="font-semibold">Is this their website?</span> {l.websiteVerified === undefined ? "Checking it against Companies House…" : `Matched on ${l.websiteEvidence || "the name"} only; nothing on the site ties it to company ${l.companyNumber || "number"} yet. Open it and check before anything goes out.`}</span>
                <span className="ml-auto flex gap-2">
                  {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100">Open site <ExternalIcon /></a>}
                  <button onClick={() => commitWebsite(l.website, true)} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">Yes, it’s theirs</button>
                  <button onClick={rejectWebsite} className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-800 hover:bg-red-50">Not theirs</button>
                </span>
              </div>
            )}
            {l.website && websiteIsVerified(l) && l.websiteVerified && !siteDoubt(l) && <div className="text-[11px] text-emerald-700">Website verified: {l.websiteVerified} <button onClick={rejectWebsite} title="This website belongs to a different business. It is dropped, remembered as wrong, and the lead is rescanned without it." className="ml-1 text-zinc-400 underline hover:text-red-700">not their website?</button></div>}
          </div>
          <select value={l.status || "new"} onChange={(e) => onChange({ status: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {LEAD_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><CloseIcon /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="space-y-4 px-5 py-4">
          {(reviewable || l.review) && (
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-xs">
              {[["review", l.review?.done ? "Review ✓" : "Review steps"], ["details", "All details"]].map(([k, label]) => <button key={k} onClick={() => setView(k)} className={`flex-1 rounded-md px-2 py-1 font-medium ${view === k ? "bg-white shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}>{label}</button>)}
            </div>
          )}
          {view === "review" && <ReviewSteps l={l} onNoSite={onNoSite} onChange={onChange} issues={issues} person={person} subjects={subjects} commitWebsite={commitWebsite} rejectWebsite={rejectWebsite} onNext={onNext ? (done) => onNext(l.status, done) : null} />}
          {view === "details" && <>
          {(l.whatTheyDo || l.siteDescription || l.background || l.sics?.length) && (
            <p className="text-sm text-zinc-700">
              <span className={`font-medium ${cf.includes("whatTheyDo") ? "text-orange-700" : ""}`} title={cf.includes("whatTheyDo") ? "From Claude's check" : l.sicStale ? `Companies House lists this company as: ${sicDescription(l.sics)}. The website says otherwise, so that is hidden.` : undefined}>{l.whatTheyDo || sicDescription(l.sics) || (l.sics?.length ? `SIC ${l.sics[0]}` : "")}</span>
              {l.background && <span className="text-zinc-500"> · {l.background}</span>}{l.area && <span className="text-zinc-500"> · {l.area}</span>}
              {l.siteDescription && <span className="block text-zinc-500">“{l.siteDescription}”</span>}
              {l.tradingAddress && <span className={`block ${l.tradesElsewhere ? "font-medium text-red-700" : "text-zinc-500"}`}>Trades from {l.tradingAddress}{l.tradesElsewhere ? " — outside our area; only the registered office is local" : ""}</span>}
            </p>
          )}
          {l.websiteNeeded && !l.website && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span><span className="font-semibold">Find their website.</span> Claude couldn’t find it. Search for them, then paste the address into the website box above: the lead is rescanned straight away.</span>
              <span className="ml-auto flex gap-2">
                <a href={`https://www.google.com/search?q=${encodeURIComponent(`${l.business.replace(/\s+(ltd|limited)\.?$/i, "")} ${l.tradingTown || l.area || ""}`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100">Search Google <ExternalIcon /></a>
                <button onClick={() => onNoSite()} className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white">They have no website</button>
              </span>
            </div>
          )}
          {l.claude && l.status !== "not-pursuing" && (() => {
            const c = l.claude, ok = c.worth_contacting;
            const row = (label, text) => text ? <div className="flex gap-1.5"><span className="w-14 shrink-0 text-zinc-500">{label}</span><span className="min-w-0">{text}</span></div> : null;
            return (
              <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? "border-green-200 bg-green-50 text-green-950" : "border-red-200 bg-red-50 text-red-950"}`}>
                <div className="mb-1 flex items-baseline gap-2 text-sm"><span className="font-semibold">{ok ? "Worth contacting" : "Not worth contacting"}<span className="ml-1.5 text-[11px] font-normal opacity-60">AI check</span></span><span className="text-[11px] opacity-60">checked {new Date(c.checkedAt).toLocaleDateString("en-GB")}</span>{c.sources?.length > 0 && <details className="relative ml-auto text-[11px] opacity-70"><summary className="cursor-pointer">sources</summary><div className="absolute right-0 z-10 mt-1 w-80 max-w-md rounded-md border border-zinc-200 bg-white p-2 shadow">{c.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block break-all text-blue-700 underline">{u}</a>)}</div></details>}</div>
                {!ok && <div>{oneLine(c.reason) || oneLine(c.issue_note) || "Claude did not think this one is worth contacting."}</div>}
                <div className={ok ? "space-y-0.5" : "hidden"}>
                  {row("Raise", oneLine(c.angle) || (c.issue_confirmed ? oneLine(l.problemDetail || l.problem) : oneLine(c.issue_note)) || oneLine(l.subject))}
                  {ok && row("Why", oneLine(c.reason))}
                  {row("Does", [oneLine(c.what_they_do), oneLine(c.location)].filter(Boolean).join(" · "))}
                  {row("Issue", `${c.issue_confirmed ? "Confirmed" : "Not confirmed"}${c.issue_note ? `: ${oneLine(c.issue_note)}` : ""}`)}
                  {c.contact?.name && row("Contact", <>{c.contact.name}{c.contact.role ? `, ${oneLine(c.contact.role)}` : ""}{c.contact.email ? ` · ${c.contact.email}` : " · no published email"}{c.contact.linkedin && <> · <a href={c.contact.linkedin} target="_blank" rel="noreferrer" className="text-blue-700 underline">LinkedIn</a></>}</>)}
                  {!c.website_is_theirs && row("Website", c.correct_website ? `Wasn’t theirs; switched to ${c.correct_website}` : "Wasn’t theirs; none found")}
                </div>
              </div>
            );
          })()}
          {l.status === "not-pursuing" ? (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"><span className="font-semibold">Not worth pursuing.</span> {parkExplain(l)} <span className="text-red-700">Change the status above if you still want to go for it.</span>
              {l.claude && (() => { const c = l.claude; return (
                <details className="mt-1 text-xs text-red-800"><summary className="cursor-pointer">What Claude found</summary>
                  <div className="mt-1 space-y-0.5">
                    {c.what_they_do && <div><span className="opacity-70">Does </span>{oneLine(c.what_they_do)}{c.location ? ` · ${oneLine(c.location)}` : ""}</div>}
                    <div><span className="opacity-70">Issue </span>{c.issue_confirmed ? "confirmed" : "not confirmed"}{c.issue_note ? `: ${oneLine(c.issue_note)}` : ""}</div>
                    {c.contact?.name && <div><span className="opacity-70">Contact </span>{c.contact.name}{c.contact.role ? `, ${oneLine(c.contact.role)}` : ""}{c.contact.email ? ` · ${c.contact.email}` : " · no published email"}</div>}
                    {c.sources?.length > 0 && <div className="opacity-70">{c.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 underline">{u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a>)}</div>}
                  </div>
                </details>); })()}
            </div>
          ) : l.likelihood && !l.claude && ["new", "no-contact"].includes(l.status || "new") && (
            <div className={`rounded-lg px-3 py-2 text-sm ${LIKELY[l.likelihood]}`}>
              <span className="font-semibold">{l.likelihood} likelihood</span>{l.likelihoodWhy ? <span>: {l.likelihoodWhy}</span> : null}
            </div>
          )}
          {l.contactUnverified && l.status !== "not-pursuing" && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><span className="font-semibold">Contact not verified.</span> No email address was found on their site or at Companies House. Add a verified address below, or pick a person with one, and it moves back to To assess.</div>}
          <div className="grid grid-cols-3 gap-3">
            <Field label={`Company worth${l.accountsDate ? ` · year to ${accountsYear(l.accountsDate)}` : ""}`} title="Net assets in the latest accounts: what the company owns minus what it owes">{money(l.netAssets)}{accountsNote(l)}</Field>
            <Field label="Profit kept last year" title="Change in retained earnings: the profit the company kept after paying any dividends">{signed(l.reChange)}</Field>
            <Field label="Area"><input value={l.area || ""} onChange={(e) => onChange({ area: e.target.value })} className="w-full rounded border border-transparent hover:border-zinc-300" /></Field>
          </div>
          <details className="rounded-lg border border-zinc-200 px-3 py-2" open={cf.length > 0 || undefined}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-700">Notes and background</summary>
            <div className="mt-2 space-y-3">
          <TextField label="Problem detail" ai={cf.includes("problemDetail")} value={l.problemDetail} onChange={(v) => onChange({ problemDetail: v })} rows={1} />
          <TextField label="Likelihood rationale" ai={cf.includes("likelihoodWhy")} value={l.likelihoodWhy} onChange={(v) => onChange({ likelihoodWhy: v })} rows={2} />
          <TextField label="Background" ai={cf.includes("background")} value={l.background} onChange={(v) => onChange({ background: v })} rows={2} />
          <TextField label="Caveats" value={l.caveats} onChange={(v) => onChange({ caveats: v })} rows={1} />
            </div>
          </details>

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Search visibility</span>
              <span className="text-[11px] text-zinc-500">Run the search on Google and say where they come. The search issue and its email follow from your answer.</span>
            </div>
            {(() => {
              const stored = l.seo?.searches?.find((x) => x.kind === "trade");
              const town = l.tradingTown || l.area || "";
              const autoTrade = l.tradeOverride || l.trade || (stored && town && stored.query.toLowerCase().endsWith(" " + town.toLowerCase()) ? stored.query.slice(0, -town.length - 1) : stored?.query || "");
              const query = [autoTrade, town].filter(Boolean).join(" ");
              const rank = !stored || stored.manual === undefined && stored.position === undefined ? "" : stored.position === 1 ? "top" : stored.position === 2 ? "top3" : stored.position === 5 ? "page1" : stored.position === null ? "none" : stored.position <= 3 ? "top3" : stored.position <= 10 ? "page1" : "none";
              const setRank = (v) => {
                if (!v) { onChange({ seo: null }); return; }
                const position = { top: 1, top3: 2, page1: 5, none: null }[v];
                const poor = position === null || position > 3;
                const f = { seo: { manual: true, engine: "Checked by you on Google", checkedAt: new Date().toISOString(), searches: [{ kind: "trade", query, position, manual: true }] } };
                if (poor && !l.problem) { f.problem = "Low search visibility"; f.problemDetail = `${position ? `#${position}` : "Not on page 1"} for “${query}”`; }
                else if (!poor && l.problem === "Low search visibility") { f.problem = ""; f.problemDetail = ""; }
                onChange(f);
              };
              return (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <label className="inline-flex items-center gap-1 text-xs text-zinc-600">searching for
                    <input key={`${l.id}:${l.tradeOverride || ""}:${autoTrade}`} defaultValue={autoTrade} onBlur={(e) => { const v = e.target.value.trim(); if (v !== autoTrade) onChange({ tradeOverride: v, seo: null }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} placeholder="e.g. trophy shop" className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs" style={{ width: `${Math.max(12, (autoTrade || "").length + 2)}ch` }} />
                    {town ? <span>in {town}</span> : null}
                  </label>
                  {query && <a href={`https://www.google.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100">Search on Google <ExternalIcon /></a>}
                  <select value={rank} onChange={(e) => setRank(e.target.value)} className={`rounded-md border px-2 py-1 text-xs ${rank === "top" ? "border-green-300 bg-green-50 text-green-800" : rank === "none" || rank === "page1" ? "border-red-300 bg-red-50 text-red-800" : rank ? "border-amber-300 bg-amber-50 text-amber-800" : "border-zinc-300 bg-white"}`}>
                    <option value="">Where do they rank?</option>
                    <option value="top">Top result</option>
                    <option value="top3">In the top 3</option>
                    <option value="page1">On page 1, below the top 3</option>
                    <option value="none">Not on page 1</option>
                  </select>
                  {stored && <span className="text-[11px] text-zinc-400">{l.seo.engine} · {new Date(l.seo.checkedAt).toLocaleDateString("en-GB")}</span>}
                </div>
              );
            })()}
          </div>

          {l.website && (
            <div className="rounded-lg border border-zinc-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Licence risks</span>
                <button onClick={onLicence} disabled={l.checking} className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"><SearchIcon className="h-3.5 w-3.5" /> {l.licence ? "Check again" : "Check licences"}</button>
              </div>
              {l.licence && (
                <div className="mt-2 text-sm">
                  {!l.licence.images.length && !l.licence.fonts.length && !l.licence.possibleImages?.length && !l.licence.possibleFonts?.length && <p className="text-xs text-zinc-500">{l.licence.error ? l.licence.error : `Nothing found on ${l.licence.pagesChecked} page${l.licence.pagesChecked === 1 ? "" : "s"}.`}</p>}
                  {l.licence.images.length > 0 && <ul className="space-y-0.5">{l.licence.images.map((i, n) => <li key={n} className="text-xs"><span className="rounded bg-purple-100 px-1.5 py-0.5 font-semibold text-purple-800">{i.library} preview</span> <a href={i.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{i.url.split("/").pop()}</a>{i.page && <span className="text-zinc-500"> on {i.page.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>}</li>)}</ul>}
                  {l.licence.fonts.length > 0 && <ul className="mt-1 space-y-0.5">{l.licence.fonts.map((f, n) => <li key={n} className="text-xs"><span className="rounded bg-purple-100 px-1.5 py-0.5 font-semibold text-purple-800">{f.label}</span> {f.family} <span className="text-zinc-500">· {f.detail}</span></li>)}</ul>}
                  {(l.licence.possibleImages?.length > 0 || l.licence.possibleFonts?.length > 0) && (
                    <div className="mt-2 border-t border-zinc-100 pt-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Worth a look (not certain; raised carefully in the email)</div>
                      <ul className="mt-1 space-y-0.5">
                        {(l.licence.possibleImages || []).map((i, n) => <li key={`i${n}`} className="text-xs"><span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">{i.library}</span> <a href={i.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{i.url.split("/").pop()}</a> <span className="text-zinc-500">· {i.detail}</span></li>)}
                        {(l.licence.possibleFonts || []).map((f, n) => <li key={`f${n}`} className="text-xs"><span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">{f.label}</span> {f.family}{f.detail && <span className="text-zinc-500"> · {f.detail}</span>}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {l.trigger && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
              <span className="font-semibold">{TRIGGER_TAG[l.triggerKind] || l.source}:</span> {l.trigger}
              {l.google?.mapsUrl && <> · <a href={l.google.mapsUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">Google Maps</a></>}
              {l.google?.phone && <> · {l.google.phone}</>}
              {(l.jobs || []).length > 0 && <div className="mt-1 space-y-0.5">{l.jobs.map((j, n) => <div key={n}><a href={j.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{j.title}</a>{j.posted ? ` · ${new Date(j.posted).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</div>)}</div>}
            </div>
          )}
          {l.optedOut && <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"><span className="font-semibold">Do not contact.</span> They asked not to hear from us{l.optedOutAt ? ` on ${new Date(l.optedOutAt).toLocaleDateString("en-GB")}` : ""}. The record is kept so nobody emails them again by accident.</div>}
          {!l.optedOut && l.status === "contacted" && daysSince(l) >= followUp.chaseDays && <FollowUp l={l} onChange={onChange} />}
          {l.autoMoved && <p className="text-xs text-zinc-500">Moved automatically: {l.autoMoved}.</p>}

          <Contacts l={l} onChange={onChange} onContacts={onContacts} onHunter={onHunter} cfgHunter={hunterOn} subjects={subjects} />

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Outreach email</span>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {l.optedOut ? <span className="text-xs text-red-700">Opted out: not to be emailed</span> : !websiteIsVerified(l) && !isFrozen(l) ? <span className="text-xs text-amber-800">Confirm the website above before sending</span> : <>
                  <a href={outlook} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100"><MailIcon className="h-3.5 w-3.5" /> Open in Outlook</a>
                  <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy email</>}</button>
                </>}
              </span>
            </div>
            {writeTo.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Write to</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {writeTo.map((p) => (
                    <button key={p.email} onClick={() => pickPerson(l, p, onChange, subjects)} title={`${p.role} · ${p.email}${l.drafts?.[p.email] ? " · draft saved" : ""}`}
                      className={`rounded-full border px-2.5 py-1 text-xs ${p.email === l.emailAddress ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>
                      {p.name} <span className={p.email === l.emailAddress ? "text-zinc-300" : "text-zinc-400"}>· {p.role}</span>{l.drafts?.[p.email] && p.email !== l.emailAddress ? " ✎" : ""}
                    </button>
                  ))}
                </div>
                {writeToOthers.length > 0 && <button onClick={() => setShowAllWriteTo((v) => !v)} className="mt-1 text-xs text-zinc-500 underline">{showAllWriteTo ? "Hide" : "Show"} {writeToOthers.length} other {writeToOthers.length === 1 ? "person" : "people"} (not website decision-makers)</button>}
              </div>
            )}
            <div className="mt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Issue raised</div>
              {issues.length ? (
                <select value={shownIssue?.id || ""} onChange={(e) => chooseIssue(e.target.value)} className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
                  {issues.map((i) => <option key={i.id} value={i.id}>{i.label}{person && i.audience.includes(roleGroup(person)) ? "" : person ? " (less relevant to this role)" : ""}</option>)}
                </select>
              ) : String(l.email || "").trim() ? <p className="mt-0.5 text-sm text-zinc-800">{raisedIn(l) || "Your own point (written by hand)"}</p>
              : <p className="mt-0.5 text-xs text-zinc-500">No issue found on the site yet. The licence and search checks run on their own; Rescan this lead to look again now.</p>}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">To</div>
                <input value={l.emailAddress || ""} onChange={(e) => onChange({ emailAddress: e.target.value, ...((l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified)) && e.target.value.trim() ? { status: "new", contactUnverified: false } : {}) })} placeholder={l.emailNote || "email address"} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
              {!genericBox && <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Contact first name</div>
                <input value={l.contactName || ""} onChange={(e) => onChange({ contactName: e.target.value })} placeholder="Used for “Hi Steve,”" className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>}
            </div>
            <label className="mt-2 block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Subject</div>
              <input value={l.subject || ""} onChange={(e) => onChange({ subject: e.target.value, emailEdited: true })} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
            {greetingPreview && <pre className="mt-2 whitespace-pre-wrap rounded-t-md border border-b-0 border-zinc-200 bg-zinc-50 px-2 py-1.5 font-sans text-sm text-zinc-600" title="Written automatically on the day you send: changes with the day of the week">{greetingPreview}</pre>}
            <AutoTextarea value={l.email || ""} onChange={(e) => onChange({ email: e.target.value, emailEdited: true })} minRows={4} className={`w-full border border-zinc-300 px-2 py-1 text-sm ${greetingPreview ? "rounded-b-md" : "mt-2 rounded-md"}`} />
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
              {l.emailEdited ? <span>Edited by hand, so automatic redrafts leave it alone. <button onClick={() => onChange({ emailEdited: false, draftVersion: 0 })} className="underline">Let the app redraft it</button></span> : <span>Drafted by the app; redrafts automatically when the wording improves.</span>}
              {l.emailPrevious && <button onClick={() => onChange({ email: l.emailPrevious, emailPrevious: "", emailEdited: true })} className="underline">Restore the previous draft</button>}
            </div>
          </div>

          </>}
        </div></div>
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-5 py-3 text-xs shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)]">
          {(() => {
            // One obvious next step for where the lead is; everything else lives under More.
            const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white";
            if (l.optedOut || isFrozen(l)) return null;
            if (l.status === "ready" && l.email && l.emailAddress && websiteIsVerified(l)) return <a href={outlook} target="_blank" rel="noopener" onClick={() => onChange({ status: "contacted", sentAt: new Date().toISOString() })} className={`${btn} bg-emerald-600 hover:bg-emerald-700`}><MailIcon className="h-4 w-4" /> Open in Outlook and mark as sent</a>;
            if (!["new", "no-contact"].includes(l.status || "new")) return null;
            if (!l.website && siteSearchable(l)) return <button onClick={onFindSite} className={`${btn} bg-amber-600 hover:bg-amber-700`}><SearchIcon className="h-4 w-4" /> Find their website with Claude</button>;
            if (!l.claude) return <button onClick={onClaude} className={`${btn} bg-orange-600 hover:bg-orange-700`}><SearchIcon className="h-4 w-4" /> Check with Claude</button>;
            if (!l.review?.done) return <button onClick={() => setView("review")} className={`${btn} bg-zinc-900 hover:bg-zinc-700`}><PlayIcon className="h-4 w-4" /> {l.review?.step > 1 ? `Continue review (step ${l.review.step} of 3)` : "Review this lead"}</button>;
            return null;
          })()}
          {l.checking && <span className="inline-flex items-center gap-1 text-blue-700"><SpinnerIcon className="h-3.5 w-3.5" /> Working…</span>}
          {l.error && <span className="text-red-700">{l.error}</span>}
          <details className="relative ml-auto">
            <summary className="cursor-pointer list-none rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100">More ▾</summary>
            <div className="absolute bottom-full right-0 z-10 mb-1 flex w-56 flex-col items-stretch gap-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
              {["new", "no-contact", "not-pursuing"].includes(l.status) && !isFrozen(l) && <button onClick={onClaude} className="rounded px-2 py-1 text-left hover:bg-zinc-100">Check with Claude</button>}
              {!l.website && siteSearchable(l) && <button onClick={onFindSite} className="rounded px-2 py-1 text-left hover:bg-zinc-100">Find website with Claude</button>}
              <button onClick={() => onRefresh()} disabled={l.checking} className="rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-40">Rescan this lead</button>
              {l.website && <button onClick={() => onRecheck(false)} disabled={l.checking} className="rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-40">Re-check website only</button>}
              {l.problem && <button onClick={() => onRecheck(true)} disabled={l.checking} className="rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-40">Redraft email</button>}
              <div className="my-1 border-t border-zinc-100" />
              {!l.optedOut
            ? optingOut
              ? <span className="inline-flex items-center gap-1"><button onClick={() => { setOptingOut(false); onChange({ optedOut: true, optedOutAt: new Date().toISOString(), status: "lost", notesLog: [...(l.notesLog || []), { at: new Date().toISOString(), text: "Asked not to be contacted" }] }); }} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white">Move to Lost</button><button onClick={() => setOptingOut(false)} className="rounded-md border border-zinc-300 px-2 py-1">Keep</button></span>
              : <button onClick={() => setOptingOut(true)} className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50" title="They asked not to hear from us: the lead moves to Lost and is never chased or emailed from here again">Do not contact</button>
            : <button onClick={() => onChange({ optedOut: false })} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-zinc-600 hover:bg-zinc-100">Undo opt-out</button>}
              {asking
                ? <span className="flex gap-1"><button onClick={onRemove} className="flex-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white">Delete</button><button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1">Keep</button></span>
                : <button onClick={() => setAsking(true)} className="rounded px-2 py-1 text-left text-zinc-500 hover:bg-red-50 hover:text-red-700">Delete lead</button>}
              {l.checkedAt && <span className="px-2 pt-1 text-[11px] text-zinc-400">Last checked {new Date(l.checkedAt).toLocaleDateString("en-GB")}</span>}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// Check with Claude: free on the user's own Claude plan. The app writes the prompt, Claude researches, the reply is pasted back.
const CHECK_COLUMNS = [["new", "To assess"], ["no-contact", "Contact not verified"], ["not-pursuing", "Not pursuing"]];
function LeadCheckModal({ leads, preset, column = "new", onClose, onApply }) {
  const [col, setCol] = useState(column);
  const poolFor = (cl) => sorted(leads.filter((l) => (l.status || "new") === cl && !claudeSkip(l) && (cl === "new" || recheckable(l))));
  const pool = poolFor(col);
  const [size, setSize] = useState(5);
  const [picked, setPicked] = useState(() => (preset.length ? preset : poolFor(column).filter((l) => !l.claude).slice(0, 5).map((l) => l.id)));
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const items = picked.map((id) => leads.find((l) => l.id === id)).filter(Boolean).map((l) => ({
    id: l.id, business: l.business, companyNumber: l.companyNumber, address: l.address || l.area, sic: sicDescription(l.sics || []), website: l.website || "",
    issue: [l.problem, l.problemDetail].filter(Boolean).join(": "),
    contacts: (l.contacts || []).slice(0, 5).map((p) => `${p.name} (${p.role}${p.email ? `, ${p.email}` : ""})`).join("; "),
    parked: l.status === "not-pursuing" ? parkExplain(l) : l.status === "no-contact" ? "No verified email address found yet" : "",
  }));
  const prompt = items.length ? leadCheckPrompt(items) : "";
  async function copy(open) { try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} if (open) window.open("https://claude.ai/new", "_blank", "noopener"); markSent("lead-check", picked); setSent(sentIds("lead-check")); if (size !== "all") nextBatch(size, picked); }
  const [sent, setSent] = useState(() => sentIds("lead-check"));
  const nextBatch = (n, alsoDone = [], cl = col) => { setSize(n); const waiting = sentIds("lead-check"); const all = poolFor(cl).filter((l) => !alsoDone.includes(l.id) && (n === "all" || !waiting.has(l.id))); setPicked((n === "all" ? [...all.filter((l) => !l.claude), ...all.filter((l) => l.claude)] : all.filter((l) => !l.claude).slice(0, n)).map((l) => l.id)); };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3">
          <h3 className="text-lg font-semibold">Check with Claude</h3>
          <span className="text-xs text-zinc-500">Free on your Claude plan</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <div className="mb-2 inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-xs">{CHECK_COLUMNS.map(([id, label]) => <button key={id} onClick={() => { setCol(id); nextBatch(size, [], id); }} className={`rounded px-2.5 py-1 ${col === id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{label} ({poolFor(id).filter((l) => !l.claude).length})</button>)}</div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">1. Pick leads</span><span className="text-xs text-zinc-500">Next unchecked:</span>
              {[1, 3, 5, 8].map((n) => <button key={n} onClick={() => nextBatch(n)} className={`rounded-full border px-2 py-0.5 text-xs ${size === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{n}</button>)}
              <button onClick={() => nextBatch("all")} title="Everything in this column, unchecked first; already-checked leads are checked again" className={`rounded-full border px-2 py-0.5 text-xs ${size === "all" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>All ({pool.length})</button>
            </div>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {pool.map((l) => <button key={l.id} onClick={() => toggle(l.id)} className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(l.id) ? "border-orange-500 bg-orange-100 text-orange-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{l.business}{l.claude ? " ✓" : ""}</button>)}
              {preset.filter((id) => !pool.some((l) => l.id === id)).map((id) => { const l = leads.find((x) => x.id === id); return l && <button key={id} onClick={() => toggle(id)} className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(id) ? "border-orange-500 bg-orange-100 text-orange-900" : "border-zinc-300"}`}>{l.business}</button>; })}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">{picked.length} picked · {pool.filter((l) => !l.claude).length} still to check · ✓ already checked{col !== "new" ? " · leads parked for size, dormancy or being a client are left out" : ""}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Claude’s verdict moves each lead: skip → Not pursuing; worth it with a published email → To assess; worth it but no email → Contact not verified.</p>
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
      </div>
    </div>
  );
}

// Free lead finding on your own Claude plan: copy a prompt, paste the JSON back, each find gets the usual checks.
function FindLeadsModal({ area, miles, exclude, onClose }) {
  const [what, setWhat] = useState("");
  const [count, setCount] = useState(10);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const prompt = findLeadsPrompt({ what: what.trim(), area: `${area} (within about ${miles} miles)`, count, exclude });
  async function copy(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3">
          <h2 className="text-lg font-semibold">Find leads with Claude</h2><span className="text-xs text-zinc-500">Free on your Claude plan</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <div className="font-semibold">1. What to look for</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Any business, or e.g. restaurants, builders" className="min-w-[14rem] flex-1 rounded-md border border-zinc-300 px-2 py-1" />
              <span className="text-xs text-zinc-500">How many:</span>
              {[5, 10, 20].map((n) => <button key={n} onClick={() => setCount(n)} className={`rounded-full border px-2 py-0.5 text-xs ${count === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{n}</button>)}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">Around {area}. Businesses already on the board are left out.</p>
          </div>
          <div>
            <div className="flex items-center gap-2"><span className="font-semibold">2. Run it in Claude</span>
              <button onClick={() => copy(false)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100">{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />} Copy prompt</button>
              <button onClick={() => copy(true)} className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white"><ExternalIcon className="h-3.5 w-3.5" /> Copy and open Claude</button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">Paste it into a new chat with web search on.</p>
          </div>
          <div>
            <div className="font-semibold">3. Paste the reply</div>
            <PasteHint className="mt-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Step by step: 1 look at the site yourself, 2 pick what to raise and how, 3 Claude drafts it from our templates.
function ReviewSteps({ l, onNoSite, onChange, issues, person, subjects, commitWebsite, rejectWebsite, onNext }) {
  const r = l.review || {};
  const step = r.step || 1;
  const setR = (patch, extra = {}) => onChange({ review: { ...r, ...patch }, ...extra });
  const [own, setOwn] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const site = l.siteUrl || (l.website ? `${l.problem === "Broken SSL" ? "http" : "https"}://${l.website}` : "");
  const google = `https://www.google.com/search?q=${encodeURIComponent(`${String(l.business || "").replace(/\s+(ltd|limited)\.?$/i, "")} ${l.tradingTown || l.area || ""}`)}`;
  const cands = [
    ...issues.map((i) => ({ key: `chk:${i.id}`, label: i.label, from: "Checker", issue: i })),
    ...(l.claude && (l.claude.angle || l.claude.issue_note) ? [{ key: "claude", label: oneLine(l.claude.angle || l.claude.issue_note), from: "Claude" }] : []),
    ...(l.trigger ? [{ key: "why-now", label: l.trigger, from: "Why now" }] : []),
    ...(r.seen || []).map((x) => ({ key: `you:${x}`, label: x, from: "You" })),
    ...(r.own || []).map((x) => ({ key: `own:${x}`, label: x, from: "You" })),
  ];
  const lead = cands.find((c) => c.key === r.lead) || null;
  const path = r.path || suggestPath(lead?.issue?.id || lead?.label || "", l);
  const first = firstNameOf(l.contactName);
  const prompt = lead ? draftPrompt({ l, first, leadWith: lead.from === "Checker" && l.problemDetail && !/^chk:(fonts|image)/.test(lead.key) ? `${lead.label} (${l.problemDetail})` : lead.label, also: cands.filter((c) => (r.also || []).includes(c.key) && c.key !== r.lead).map((c) => c.label), notes: r.notes || "", path, template: lead.issue?.body || "" }) : "";
  const FROM = { Checker: "bg-zinc-200 text-zinc-700", Claude: "bg-orange-100 text-orange-800", "Why now": "bg-violet-100 text-violet-800", You: "bg-blue-100 text-blue-800" };
  const head = (n, title, done) => (
    <button onClick={() => setR({ step: n })} className={`flex w-full items-center gap-2 text-left text-sm font-semibold ${step === n ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done ? "bg-emerald-600 text-white" : step === n ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-600"}`}>{done ? "✓" : n}</span>{title}
    </button>
  );
  async function copy(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  const greeting = `${first ? `Hi ${first},` : "Hi there,"}\n\n${dayGreeting()}`;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200 p-3">
        {head(1, "Look at their website", !!r.siteChecked)}
        {step === 1 && (
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white"><ExternalIcon className="h-4 w-4" /> Open {l.website}</a>}
              <a href={google} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100"><SearchIcon className="h-4 w-4" /> Google them</a>
              {l.google?.mapsUrl && <a href={l.google.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100"><PinIcon className="h-4 w-4" /> Google Maps</a>}
            </div>
            {l.website ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-700">Is this their website?</span>
                <button onClick={() => setR({ siteChecked: true }, { websiteConfirmed: true, websiteVerified: websiteIsVerified(l) && l.websiteVerified ? l.websiteVerified : "confirmed by you", websiteDoubt: "" })} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${r.siteChecked ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"}`}>{r.siteChecked ? "✓ Yes, it’s theirs" : "Yes, it’s theirs"}</button>
                <button onClick={rejectWebsite} className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs text-red-800 hover:bg-red-100">Not theirs</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input key={`rw:${l.id}`} placeholder="Found it? Paste their website" onBlur={(e) => e.target.value.trim() && commitWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className="min-w-[14rem] flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm" />
                <button onClick={async () => { if (await onNoSite({ review: { ...r, siteChecked: true } })) return; }} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${r.siteChecked ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{r.siteChecked ? "✓ They have no website" : "They have no website"}</button>
              </div>
            )}
            {l.website && (
              <div>
                <div className="text-xs text-zinc-500">What did you notice? (tap all that apply)</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SEEN_ON_SITE.map((x) => { const on = (r.seen || []).includes(x); return <button key={x} onClick={() => setR({ seen: on ? r.seen.filter((y) => y !== x) : [...(r.seen || []), x] })} className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-blue-500 bg-blue-100 text-blue-900" : "border-zinc-300 hover:bg-zinc-100"}`}>{x}</button>; })}
                </div>
              </div>
            )}
            <textarea key={`rn:${l.id}`} defaultValue={r.notes || ""} onBlur={(e) => e.target.value !== (r.notes || "") && setR({ notes: e.target.value })} rows={2} placeholder="Anything else worth saying? (optional, Claude uses it in the email)" className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" />
            <div className="flex justify-end"><button onClick={() => setR({ step: 2 })} disabled={!r.siteChecked} title={r.siteChecked ? "" : "Answer the website question first"} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Next: pick the issue →</button></div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 p-3">
        {head(2, "Pick what to raise and how", !!r.lead && step > 2)}
        {step === 2 && (
          <div className="mt-3 space-y-3 text-sm">
            {!cands.length && <p className="text-xs text-zinc-500">Nothing found yet. Add what you noticed in step 1, or type your own below.</p>}
            <div className="space-y-1">
              {cands.map((c) => (
                <div key={c.key} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${r.lead === c.key ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}>
                  <button onClick={() => setR({ lead: c.key, path: r.pathSet ? r.path : suggestPath(c.issue?.id || c.label, l) })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${r.lead === c.key ? "border-zinc-900 bg-zinc-900" : "border-zinc-400"}`}>{r.lead === c.key && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
                    <span className="min-w-0 flex-1">{c.label}</span>
                  </button>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${FROM[c.from]}`}>{c.from}</span>
                  {r.lead !== c.key && <label className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500" title="Mention this briefly as well"><input type="checkbox" checked={(r.also || []).includes(c.key)} onChange={(e) => setR({ also: e.target.checked ? [...(r.also || []), c.key] : (r.also || []).filter((x) => x !== c.key) })} className="h-3 w-3" /> also</label>}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && own.trim()) { setR({ own: [...(r.own || []), own.trim()], lead: r.lead || `own:${own.trim()}` }); setOwn(""); } }} placeholder="Add your own issue and press Enter" className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <div className="text-xs text-zinc-500">Approach</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {REVIEW_PATHS.map((p) => (
                  <button key={p.id} onClick={() => setR({ path: p.id, pathSet: true })} className={`rounded-md border px-2 py-1.5 text-left ${path === p.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"}`}>
                    <div className="text-xs font-semibold">{p.label}{!r.pathSet && path === p.id && lead && <span className="ml-1 font-normal text-zinc-400">suggested</span>}</div>
                    <div className="text-[11px] text-zinc-500">{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between"><button onClick={() => setR({ step: 1 })} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button><button onClick={() => setR({ step: 3, path })} disabled={!lead} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Next: draft the email →</button></div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 p-3">
        {head(3, "Draft the email", !!r.done)}
        {step === 3 && lead && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-xs text-zinc-500">Leading with <b className="text-zinc-800">{lead.label}</b> · {(REVIEW_PATHS.find((p) => p.id === path) || {}).label}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => copy(true)} className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"><ExternalIcon className="h-3.5 w-3.5" /> Copy prompt and open Claude</button>
              <button onClick={() => copy(false)} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100">{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />} Copy prompt</button>
              {lead.issue && <button onClick={() => { const d = draftFor(l, person, lead.issue, subjects); onChange({ subject: d.subject, email: d.body, issueId: d.issueId, emailEdited: false }); setMsg("Our template is in. Or ask Claude for a version that uses your notes."); }} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100">Use our template instead</button>}
            </div>
            <PasteHint />
            {msg && <p className="text-xs text-zinc-600">{msg}</p>}
            <div>
              <input value={l.subject || ""} onChange={(e) => onChange({ subject: e.target.value, emailEdited: true })} placeholder="Subject" className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium" />
              <pre className="mt-2 whitespace-pre-wrap rounded-t-md border border-b-0 border-zinc-200 bg-zinc-50 px-2 py-1 font-sans text-sm text-zinc-500">{greeting}</pre>
              <AutoTextarea value={l.email || ""} onChange={(e) => onChange({ email: e.target.value, emailEdited: true })} minRows={5} className="w-full rounded-b-md border border-zinc-200 px-2 py-1 text-sm" />
            </div>
            {!l.emailAddress && <p className="text-xs text-red-700">No email address yet. Add one under All details before marking it ready.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setR({ step: 2 })} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
              <span className="ml-auto" />
              <button onClick={() => { setR({ done: true, doneAt: new Date().toISOString() }, { status: "not-pursuing", likelihoodWhy: "Reviewed by hand: not worth it" }); onNext?.(true); }} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-100">Not worth it</button>
              {onNext && <button onClick={() => onNext(false)} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-100">Skip for now →</button>}
              <button onClick={() => { setR({ done: true, doneAt: new Date().toISOString() }, { status: "ready" }); onNext?.(true); }} disabled={!l.emailAddress || !l.email} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Ready to send ✓{onNext ? " · next" : ""}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Find websites with Claude: free on your own plan. Picks leads with no website, Claude finds the real one or confirms there isn't one.
function FindSitesModal({ leads, preset, onClose, onApply }) {
  const pool = sorted(leads.filter((l) => !l.website && siteSearchable(l))).sort((a, b) => (a.sitesCheckedAt ? 1 : 0) - (b.sitesCheckedAt ? 1 : 0));
  const [size, setSize] = useState(5);
  const [picked, setPicked] = useState(() => (preset.length ? preset : pool.filter((l) => !l.sitesCheckedAt).slice(0, 5).map((l) => l.id)));
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const items = picked.map((id) => leads.find((l) => l.id === id)).filter(Boolean).map((l) => ({
    id: l.id, business: l.business, companyNumber: l.companyNumber, address: l.address || l.area, town: l.tradingTown || "", what: l.whatTheyDo || sicDescription(l.sics || []),
    people: (l.contacts || []).filter((p) => /Companies House/.test(p.source || "")).slice(0, 4).map((p) => `${p.name} (${p.role})`).join("; "),
    rejected: (l.rejectedSites || []).join(", "),
  }));
  const prompt = items.length ? findSitesPrompt(items) : "";
  // Copying sends the batch to Claude and moves straight on to the next one, so several can run at once.
  async function copy(open) { try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} if (open) window.open("https://claude.ai/new", "_blank", "noopener"); markSent("find-sites", picked); nextBatch(size, picked); }
  const nextBatch = (n, done = []) => { setSize(n); const waiting = sentIds("find-sites"); setPicked(pool.filter((l) => !l.sitesCheckedAt && !done.includes(l.id) && !waiting.has(l.id)).slice(0, n).map((l) => l.id)); };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3">
          <h3 className="text-lg font-semibold">Find websites with Claude</h3><span className="text-xs text-zinc-500">Free on your Claude plan</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">1. Pick leads</span><span className="text-xs text-zinc-500">Next unsearched:</span>
              {[1, 3, 5, 8].map((n) => <button key={n} onClick={() => nextBatch(n)} className={`rounded-full border px-2 py-0.5 text-xs ${size === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>{n}</button>)}
            </div>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {pool.map((l) => <button key={l.id} onClick={() => toggle(l.id)} className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(l.id) ? "border-amber-500 bg-amber-100 text-amber-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{l.business}{l.sitesCheckedAt ? " ✓" : ""}</button>)}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">{picked.length} picked · {pool.filter((l) => !l.sitesCheckedAt).length} still to search · ✓ searched before. Newest first.</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">2. Run it in Claude</span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => copy(false)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-40">{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />} Copy prompt</button>
                <button onClick={() => copy(true)} disabled={!prompt} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"><ExternalIcon /> Copy and open Claude</button>
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Paste it into a new chat with web search on.</p>
          </div>
          <div>
            <span className="font-semibold">3. Paste the reply</span>
            <PasteHint className="mt-1" />
          </div>
        </div>
      </div>
    </div>
  );
}
