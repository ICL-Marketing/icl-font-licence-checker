"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { PlayIcon, StopIcon, RefreshIcon, DownloadIcon, TrashIcon, ExternalIcon, PinIcon, CopyIcon, CheckIcon, SpinnerIcon, MailIcon, SearchIcon, CloseIcon } from "@/app/icons";
import { LEAD_STATUSES, PROBLEMS, DRAFT_VERSION, CONTACTS_VERSION, draftFollowUp, parkStatus, issuesFor, pickIssue, draftFor, fullEmail, dayGreeting, roleGroup, sicDescription, contactExhausted, firstNameOf, GENERIC_BOX_RE, websiteIsVerified, isFrozen } from "@/lib/leadsShared";
import SEED from "@/data/leads.json";

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
const saveScan = (v) => { try { if (v) localStorage.setItem(SCAN_KEY, JSON.stringify(v)); else localStorage.removeItem(SCAN_KEY); } catch {} };
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

const LIKELY = { High: "bg-green-100 text-green-800", Medium: "bg-amber-100 text-amber-800", Low: "bg-zinc-100 text-zinc-600" };
const PROBLEM_TONE = { "No website": "bg-red-600", "Parked domain": "bg-red-600", "Dead/broken site": "bg-red-600", "Broken SSL": "bg-orange-500", "Dated template": "bg-amber-500", "Stale copyright": "bg-zinc-500", "Licence risk": "bg-purple-600", "Low search visibility": "bg-blue-600" };
const money = (n) => (n === null || n === undefined || n === "" ? "—" : `£${Math.round(Number(n)).toLocaleString("en-GB")}`);
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
        const status = !l.problem ? "not-pursuing" : l.emailAddress ? (l.likelihood === "Low" ? "new" : "qualified") : "no-contact";
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
  const [filter, setFilter] = useState("");
  const [showProblem, setShowProblem] = useState("");
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
      for (const l of Object.values(local)) if (!l.problem && ["new", "qualified", "no-contact"].includes(l.status) && websiteIsVerified(l)) { l.status = "not-pursuing"; l.likelihood = "Low"; l.likelihoodWhy = l.likelihoodWhy || "Site is current; no outreach planned"; l.updatedAt = new Date().toISOString(); }
      // Open leads with no verified email address are parked, whatever column they were in.
      for (const l of Object.values(local)) if (!l.emailAddress && (l.contactUnverified || l.contactsTried) && ["new", "qualified"].includes(l.status)) { l.contactUnverified = true; l.status = parkStatus(l); l.updatedAt = new Date().toISOString(); }
      // Contact not verified, and every route tried: nothing more to do, so park it.
      for (const l of Object.values(local)) if (l.status === "no-contact" && contactExhausted(l)) { l.status = "not-pursuing"; l.contactUnverified = true; l.updatedAt = new Date().toISOString(); }
      // "info", "hello" and the like are inboxes, not people: the email opens "Hi there," instead.
      for (const l of Object.values(local)) if (!isFrozen(l) && l.contactName && !firstNameOf(l.contactName)) { l.contactName = ""; l.updatedAt = new Date().toISOString(); }
      // Company-name searches are no longer run; drop any stored ones so only the trade search shows.
      for (const l of Object.values(local)) if (!isFrozen(l) && l.seo?.searches?.some((x) => x.kind !== "trade")) { l.seo = { ...l.seo, searches: l.seo.searches.filter((x) => x.kind === "trade") }; l.updatedAt = new Date().toISOString(); }
      // Parked only for a missing contact? That has its own column now.
      for (const l of Object.values(local)) if (l.status === "not-pursuing" && l.contactUnverified && !l.emailAddress && parkStatus(l) === "no-contact") { l.status = "no-contact"; l.updatedAt = new Date().toISOString(); }
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
        for (const l of Object.values(next)) if (!l.problem && ["new", "qualified", "no-contact"].includes(l.status) && websiteIsVerified(l)) { l.status = "not-pursuing"; l.likelihood = "Low"; l.likelihoodWhy = l.likelihoodWhy || "Site is current; no outreach planned"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!l.emailAddress && (l.contactUnverified || l.contactsTried) && ["new", "qualified"].includes(l.status)) { l.contactUnverified = true; l.status = parkStatus(l); l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "no-contact" && contactExhausted(l)) { l.status = "not-pursuing"; l.contactUnverified = true; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!isFrozen(l) && l.contactName && !firstNameOf(l.contactName)) { l.contactName = ""; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (!isFrozen(l) && l.seo?.searches?.some((x) => x.kind !== "trade")) { l.seo = { ...l.seo, searches: l.seo.searches.filter((x) => x.kind === "trade") }; l.updatedAt = new Date().toISOString(); push(l.id, l); }
        for (const l of Object.values(next)) if (l.status === "not-pursuing" && l.contactUnverified && !l.emailAddress && parkStatus(l) === "no-contact") { l.status = "no-contact"; l.updatedAt = new Date().toISOString(); push(l.id, l); }
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
    if (fields.status && fields.status !== prev.status) l.statusAt = new Date().toISOString();
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
    const floor = resume ? resume.minAssets : minAssets;
    setRun({ ...st });
    try {
      let candidates = resume ? resume.queue : [];
      if (!resume) {
        for (const pl of places) {
          if (stopRef.current) break;
          let start = 0;
          for (let page = 0; page < 5; page++) {
            let j; try { j = await post({ step: "search", place: pl, startIndex: start, areas: [], postcodes: areaPostcodes }); } catch (e) { if (stopRef.current) break; throw e; }
            for (const c of j.candidates) { if (known.has(c.companyNumber)) continue; known.add(c.companyNumber); if (seenRecently(c.companyNumber)) { skipped++; continue; } candidates.push(c); }
            start += 100;
            st.phase = `Searching ${pl}… ${candidates.length} new companies${skipped ? `, ${skipped} already checked` : ""}`; setRun({ ...st });
            if (start >= j.total || j.scanned < 100) break;
          }
        }
        st.total = candidates.length;
      }
      while (candidates.length) {
        if (stopRef.current) break;
        const c = candidates[0];
        saveScan({ kind: "find", queue: candidates, done: st.done, total: st.total, found: st.found, minAssets: floor });
        st.phase = `Checking ${c.name}…`; setRun({ ...st });
        try {
          let { lead } = await post({ step: "enrich", company: c, knownSites, minAssets: floor });
          const tooSmall = lead.netAssets !== null && lead.netAssets !== undefined && lead.netAssets < floor;
          // Licence sweep only for sites we might pitch (not parked/dead, not too small).
          if (!tooSmall && lead.website && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site") { try { st.phase = `Checking licences on ${lead.website}…`; setRun({ ...st }); ({ lead } = await post({ step: "licence", lead })); } catch {} }
          // Last step (spends search credit): are they found for their own trade? A current site that is not
          // becomes a "Low search visibility" lead; leads with no site get a search for one when open.
          if (!tooSmall && websiteIsVerified(lead) && lead.problem && ["High", "Medium"].includes(lead.likelihood) && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site" && ["new", "qualified"].includes(lead.status)) { try { st.phase = `Searching for ${lead.business}…`; setRun({ ...st }); const r = await post({ step: "seo", lead }); if (r.lead) lead = r.lead; } catch {} }
          st.done++;
          if (lead.problem && !tooSmall) { if (["new", "qualified"].includes(lead.status)) st.found++; else st.parked = (st.parked || 0) + 1; update(lead.id, lead); markSeen(c.companyNumber, lead.status); }
          else if (lead.problem) { st.parked = (st.parked || 0) + 1; update(lead.id, { ...lead, status: "not-pursuing" }); markSeen(c.companyNumber, "too-small"); }
          else { st.parked = (st.parked || 0) + 1; update(lead.id, { ...lead, status: "not-pursuing", likelihood: "Low", likelihoodWhy: lead.likelihoodWhy || "Site is current; no outreach planned", caveats: [lead.caveats, "Site is current"].filter(Boolean).join("; ") }); markSeen(c.companyNumber, "site-fine"); } // nothing to pitch, but it goes on the board so you can see it was checked
        } catch (e) { if (stopRef.current) break; st.done++; st.errors.push(`${c.name}: ${e.message}`); }
        candidates = candidates.slice(1);
        setRun({ ...st });
      }
      if (candidates.length) saveScan({ kind: "find", queue: candidates, done: st.done, total: st.total, found: st.found, minAssets: floor }); else saveScan(null);
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
      if (best && !l.emailAddress) { f.emailAddress = best.email; f.contactName = l.contactName || best.name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").split(" ")[0]; if (["no-contact", "not-pursuing"].includes(l.status) && l.contactUnverified) { f.status = l.likelihood === "Low" ? "new" : "qualified"; f.contactUnverified = false; } }
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
      if (["new", "qualified", "no-contact"].includes(l.status) || (l.status === "not-pursuing" && l.contactUnverified)) { if (f.emailAddress || l.emailAddress) { f.status = l.status === "new" ? "new" : (l.likelihood === "Low" ? "new" : "qualified"); f.contactUnverified = false; } else { f.contactUnverified = true; f.status = parkStatus(l); } }
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
        if (websiteIsVerified(lead) && lead.problem && ["High", "Medium"].includes(lead.likelihood) && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site" && ["new", "qualified", "contacted", "replied", "meeting"].includes(lead.status)) { try { st.phase = `Searching for ${lead.business}…`; setRun({ ...st }); const r = await post({ step: "seo", lead }); if (r.lead) lead = { ...r.lead, status: !lead.problem && r.lead.problem ? r.lead.status : lead.status }; } catch {} }
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
        if (best || generic) { f.emailAddress = best ? best.email : generic.value; if (best) f.contactName = firstNameOf(l.contactName) || firstNameOf(best.name); f.contactUnverified = false; f.status = l.likelihood === "Low" ? "new" : "qualified"; st.found++; }
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
          if (["new", "qualified", "no-contact"].includes(cur.status)) { if (email) { f.status = cur.status === "new" ? "new" : "qualified"; f.contactUnverified = false; } else { f.contactUnverified = true; f.status = parkStatus(cur); } }
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
  async function checkLicence(l) {
    update(l.id, { checking: true, error: "" });
    try { const { lead } = await post({ step: "licence", lead: l }); update(l.id, { ...lead, checking: false, error: lead.licence?.error || "" }); }
    catch (e) { update(l.id, { checking: false, error: e.message }); }
  }
  async function checkSeo(l) {
    update(l.id, { checking: true, error: "" });
    try { const r = await post({ step: "seo", lead: l }); update(l.id, { ...(r.lead || {}), seo: r.seo, status: !l.problem && r.lead?.problem ? r.lead.status : l.status, checking: false, error: r.seo.searches.every((x) => x.error) ? r.seo.searches[0]?.error || "Search failed" : "" }); }
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
  const areaTitle = areaState.outcodes ? `Every active trading company registered within ${areaMiles} miles of ${areaCentres.join(", ")}: ${areaState.outcodes} postcode areas, searched as ${areaState.places || 0} towns and districts. Anything registered further out is dropped. Type a town or postcode and press Enter to add it.` : "Type a town or postcode and press Enter. Until an area is set, the scan covers about 20 minutes around Richmond.";
  // Licence and search checks run on their own for any lead that never had them (older leads, or ones
  // parked as "site is current" before search visibility counted), a few at a time, when nothing else is running.
  const catchingUpRef = useRef(false);
  useEffect(() => {
    if (running || catchingUpRef.current) return;
    const siteOk = (l) => l.website && l.problem !== "Parked domain" && l.problem !== "Dead/broken site" && !l.checking;
    const open = (l) => ["new", "qualified", "no-contact"].includes(l.status) && !!l.problem;
    const wantsSeo = (l) => !l.seo && ["High", "Medium"].includes(l.likelihood);
    // Leads from before websites were verified get the free check (company number, postcode, director on the site).
    const toVerify = Object.values(leadsRef.current).filter((l) => siteOk(l) && l.websiteVerified === undefined && !isFrozen(l)).sort((x, y) => (open(x) ? 0 : 1) - (open(y) ? 0 : 1));
    const todo = Object.values(leadsRef.current).filter((l) => siteOk(l) && open(l) && websiteIsVerified(l) && (!l.licence || wantsSeo(l)));
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
        const now = leadsRef.current[l.id] || cur;
        if (wantsSeo(now)) await checkSeo(now);
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
  const current = open ? leads[open] : null;

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
            {running
              ? <button onClick={stopNow} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
              : <button onClick={() => findLeads()} disabled={cfg?.configured === false} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Find leads</button>}
            <button onClick={() => refreshLeads(list.filter((l) => !["won", "lost", "not-pursuing", "ready"].includes(l.status)).map((l) => l.id))} disabled={running || !list.length} title="Re-run the website, search, accounts and contact checks on every open lead with the latest rules (Ready to send, Won, Lost and Not pursuing are skipped). Statuses and notes are kept." className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-4 w-4" /> Rescan all leads</button>
            {(() => { const due = list.filter((l) => !isFrozen(l) && (l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified && !contactExhausted(l))) && l.contactsStamp !== contactsStamp(cfg)); return due.length > 0 && (
              <button onClick={() => retryContacts(due.map((l) => l.id))} disabled={running} title="The contact finder has improved since these were parked (or Hunter.io was connected). Look again; any that now have an address come back to the board." className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 hover:bg-red-100 disabled:opacity-40"><SearchIcon className="h-4 w-4" /> Retry contacts ({due.length}{(() => { const h = cfg?.hunter ? due.filter((l) => l.likelihood === "High" && !l.hunterTried && l.website).length : 0; return h ? `, ${h} High via Hunter` : ""; })()})</button>
            ); })()}
            <button onClick={exportExcel} disabled={!list.length} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40"><DownloadIcon className="h-4 w-4" /> Excel</button>
          </div>
        </div>
        {cfg?.hunter && cfg.hunterUsage?.cap > 0 && (
          <p className="mt-2 text-xs text-zinc-500" title="One Hunter credit per lead, spent only on High leads where the site and Companies House gave no address. Medium and Low leads and background lookups never use one.">Hunter.io credits used this month: <span className={cfg.hunterUsage.used >= cfg.hunterUsage.cap ? "font-semibold text-red-700" : "font-semibold"}>{cfg.hunterUsage.used}</span> of {cfg.hunterUsage.cap}. Spent only on High leads the free routes couldn&apos;t find an address for.</p>
        )}
        {cfg?.brave && cfg.usage?.cap > 0 && (
          <p className="mt-2 text-xs text-zinc-500" title="Searches check where each lead ranks for its trade and town (the SEO point in the email) and find websites the name-guess misses. Two per lead; the app stops at the cap so the card is never charged.">Brave Search credit used this month: <span className={cfg.usage.used >= cfg.usage.cap ? "font-semibold text-red-700" : "font-semibold"}>{cfg.usage.used}</span> of {cfg.usage.cap} searches, about {Math.max(0, Math.floor((cfg.usage.cap - cfg.usage.used) / 2))} more leads.</p>
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
        <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700" title="Only keep companies with net assets of at least this. Changing it re-sorts the board: parked leads above the new floor come back, open leads below it are parked. Leads already in conversation are left alone.">Net assets ≥ £<input type="number" value={minAssets} onChange={(e) => setMinAssets(Number(e.target.value) || 0)} step={5000} min={0} className="w-20 rounded border border-zinc-200 px-1.5 py-0.5 text-sm" /></label>
        <select value={showProblem} onChange={(e) => setShowProblem(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <option value="">All problems</option>
          {PROBLEMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-zinc-500">{visible.length} of {list.length} leads · drag a card to change its status{pendingRescan.size ? <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">{pendingRescan.size} hidden until rescanned</span> : null}</span>
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
      <Board leads={visible} followUp={followUp} filtering={!!q || !!showProblem} selected={selected} onToggle={toggle} onSelectColumn={selectIds} onOpen={setOpen}
        onMove={(id, status) => { if (selected.has(id)) { moveMany([...selected], status); setSelected(new Set()); } else update(id, { status }); }} />

      {current && <LeadDrawer l={current} followUp={followUp} hunterOn={!!cfg?.hunter} subjects={linksRef.current?.subjects || {}} onClose={() => setOpen(null)} onChange={(f) => update(current.id, f)} onRemove={() => remove(current.id)} onRecheck={(redraft) => recheck(current, redraft)} onContacts={() => findContacts(current)} onHunter={() => hunterLookup(current)} onSeo={() => checkSeo(current)} onLicence={() => checkLicence(current)} onRefresh={() => refreshLeads([current.id])} />}
    </div>
  );
}

// The real reason a lead sits in Not pursuing, if there is one beyond a missing contact.
const parkReason = (l) => { const m = `${l.caveats || ""}; ${l.likelihoodWhy || ""}`.split(/;\s*/).find((x) => /under £|already a client|site is current|dormant/i.test(x)); if (m) return m.trim().replace(/\.$/, ""); if (contactExhausted(l)) return "Verified email not found"; return ""; };
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

const sorted = (list) => list.slice().sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.likelihood] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.likelihood] ?? 3) || (b.netAssets || 0) - (a.netAssets || 0));

function Board({ leads, followUp, filtering, selected, onToggle, onSelectColumn, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  const [shown, setShown] = useState({}); // cards rendered per column; big columns page in
  // While searching or filtering, only columns with a match are shown.
  const cols = LEAD_STATUSES.map(([id, label, hint]) => ({ id, label, hint, items: sorted(leads.filter((l) => (l.status || "new") === id)) })).filter((c) => !filtering || c.items.length);
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
          <div className="flex flex-1 flex-col gap-2">
            {c.items.slice(0, shown[c.id] || 60).map((l) => (
              <div key={l.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/lead", l.id); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(l.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(l.id); }}
                className={`cursor-grab rounded-lg border bg-white p-2.5 text-left shadow-sm hover:border-zinc-400 active:cursor-grabbing ${selected.has(l.id) ? "border-blue-500 ring-1 ring-blue-300" : "border-zinc-200"}`}>
                <div className="flex items-start gap-1.5">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggle(l.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${l.business}`} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-sm font-medium leading-tight">{l.business}</span>
                  {l.likelihood && c.id !== "not-pursuing" && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${LIKELY[l.likelihood]}`} title={l.likelihoodWhy || ""}>{l.likelihood}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                  {l.problem && <span className={`rounded-full px-1.5 py-0.5 font-semibold text-white ${PROBLEM_TONE[l.problem] || "bg-zinc-500"}`}>{l.problem}</span>}
                  {l.contactUnverified && c.id !== "no-contact" && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">Contact not verified</span>}
                  {l.optedOut && <span className="rounded-full bg-red-600 px-1.5 py-0.5 font-semibold text-white" title={`Asked not to be contacted${l.optedOutAt ? ` on ${new Date(l.optedOutAt).toLocaleDateString("en-GB")}` : ""}`}>Opted out</span>}
                  {l.tradesElsewhere && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-800" title={`Website address: ${l.tradingAddress}`}>Trades elsewhere</span>}
                  {!websiteIsVerified(l) && !isFrozen(l) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="The website was matched on its name only. Open the lead and confirm it is theirs before anything goes out.">Confirm website</span>}
                  {needsChase(l, followUp) && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 font-semibold text-white" title={`No reply ${Math.floor(daysSince(l))} days after contact: send the follow-up`}>Chase</span>}
                  {l.status === "contacted" && l.chasedAt && <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-zinc-700">Chased {new Date(l.chasedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  <span>{l.area}</span>
                  {l.netAssets != null && l.netAssets !== "" && <span>· {money(l.netAssets)}</span>}
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
function Field({ label, children }) {
  return <div><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div><div className="mt-0.5 text-sm">{children}</div></div>;
}
function TextField({ label, value, onChange, rows = 2, mono = false }) {
  return (
    <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <AutoTextarea value={value || ""} onChange={(e) => onChange(e.target.value)} minRows={rows} className={`mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm ${mono ? "font-mono text-xs" : ""}`} />
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
  onChange({ emailAddress: email, contactName: first, subject: next.subject, email: next.email, issueId: next.issueId, emailEdited: next.edited, drafts, ...((l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified)) && verified ? { status: l.likelihood === "Low" ? "new" : "qualified", contactUnverified: false } : {}) });
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

function LeadDrawer({ l, followUp = FOLLOW_UP_DEFAULTS, hunterOn = false, subjects = {}, onClose, onChange, onRemove, onRecheck, onContacts, onHunter, onSeo, onLicence, onRefresh }) {
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // Older drafts carry the greeting inside the text; new ones get it written on the day.
  const emailText = /^Hi\b/.test(l.email || "") ? (l.email || "") : fullEmail(l, l.email || "");
  const greetingPreview = /^Hi\b/.test(l.email || "") ? "" : `${firstNameOf(l.contactName) ? `Hi ${firstNameOf(l.contactName)},` : "Hi there,"}\n\n${dayGreeting()}`;
  const genericBox = GENERIC_BOX_RE.test(String(l.emailAddress || "").split("@")[0]);
  const full = `Subject: ${l.subject || ""}\n\n${emailText}`;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(l.emailAddress || "")}&subject=${encodeURIComponent(l.subject || "")}&body=${encodeURIComponent(emailText)}`;
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
    onChange({ website: host, websiteConfirmed: true, websiteVerified: "confirmed by you", websiteEvidence: "confirmed by you", websiteDoubt: "", siteUrl: "", ...(l.problem === "No website" ? { problem: "", problemDetail: "" } : {}), ...(fromOld(l.emailAddress) ? { emailAddress: "", contactName: "" } : {}), caveats: String(l.caveats || "").split("; ").filter((x) => x && !/no website|not found by name|confirm the website/i.test(x)).join("; ") });
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
              {(l.tradingTown || l.area) && <span className={`inline-flex items-center gap-1 text-xs ${l.tradesElsewhere ? "text-red-700" : "text-zinc-600"}`} title={l.tradingAddress ? `Address on their website: ${l.tradingAddress}${l.area && l.tradingTown && l.tradingTown !== l.area ? ` (registered office: ${l.area})` : ""}` : `Registered office: ${l.address || l.area}`}><PinIcon /> {l.tradingTown || l.area}{l.tradingTown && l.area && l.tradingTown.toLowerCase() !== l.area.toLowerCase() ? <span className="text-zinc-400"> · registered in {l.area}</span> : null}</span>}
              {l.companyNumber && <a href={`https://find-and-update.company-information.service.gov.uk/company/${l.companyNumber}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">Companies House {l.companyNumber} <ExternalIcon /></a>}
              {l.website && <button onClick={rejectWebsite} title="This website belongs to a different business. It is dropped, remembered as wrong, and the lead is rescanned without it." className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800 hover:bg-red-100">Not their website</button>}
            </div>
            {l.websiteDoubt && l.website && <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"><span className="font-semibold">Check the website.</span> {l.websiteDoubt}</div>}
            {l.website && !websiteIsVerified(l) && !l.websiteDoubt && !isFrozen(l) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span><span className="font-semibold">Is this their website?</span> {l.websiteVerified === undefined ? "Checking it against Companies House…" : `Matched on ${l.websiteEvidence || "the name"} only; nothing on the site ties it to company ${l.companyNumber || "number"} yet. Open it and check before anything goes out.`}</span>
                <span className="ml-auto flex gap-2">
                  {site && <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100">Open site <ExternalIcon /></a>}
                  <button onClick={() => commitWebsite(l.website, true)} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">Yes, it’s theirs</button>
                  <button onClick={rejectWebsite} className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-800 hover:bg-red-50">Not theirs</button>
                </span>
              </div>
            )}
            {l.website && websiteIsVerified(l) && l.websiteVerified && <div className="text-[11px] text-emerald-700">Website verified: {l.websiteVerified}</div>}
          </div>
          <select value={l.status || "new"} onChange={(e) => onChange({ status: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm">
            {LEAD_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><CloseIcon /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="space-y-4 px-5 py-4">
          {(l.whatTheyDo || l.siteDescription || l.background || l.sics?.length) && (
            <p className="text-sm text-zinc-700">
              <span className="font-medium" title={l.sicStale ? `Companies House lists this company as: ${sicDescription(l.sics)}. The website says otherwise, so that is hidden.` : undefined}>{l.whatTheyDo || sicDescription(l.sics) || (l.sics?.length ? `SIC ${l.sics[0]}` : "")}</span>
              {l.background && <span className="text-zinc-500"> · {l.background}</span>}{l.area && <span className="text-zinc-500"> · {l.area}</span>}
              {l.siteDescription && <span className="block text-zinc-500">“{l.siteDescription}”</span>}
              {l.tradingAddress && <span className={`block ${l.tradesElsewhere ? "font-medium text-red-700" : "text-zinc-500"}`}>Trades from {l.tradingAddress}{l.tradesElsewhere ? " — outside our area; only the registered office is local" : ""}</span>}
            </p>
          )}
          {l.status === "not-pursuing" ? (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"><span className="font-semibold">Not worth pursuing.</span> {parkExplain(l)} <span className="text-red-700">Change the status above if you still want to go for it.</span></div>
          ) : l.likelihood && (
            <div className={`rounded-lg px-3 py-2 text-sm ${LIKELY[l.likelihood]}`}>
              <span className="font-semibold">{l.likelihood} likelihood</span>{l.likelihoodWhy ? <span>: {l.likelihoodWhy}</span> : null}
            </div>
          )}
          {l.contactUnverified && l.status !== "not-pursuing" && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><span className="font-semibold">Contact not verified.</span> No email address was found on their site or at Companies House. Add a verified address below, or pick a person with one, and it moves back to Qualified.</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Likelihood"><select value={l.likelihood || ""} onChange={(e) => onChange({ likelihood: e.target.value })} className={`rounded px-1.5 py-0.5 text-sm font-semibold ${LIKELY[l.likelihood] || ""}`}><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></Field>
            <Field label={`Net assets${l.accountsDate ? ` · year to ${accountsYear(l.accountsDate)}` : ""}`}>{money(l.netAssets)}{accountsNote(l)}</Field>
            <Field label="RE change">{signed(l.reChange)}</Field>
            <Field label="Area"><input value={l.area || ""} onChange={(e) => onChange({ area: e.target.value })} className="w-full rounded border border-transparent hover:border-zinc-300" /></Field>
          </div>
          <TextField label="Problem detail" value={l.problemDetail} onChange={(v) => onChange({ problemDetail: v })} rows={1} />
          <TextField label="Likelihood rationale" value={l.likelihoodWhy} onChange={(v) => onChange({ likelihoodWhy: v })} rows={2} />
          <TextField label="Background" value={l.background} onChange={(v) => onChange({ background: v })} rows={2} />
          <TextField label="Pitch angle" value={l.pitch} onChange={(v) => onChange({ pitch: v })} rows={2} />
          <TextField label="Caveats" value={l.caveats} onChange={(v) => onChange({ caveats: v })} rows={1} />

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Search visibility</span>
              {(l.website || l.trade || l.tradeOverride) && (() => { const q = l.seo?.searches?.find((x) => x.kind === "trade")?.query || ""; const town = l.tradingTown || l.area || ""; const auto = l.trade || (q && town && q.toLowerCase().endsWith(" " + town.toLowerCase()) ? q.slice(0, -town.length - 1) : q); return (
                <label className="inline-flex items-center gap-1 text-xs text-zinc-600" title="What a customer would type. Make it as specific as their business really is, then Search again.">searching for
                  <input key={`${l.id}:${l.tradeOverride || ""}:${auto}`} defaultValue={l.tradeOverride || auto} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (l.tradeOverride || auto)) onChange({ tradeOverride: v === auto ? "" : v }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} placeholder="e.g. trophy shop" className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs" style={{ width: `${Math.max(12, (l.tradeOverride || auto || "").length + 2)}ch` }} />
                  {town ? <span>in {town}</span> : null}
                </label>
              ); })()}
              <button onClick={onSeo} disabled={l.checking} className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"><SearchIcon className="h-3.5 w-3.5" /> {l.seo ? "Search again" : "Check search"}</button>
            </div>
            {!l.seo && <p className="mt-2 text-xs text-zinc-500">Runs during the scan for Medium and High leads once the website is verified. Searches their trade + town, the search customers make, and records where their site comes.</p>}
            {l.seo && (
              <ul className="mt-2 space-y-1 text-sm">
                {l.seo.searches.filter((x) => x.kind === "trade").map((x, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-zinc-600">“{x.query}”</span>
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(x.query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-blue-700 underline" title="See the live Google results for this search">check on Google <ExternalIcon /></a>
                    {x.error ? <span className="text-red-700">{x.error}</span> : <>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${x.position === 1 ? "bg-green-100 text-green-800" : x.position && x.position <= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{x.position ? `#${x.position}` : "Not on page 1"}</span>
                      {x.volume > 0 && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{x.volume.toLocaleString("en-GB")} searches/month</span>}
                      {x.ahead?.length > 0 && <span className="text-xs text-zinc-500">behind {x.ahead.join(", ")}</span>}
                      {x.directoriesOnly && <span className="text-xs text-zinc-500">directories hold the top spots</span>}
                    </>}
                  </li>
                ))}
                <li className="text-[11px] text-zinc-400">{l.seo.engine} · {new Date(l.seo.checkedAt).toLocaleDateString("en-GB")}{l.website ? "" : " · no website, so only competitors are listed"}</li>
              </ul>
            )}
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
              ) : <p className="mt-0.5 text-xs text-zinc-500">No issue found on the site yet. The licence and search checks run on their own; Rescan this lead to look again now.</p>}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">To</div>
                <input value={l.emailAddress || ""} onChange={(e) => onChange({ emailAddress: e.target.value, ...((l.status === "no-contact" || (l.status === "not-pursuing" && l.contactUnverified)) && e.target.value.trim() ? { status: l.likelihood === "Low" ? "new" : "qualified", contactUnverified: false } : {}) })} placeholder={l.emailNote || "email address"} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
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

        </div></div>
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-5 py-3 text-xs shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)]">
          <button onClick={() => onRefresh()} disabled={l.checking} className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" /> Rescan this lead</button>
          {!l.optedOut
            ? <button onClick={() => { if (confirm("Mark as opted out? The lead moves to Lost and is never chased or emailed from here again.")) onChange({ optedOut: true, optedOutAt: new Date().toISOString(), status: "lost", notesLog: [...(l.notesLog || []), { at: new Date().toISOString(), text: "Asked not to be contacted" }] }); }} className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50" title="They replied asking not to hear from us">Do not contact</button>
            : <button onClick={() => onChange({ optedOut: false })} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-zinc-600 hover:bg-zinc-100">Undo opt-out</button>}
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
  );
}
