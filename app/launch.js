"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadTeam, normaliseTeam } from "@/app/team";
import { loadClients } from "@/app/clients";
import { scanFonts, scanImages } from "@/app/scans";
import { isEmbeddedIconFont, isFreeFontAwesome, issueLabel, mergeImageSizes, fixedFix, freeRouteLink } from "@/lib/fontlink";
import { isFreeLib } from "@/lib/email";
import { clientForSite, normaliseClients, teamMemberForManager } from "@/lib/clients";
import { evaluateLaunch, CHECK_STAGES } from "@/lib/launchChecks";
import { PlayIcon, StopIcon, RefreshIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon, ExternalIcon, FlagIcon, CheckIcon, SpinnerIcon, InfoIcon, ArchiveIcon } from "@/app/icons";
import { pullSetting, pushSetting } from "@/app/shared";

// Launch and post-launch checks keep separate results and sign-offs.
export const keysFor = (mode) => { const sfx = mode === "post" ? "-post" : ""; return { runs: `flc-launch-v1${sfx}`, sign: `flc-launch-signoffs-v1${sfx}`, log: `flc-launch-log-v1${sfx}` }; };
const MARKER_KEY = "flc-marker-v1"; // {site: Marker.io project link}
const MAX_LINKS = 800;
const MAX_IMAGES = 600;
const MAX_PSI = 500; // every page gets a Google PageSpeed audit (about 20s each, 3 at a time)
const FILE_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json|ico|woff2?|ttf|otf)(\?|$)/i;

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const hostKey = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
const hostOf = (u) => { try { return hostKey(new URL(u).host); } catch { return ""; } };
const keyFor = (input) => { let s = String(input || "").trim(); if (!/^https?:\/\//i.test(s)) s = "https://" + s; return hostOf(s); };


export default function LaunchArea({ post, onRunning, onCount, onSiteResult, mode = "launch" }) {
  const { runs: RUNS_KEY, sign: SIGN_KEY, log: LOG_KEY } = keysFor(mode);
  const storeKey = (key) => (mode === "post" ? `${key}#post` : key); // shared-store id for sign-offs
  // Launch Checks = the pre-go-live list (7.2); Post Launch Checks = the launch actions list (8.1).
  const forMode = (checks) => checks.filter((c) => (mode === "post" ? c.section === "Launch actions" : c.section === "Launch checks"));
  const [url, setUrl] = useState("");
  const [markerLink, setMarkerLink] = useState("");
  const [markerReady, setMarkerReady] = useState(null); // null unknown, true/false from /api/marker
  const [markerCreate, setMarkerCreate] = useState(false); // can Marker.io create issues?
  const [runs, setRuns] = useState({});
  const [signoffs, setSignoffs] = useState({});
  const [logs, setLogs] = useState({});
  const [shared, setShared] = useState(false);
  const [team, setTeam] = useState([]);
  const [clients, setClients] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [running, setRunning] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const saved = load(RUNS_KEY, {});
      for (const r of Object.values(saved)) if (r.status === "RUNNING") Object.assign(r, r.work ? { status: "PAUSED", phase: "" } : { status: "ERROR", error: "Check was interrupted (page reloaded or closed). Press Rescan." });
      setRuns(saved);
      pullSetting("marker", MARKER_KEY); // team's Marker.io project links
      // Shared runs (when storage is set up) replace older local copies.
      fetch(`/api/results?kind=${mode}`).then((r) => r.json()).then((j) => {
        if (!j.shared) return;
        sharedRunsRef.current = true;
        setRuns((prev) => {
          const next = { ...prev };
          for (const [key, run] of Object.entries(j.results || {})) {
            if (!prev[key] || prev[key].status === "RUNNING" || String(run.scannedAt || "") >= String(prev[key].scannedAt || "")) { next[key] = run; syncedRunsRef.current[key] = `${run.scannedAt}|${run.archivedAt || ""}`; }
          }
          save(RUNS_KEY, next);
          return next;
        });
      }).catch(() => {});
      setSignoffs(load(SIGN_KEY, {}));
      setLogs(load(LOG_KEY, {}));
      setTeam(loadTeam());
      setClients(loadClients());
    }, 0);
    fetch("/api/clients").then((r) => r.json()).then((j) => { if (j.shared && Array.isArray(j.clients) && j.clients.length) setClients(normaliseClients(j.clients)); }).catch(() => {});
    // Shared store (when set up) wins over this browser's copy.
    fetch("/api/marker").then((r) => r.json()).then((j) => { setMarkerReady(!!(j.configured && j.ok)); setMarkerCreate(!!(j.configured && j.ok && j.createTool)); }).catch(() => setMarkerReady(false));
    fetch("/api/team").then((r) => r.json()).then((j) => { if (j.shared && Array.isArray(j.team) && j.team.length) setTeam(normaliseTeam(j.team)); }).catch(() => {});
    for (const key of Object.keys(load(RUNS_KEY, {}))) refreshSignoffs(key);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshSignoffs(key) {
    try {
      const j = await (await fetch(`/api/signoffs?site=${encodeURIComponent(storeKey(key))}`)).json();
      if (!j.shared) return;
      setShared(true);
      setSignoffs((prev) => ({ ...prev, [key]: j.signoffs || {} }));
      setLogs((prev) => ({ ...prev, [key]: j.log || [] }));
    } catch {}
  }

  const sharedRunsRef = useRef(false);
  const syncedRunsRef = useRef({}); // key -> scannedAt already pushed
  const patch = (key, fields) => setRuns((prev) => {
    const next = { ...prev, [key]: { ...(prev[key] || {}), ...fields } };
    save(RUNS_KEY, next);
    // Finished runs go to the shared store so the whole team sees them.
    const run = next[key];
    const mark = `${run.scannedAt}|${run.archivedAt || ""}`;
    if (sharedRunsRef.current && run.status === "DONE" && run.scannedAt && syncedRunsRef.current[key] !== mark) {
      syncedRunsRef.current[key] = mark;
      const data = { ...run }; delete data.work;
      fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: mode, site: key, data }) }).catch(() => {});
    }
    return next;
  });
  // Every sign-off change is logged: who, which check, when.
  async function sign(key, check, name, notRequired = false) {
    const at = new Date().toISOString();
    const prevSign = signoffs[key]?.[check.id];
    const entry = name
      ? { at, checkId: check.id, check: check.title, action: notRequired ? "Marked not required" : prevSign ? `Changed from ${prevSign.name}` : "Signed off", name }
      : { at, checkId: check.id, check: check.title, action: "Sign-off removed", name: prevSign?.name || "" };
    setSignoffs((prev) => {
      const site = { ...(prev[key] || {}) };
      if (name) site[check.id] = { name, at, ...(notRequired ? { notRequired: true } : {}) }; else delete site[check.id];
      const next = { ...prev, [key]: site };
      save(SIGN_KEY, next);
      return next;
    });
    setLogs((prev) => {
      const next = { ...prev, [key]: [...(prev[key] || []), entry] };
      save(LOG_KEY, next);
      return next;
    });
    if (shared) {
      try {
        const j = await post("/api/signoffs", { site: storeKey(key), checkId: check.id, check: check.title, name, notRequired: !!notRequired });
        if (j.shared) {
          setSignoffs((prev) => ({ ...prev, [key]: j.signoffs || {} }));
          setLogs((prev) => ({ ...prev, [key]: j.log || [] }));
        }
      } catch {}
    }
  }
  // Archiving keeps the check (and its sign-offs) but hides it; archived checks live in Settings.
  function archiveRun(key) {
    patch(key, { archived: true, archivedAt: new Date().toISOString() });
    if (openKey === key) setOpenKey(null);
  }

  // One launch check, as a resumable sequence of short requests. Progress is
  // saved after every batch (r.work), so an interrupted check can be finished
  // later with runCheck(input, undefined, { resume: true }) instead of starting over.
  async function runCheck(input, markerProject, { resume = false, only = null } = {}) {
    const key = keyFor(input);
    if (!key) return;
    if (markerProject !== undefined) { const all = load(MARKER_KEY, {}); if (markerProject.trim()) all[key] = markerProject.trim(); else delete all[key]; save(MARKER_KEY, all); pushSetting("marker", all); }
    stopRef.current = false;
    setRunning(key);
    onRunning?.(true);
    setOpenKey(key);
    const prev = load(RUNS_KEY, {})[key];
    let w = resume && prev?.work ? prev.work : null;
    // Partial rescan: start from the last results and redo only the stages listed in `only`.
    if (!w && only && prev?.status === "DONE" && prev.pages) {
      const statusOf = {};
      for (const p of prev.pages) { statusOf[p.url] = { status: p.status, error: p.error || "" }; if (p.finalUrl && !statusOf[p.finalUrl]) statusOf[p.finalUrl] = statusOf[p.url]; }
      w = { stage: only.includes("start") ? "start" : "links", only, startInfo: prev.start, site: prev.start.host, pageQueue: [], queued: [], pages: prev.pages, leftover: prev.complete?.pages ? 0 : 1,
        linkSources: prev.linkSources || {}, linkTexts: prev.linkTexts || {}, imageSources: prev.imageSources || {}, statusOf,
        linkList: only.includes("links") ? null : [], linksLeft: 0, linkStatus: only.includes("links") ? {} : (prev.linkStatus || {}),
        imgAll: Object.keys(prev.imageSources || {}).length, imgList: only.includes("images") ? null : [], imageInfo: only.includes("images") ? {} : (prev.imageInfo || {}),
        psiList: only.includes("psi") ? null : Object.keys(prev.psi || {}), psiQueue: null, psi: only.includes("psi") ? {} : (prev.psi || {}), psiError: only.includes("psi") ? "" : (prev.psiError || ""), psiDone: 0, psiTried: [],
        okCount: prev.pages.filter((p) => p.status >= 200 && p.status < 400 && !p.notHtml && !p.error).length, keepMarker: !only.includes("marker") ? prev.marker : undefined,
        fontScan: only.includes("fonts") ? null : prev.fontScan, imageScan: only.includes("licence-images") ? null : prev.imageScan };
    }
    patch(key, { input, status: "RUNNING", phase: w ? (only ? "Rescanning unsigned checks" : "Finishing the check") : "Reading the site", done: 0, total: 1, pct: w ? undefined : 1, error: "" });
    // Overall progress across the whole check, not just the current step.
    const WEIGHTS = { start: 3, pages: 25, links: 10, images: 7, psi: 30, fonts: 5, "licence-images": 15, marker: 5 };
    const ORDER = Object.keys(WEIGHTS);
    const overall = (stage, done, total) => {
      const i = ORDER.indexOf(stage);
      const before = ORDER.slice(0, Math.max(0, i)).reduce((n, k) => n + WEIGHTS[k], 0);
      return Math.min(100, before + (WEIGHTS[stage] || 0) * (total ? Math.min(1, done / total) : 0));
    };
    const progress = (phase, done, total, stage = w?.stage) => patch(key, { work: w, phase, done, total, pct: overall(stage, done, total) });
    const paused = () => { patch(key, { status: "PAUSED", work: w, phase: "" }); };
    try {
      if (w?.stage === "start") {
        // Partial rescan of site-level facts (SSL, redirects, robots, sitemap, email) keeping the pages.
        const start = await post("/api/launch", { step: "start", url: input });
        if (start.error) { patch(key, { status: "DONE", work: null, error: start.error }); return; }
        const startInfo = { ...start }; delete startInfo.pageQueue;
        w.startInfo = startInfo;
        w.stage = "links";
      }
      if (!w) {
        const start = await post("/api/launch", { step: "start", url: input });
        if (start.error) { patch(key, { status: "ERROR", error: start.error, work: null }); return; }
        const { pageQueue, ...startInfo } = start;
        w = { stage: "pages", startInfo, site: startInfo.host, pageQueue: [...pageQueue], queued: pageQueue.map((u) => u.replace(/\/$/, "")), pages: [], leftover: 0,
          linkSources: {}, linkTexts: {}, imageSources: {}, statusOf: {},
          linkList: null, linksLeft: 0, linkStatus: {}, imgAll: 0, imgList: null, imageInfo: {}, psiList: null, psiQueue: null, psi: {}, psiError: "", psiDone: 0, fontScan: null, imageScan: null };
      }
      const site = w.site;

      // 1) Every page from the sitemap (or crawled from the homepage when there is none).
      if (w.stage === "pages") {
        const queued = new Set(w.queued);
        while (w.pageQueue.length && !stopRef.current) {
          progress("Checking pages", w.pages.length, w.pages.length + w.pageQueue.length);
          const batch = w.pageQueue.slice(0, 10);
          const out = await post("/api/launch", { step: "pages", urls: batch });
          w.pageQueue.splice(0, batch.length);
          if (out.error) { w.leftover += batch.length; continue; }
          for (const p of out.pages || []) {
            w.statusOf[p.url] = { status: p.status, error: p.error || "" };
            if (p.finalUrl && !w.statusOf[p.finalUrl]) w.statusOf[p.finalUrl] = w.statusOf[p.url];
            for (const l of p.links || []) if (hostOf(l) === site && !w.linkSources[l]) { w.linkSources[l] = p.url; w.linkTexts[l] = p.linkText?.[l] || ""; }
            for (const i of p.images || []) if (!w.imageSources[i]) w.imageSources[i] = p.url;
            if (!w.startInfo.hasSitemap) for (const l of p.links || []) {
              const k = l.replace(/\/$/, "");
              if (hostOf(l) === site && !FILE_RE.test(l) && !queued.has(k) && queued.size < 500) { queued.add(k); w.pageQueue.push(l); }
            }
            const slim = { ...p }; delete slim.links; delete slim.images; delete slim.linkText;
            w.pages.push(slim);
          }
          w.queued = [...queued];
          if (out.remaining?.length) w.pageQueue.unshift(...out.remaining);
        }
        if (stopRef.current) return paused();
        w.leftover += w.pageQueue.length;
        w.stage = "links";
      }

      // 2) Internal links: pages already fetched give their own status, the rest are checked.
      if (w.stage === "links") {
        if (!w.linkList) {
          const toCheck = [];
          for (const l of Object.keys(w.linkSources)) {
            const st = w.statusOf[l] || w.statusOf[l.replace(/\/$/, "")] || w.statusOf[l + "/"];
            if (st) w.linkStatus[l] = st; else toCheck.push(l);
          }
          w.linkList = toCheck.slice(0, MAX_LINKS);
          w.linksLeft = toCheck.length - w.linkList.length;
        }
        while (w.linkList.length && !stopRef.current) {
          progress("Checking links", Object.keys(w.linkStatus).length, Object.keys(w.linkStatus).length + w.linkList.length);
          const batch = w.linkList.slice(0, 40);
          const out = await post("/api/launch", { step: "urls", urls: batch });
          w.linkList.splice(0, batch.length);
          Object.assign(w.linkStatus, out.results || {});
          if (out.remaining?.length) w.linkList.unshift(...out.remaining);
        }
        if (stopRef.current) return paused();
        w.linksLeft += w.linkList.length;
        w.stage = "images";
      }

      // 3) Images: do they load, and how big are they.
      if (w.stage === "images") {
        if (!w.imgList) { const all = Object.keys(w.imageSources); w.imgAll = all.length; w.imgList = all.slice(0, MAX_IMAGES); }
        while (w.imgList.length && !stopRef.current) {
          progress("Checking images", Object.keys(w.imageInfo).length, Object.keys(w.imageInfo).length + w.imgList.length);
          const batch = w.imgList.slice(0, 40);
          const out = await post("/api/launch", { step: "urls", urls: batch });
          w.imgList.splice(0, batch.length);
          Object.assign(w.imageInfo, out.results || {});
          if (out.remaining?.length) w.imgList.unshift(...out.remaining);
        }
        if (stopRef.current) return paused();
        w.stage = "psi";
      }

      // 4) Google PageSpeed (Lighthouse) on each page: contrast, text size, other accessibility errors, image savings.
      if (w.stage === "psi") {
        if (!w.psiList) {
          const okUrls = w.pages.filter((p) => p.status >= 200 && p.status < 400 && !p.notHtml && !p.error).map((p) => p.url);
          w.okCount = okUrls.length;
          w.psiList = okUrls.slice(0, MAX_PSI);
        }
        // Anything not yet answered is still to do (an audit in flight when the page closed is redone).
        w.psiQueue = w.psiList.filter((u) => !(u in w.psi) && !(w.psiTried || []).includes(u));
        w.psiTried = w.psiTried || [];
        progress("Accessibility audit (Google PageSpeed)", w.psiDone, w.psiList.length);
        // Three at a time keeps well inside Google's per-minute limit; a 429 pauses everyone and retries.
        let pausedUntil = 0;
        await Promise.all(Array.from({ length: 3 }, async () => {
          while (w.psiQueue.length && !stopRef.current && !w.psiError) {
            const u = w.psiQueue.shift();
            let out = null;
            for (let attempt = 0; attempt < 4 && !stopRef.current; attempt++) {
              if (pausedUntil > Date.now()) { progress("Accessibility audit (waiting for Google's rate limit)", w.psiDone, w.psiList.length); await new Promise((res) => setTimeout(res, pausedUntil - Date.now())); }
              out = await post("/api/launch", { step: "psi", url: u });
              if (out.ok || out.fatal) break;
              if (out.retryAfter) pausedUntil = Math.max(pausedUntil, Date.now() + out.retryAfter * 1000 * (attempt + 1));
              else if (attempt >= 1) break; // other errors: one retry only
            }
            if (out?.fatal) { w.psiError = out.error; break; }
            if (out.ok) w.psi[u] = out; else w.psiTried.push(u);
            w.psiDone = Object.keys(w.psi).length + w.psiTried.length;
            progress("Accessibility audit (Google PageSpeed)", w.psiDone, w.psiList.length);
          }
        }));
        if (stopRef.current) return paused();
        w.stage = "licences";
      }

      // 5) Font and stock-image licences (the same scans as the Font/Image Licenses tabs).
      if (w.stage === "licences") {
        const siteKey = key;
        if (!w.fontScan) {
          progress("Checking font licences", 0, 1, "fonts");
          let f = {};
          await scanFonts(post, siteKey, (fields) => { f = { ...f, ...fields }; onSiteResult?.(siteKey, fields); });
          w.fontScan = { status: f.status, error: f.error || "", fonts: (f.fonts || []).filter((x) => (x.status === "PROBLEM" || x.status === "CHECK") && !isEmbeddedIconFont(x) && !isFreeFontAwesome(x)).map((x) => ({ family: x.family, status: x.status, label: issueLabel(x), note: x.note, source: x.source, styles: x.styles || [], kind: x.kind || "", hostedOn: x.hostedOn || "", fix: fixedFix(x), fixUrl: freeRouteLink(x) })), okCount: (f.fonts || []).filter((x) => x.status === "OK").length };
          progress("Checking font licences", 1, 1, "fonts");
        }
        if (!w.imageScan) {
          let im = {};
          await scanImages(post, siteKey, (fields) => {
            im = { ...im, ...fields };
            onSiteResult?.(siteKey, fields);
            if (fields.imgTotal) progress("Checking stock image licences", fields.imgDone || 0, fields.imgTotal, "licence-images");
          }, () => stopRef.current);
          if (stopRef.current) return paused();
          const paid = mergeImageSizes((im.images || []).filter((i) => i.flag && !isFreeLib(i.flag)));
          w.imageScan = { status: im.imgStatus, error: im.imgError || "", pagesScanned: im.pagesScanned || 0, imagesChecked: im.imagesChecked || 0, paid: paid.slice(0, 100).map((i) => ({ url: i.url, flag: i.flag, page: (i.pages || [])[0] || i.page || "" })), paidCount: paid.length };
        }
        w.stage = "marker";
      }

      // 6) Marker.io accessibility monitoring for this project (when a project link is set).
      let markerInfo = w.keepMarker || null;
      const projLink = load(MARKER_KEY, {})[key] || "";
      if (projLink && markerReady !== false && !w.keepMarker) {
        // Ask Marker.io for a fresh scan and wait for it (up to 5 minutes), then read the results.
        try {
          progress("Marker.io accessibility scan", 0, 1);
          const t = await post("/api/marker-monitor", { project: projLink, action: "scan" });
          const started = Date.now();
          let done = !t.ok || !t.scanId;
          while (!done && Date.now() - started < 5 * 60_000 && !stopRef.current) {
            await new Promise((res) => setTimeout(res, 15_000));
            const st = await post("/api/marker-monitor", { project: projLink, action: "scan-status", scanId: t.scanId });
            progress(`Marker.io is scanning (${st.status || "running"})`, Math.min(0.9, (Date.now() - started) / (5 * 60_000)), 1);
            done = !!st.done || !!st.failed;
          }
        } catch {}
        progress("Reading Marker.io accessibility results", 0, 1);
        try { markerInfo = await post("/api/marker-monitor", { project: projLink }); } catch (e) { markerInfo = { ok: false, error: e.message }; }
        if (markerInfo?.raw) delete markerInfo.raw;
      }

      // Keep only what the checks need, so a 500-page site fits in browser storage.
      const linkSources = Object.fromEntries(Object.keys(w.linkStatus).map((l) => [l, w.linkSources[l]]));
      const linkTexts = Object.fromEntries(Object.keys(w.linkStatus).map((l) => [l, w.linkTexts[l] || ""]));
      const imageSources = Object.fromEntries(Object.keys(w.imageInfo).map((i) => [i, w.imageSources[i]]));
      patch(key, {
        status: "DONE", phase: "", work: null, stopped: false, start: w.startInfo, pages: w.pages, linkStatus: w.linkStatus, linkSources, linkTexts,
        imageInfo: w.imageInfo, imageSources, psi: w.psi, psiError: w.psiError, marker: markerInfo, markerLink: projLink, fontScan: w.fontScan, imageScan: w.imageScan,
        complete: {
          pages: !w.leftover && !w.startInfo.capped && w.pages.every((p) => p.status > 0),
          links: !w.linksLeft && Object.values(w.linkStatus).every((s) => s.status > 0),
          images: w.imgAll <= MAX_IMAGES && Object.keys(w.imageInfo).length === w.imgAll,
          psi: !w.psiError && w.okCount <= MAX_PSI && w.psiList.every((u) => w.psi[u]?.ok),
        },
        scannedAt: new Date().toISOString(),
      });
    } catch (e) {
      // Keep the progress so it can be finished later.
      patch(key, { status: w ? "PAUSED" : "ERROR", work: w, error: `Request failed: ${e.message}` });
    } finally {
      setRunning(null);
      onRunning?.(false);
      refreshSignoffs(key);
    }
  }

  // Rescan only what the unsigned checks need. Falls back to a full rescan when
  // an unsigned check depends on re-reading every page.
  function rescanUnsigned(key) {
    const r = runs[key];
    if (!r || r.status !== "DONE") return runCheck(r?.input || key);
    const signed = signoffs[key] || {};
    const unsigned = forMode(evaluateLaunch(r)).filter((c) => c.state !== "pass" && !signed[c.id]);
    const stages = new Set(unsigned.flatMap((c) => CHECK_STAGES[c.id] || []));
    if (!stages.size) return;
    if (stages.has("pages")) return runCheck(r.input || key);
    return runCheck(r.input || key, undefined, { only: [...stages] });
  }

  // Sites not fully signed off (or not finished scanning), for the tab counter.
  const outstanding = useMemo(() => Object.entries(runs).filter(([key, r]) => {
    if (r.archived) return false;
    if (r.status !== "DONE") return true;
    const signed = signoffs[key] || {};
    return forMode(evaluateLaunch(r)).some((c) => c.state !== "pass" && !signed[c.id]);
  }).length, [runs, signoffs, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onCount?.(outstanding); }, [outstanding, onCount]);

  const list = useMemo(() => Object.entries(runs).filter(([, r]) => !r.archived).sort((a, b) => (b[1].scannedAt || "9").localeCompare(a[1].scannedAt || "9")), [runs]);

  return (
    <div className="rounded-xl border border-zinc-300 bg-white p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (!running && url.trim() && /^https?:\/\//.test(markerLink.trim())) { runCheck(url.trim(), markerLink); setMarkerLink(""); } }} className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => { setUrl(e.target.value); const k = keyFor(e.target.value); if (k) setMarkerLink(load(MARKER_KEY, {})[k] || ""); }} disabled={!!running} placeholder="Website link, e.g. https://www.example.co.uk"
          className="min-w-0 flex-1 basis-64 rounded-md border border-zinc-300 px-3 py-2 text-sm" aria-label="Website to check" />
        <input value={markerLink} onChange={(e) => setMarkerLink(e.target.value)} disabled={!!running} placeholder="Marker.io project link" required
          className="min-w-0 flex-1 basis-64 rounded-md border border-zinc-300 px-3 py-2 text-sm" aria-label="Marker.io project link" />
        {running
          ? <button type="button" onClick={() => { stopRef.current = true; }} className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"><StopIcon /> Stop</button>
          : <button type="submit" disabled={!url.trim() || !/^https?:\/\//.test(markerLink.trim())} title={!/^https?:\/\//.test(markerLink.trim()) ? "Add the Marker.io project link first" : ""} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"><PlayIcon /> Run {mode === "post" ? "post-launch" : "launch"} check</button>}
      </form>
      <p className="mt-2 text-xs text-zinc-500">{mode === "post"
        ? "Once the site is live: SSL certificate, robots.txt allows indexing, CRM Client Card and business emails. The SSL and robots checks are done by the scan."
        : "Checks every page in the sitemap (up to 500), the links and images on them, and runs Google's accessibility audit on every page. Anything the scan can't fully verify needs a person to tick it off. Completed checks drop to the bottom."}</p>

      <div className="mt-4 space-y-3">
        {/* One report at a time: the list shows summaries; opening a site shows just that report. */}
        {openKey && runs[openKey] && !runs[openKey].archived && <button onClick={() => setOpenKey(null)} className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900">← All sites</button>}
        {list.filter(([key]) => !openKey || !runs[openKey] || runs[openKey].archived || key === openKey).map(([key, r]) => (
          <LaunchCard key={key} k={key} r={r} mode={mode} client={clientForSite(clients, key)} signed={signoffs[key] || {}} log={logs[key] || []} shared={shared} team={team} open={openKey === key}
            toggle={() => { if (openKey !== key) refreshSignoffs(key); setOpenKey((o) => (o === key ? null : key)); }} onSign={(check, name, nr) => sign(key, check, name, nr)}
            onRescan={() => runCheck(r.input || key)} onFinish={() => runCheck(r.input || key, undefined, { resume: true })} onRescanUnsigned={() => rescanUnsigned(key)} onRemove={() => archiveRun(key)} busy={!!running} markerReady={markerCreate}
            onSnag={(id, snag) => patch(key, { snags: { ...(r.snags || {}), [id]: snag } })} />
        ))}
        {!list.length && <p className="text-sm text-zinc-500">No {mode === "post" ? "post-launch" : "launch"} checks yet.</p>}
      </div>
    </div>
  );
}

function LaunchCard({ k, r, mode, client, signed, log, shared, team, open, toggle, onSign, onRescan, onFinish, onRescanUnsigned, onRemove, busy, markerReady, onSnag }) {
  const checks = useMemo(() => (r.status === "DONE" ? evaluateLaunch(r).filter((c) => (mode === "post" ? c.section === "Launch actions" : c.section === "Launch checks")) : []), [r, mode]);
  const auto = checks.filter((c) => c.state === "pass").length;
  const signedCount = checks.filter((c) => c.state !== "pass" && signed[c.id]).length;
  const fails = checks.filter((c) => c.state === "fail" && !signed[c.id]).length;
  const todo = checks.filter((c) => c.state !== "pass" && !signed[c.id]).length;
  const [exporting, setExporting] = useState("");
  const marker = r.markerLink || load(MARKER_KEY, {})[k] || "";
  const [showLog, setShowLog] = useState(false);
  const [hideDone, setHideDone] = useState(() => load("flc-launch-hide-done", false));
  const [asking, setAsking] = useState(false);

  async function download(kind) {
    setExporting(kind);
    try {
      const word = kind === "word";
      const slim = checks.map(({ id, section, owner, title, state, summary, items }) => ({ id, section, owner, title, state, summary, items: items.slice(0, 15) }));
      const res = await fetch(word ? "/api/signoff-log" : "/api/export", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(word
          ? { site: k, url: r.start?.finalUrl, scannedAt: r.scannedAt, checks: slim, signed, log, mode }
          : { kind: "launch", launch: { site: k, url: r.start?.finalUrl, scannedAt: r.scannedAt, checks: slim, signed, team: team.map((m) => m.name) } }) });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${mode === "post" ? "post-launch" : "launch"}-sign-off-log-${k}-${new Date().toISOString().slice(0, 10)}.${word ? "docx" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(""); }
  }

  const pct = r.pct ?? (r.total ? Math.min(100, (r.done / r.total) * 100) : 0);
  // Grouped by who does them. Within a group: things to do first, launch-day actions marked.
  const owners = ["Designer", "Developer", "Senior Developer", "Account Manager", "Content"];
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      {/* Header and toolbar stay visible while scrolling through the checks. */}
      <div className={`rounded-t-xl bg-white ${open ? "sticky top-0 z-10 shadow-[0_6px_12px_-8px_rgba(0,0,0,0.25)]" : ""}`}>
      <div className="flex items-start">
        <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
          {r.status === "RUNNING" && <span className="text-blue-600" title="Scanning"><SpinnerIcon className="h-5 w-5" /></span>}
          {r.status === "ERROR" && <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-semibold text-white">COULDN&apos;T CHECK</span>}
          {r.status === "PAUSED" && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">NOT FINISHED</span>}
          <span className="font-medium">{k}</span>
          {client && <span className="text-xs text-zinc-500">{client.name}{client.manager ? ` · AM: ${client.manager}` : ""}</span>}
          <span className="basis-full text-sm text-zinc-600 sm:basis-auto sm:flex-1">
            {r.status === "RUNNING" ? `${r.phase}… ${r.total > 1 ? `${r.done} of ${r.total}` : ""}`
              : r.status === "ERROR" ? r.error
              : r.status === "PAUSED" ? `Stopped part way (${workLeft(r.work)} left). Press Finish scan to carry on from where it got to.${r.error ? ` ${r.error}` : ""}`
              : `${auto} Automatically Signed Off / ${signedCount} Manually Signed Off`}
          </span>
          {/* Remaining count sits on the right. */}
          {r.status === "DONE" && (todo
            ? <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${fails ? "bg-red-600" : "bg-amber-500"}`}>{todo} REMAINING</span>
            : <span className="ml-auto rounded-full bg-green-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">ALL SIGNED OFF</span>)}
          {r.status !== "RUNNING" && <span className="text-zinc-400">{open ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>}
        </button>
        {asking ? (
          <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 text-xs">
            <button onClick={onRemove} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 font-medium text-white"><ArchiveIcon className="h-3.5 w-3.5" /> Archive</button>
            <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100">Keep</button>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} disabled={r.status === "RUNNING"} aria-label={`Archive ${k}`} title="Archive this check" className="shrink-0 px-3 py-3.5 text-zinc-400 hover:text-zinc-900 disabled:opacity-30"><ArchiveIcon /></button>
        )}
      </div>
      {r.status === "RUNNING" && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {open && r.status !== "RUNNING" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-2.5">
            {r.status === "PAUSED" && <button onClick={onFinish} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"><PlayIcon className="h-3.5 w-3.5" /> Finish scan ({workLeft(r.work)} left)</button>}
            {r.status === "DONE" && todo > 0 && todo < checks.length && (
              <button onClick={onRescanUnsigned} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50" title="Re-runs only the parts of the scan the unsigned checks need"><RefreshIcon className="h-3.5 w-3.5" /> Rescan {todo} unsigned check{todo === 1 ? "" : "s"}</button>
            )}
            <button onClick={onRescan} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${r.status === "PAUSED" || (r.status === "DONE" && todo > 0 && todo < checks.length) ? "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100" : "bg-zinc-900 text-white hover:bg-zinc-700"}`}><RefreshIcon className="h-3.5 w-3.5" /> {r.status === "PAUSED" ? "Start again" : "Rescan everything"}</button>
            {r.status === "DONE" && <button onClick={() => download("word")} disabled={!!exporting} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50"><DownloadIcon className="h-3.5 w-3.5" /> {exporting === "word" ? "Building…" : "Download sign-off log (Word)"}</button>}
            {r.status === "DONE" && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                <input type="checkbox" checked={hideDone} onChange={(e) => { setHideDone(e.target.checked); save("flc-launch-hide-done", e.target.checked); }} className="h-3.5 w-3.5" />
                Hide completed ({checks.length - todo})
              </label>
            )}
            {r.scannedAt && <span className="text-[11px] text-zinc-400">Scanned {new Date(r.scannedAt).toLocaleString("en-GB")}{r.stopped ? " (stopped early)" : ""}</span>}
        </div>
      )}
      </div>
      {open && r.status !== "RUNNING" && (
        <div className="border-t border-zinc-100 px-4 py-3">
          {r.status === "DONE" && [...owners, "Automated"].map((who) => {
            // Checks the scan verified itself sit in their own group at the bottom; nobody needs to sign them.
            const mine = checks.filter((c) => (who === "Automated" ? c.state === "pass" : c.owner === who && c.state !== "pass")).map((c, i) => ({ c, i, done: c.state === "pass" || !!signed[c.id] }));
            if (!mine.length) return null;
            const left = mine.filter((x) => !x.done).length;
            return (
              <div key={who} className="mb-4">
                <h3 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {who}
                  <span className={`text-[11px] font-normal ${left ? "text-zinc-500" : "text-green-700"}`}>{who === "Automated" ? `${mine.length} passed automatically` : `${mine.length - left} of ${mine.length} complete`}</span>
                </h3>
                <div className="space-y-2">
                  {mine.filter((x) => !(hideDone && x.done)).sort((a, b) => a.done - b.done || a.i - b.i).map(({ c }) => (
                    <CheckRow key={c.id} c={c} s={signed[c.id]} team={team} client={client} onSign={(name, nr) => onSign(c, name, nr)} marker={marker} markerReady={markerReady} snag={r.snags?.[c.id]} onSnag={(sn) => onSnag(c.id, sn)} site={r.start?.finalUrl || `https://${k}`} />
                  ))}
                </div>
              </div>
            );
          })}
          {r.status === "DONE" && (
            <div className="rounded-lg border border-zinc-200">
              <button onClick={() => setShowLog((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
                <span className="font-semibold">Sign-off log ({log.length + checks.filter((c) => c.state === "pass").length})</span>
                <span className="inline-flex items-center gap-1 text-xs text-zinc-400">{shared ? "Shared with the team" : "Saved in this browser only"} {showLog ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>
              </button>
              {showLog && (
                <table className="w-full border-t border-zinc-100 text-xs">
                  <thead><tr className="text-left text-zinc-500"><th className="px-3 py-1.5">Check</th><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">By</th></tr></thead>
                  <tbody>
                    {[...checks.filter((c) => c.state === "pass").map((c) => ({ at: r.scannedAt, check: c.title, action: "Passed automatically", name: "Automatic" })), ...log].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((e, i) => (
                      <tr key={i} className="border-t border-zinc-100 align-top">
                        <td className="px-3 py-1.5">{e.check}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${/removed/i.test(e.action) ? "text-red-700" : /not required/i.test(e.action) ? "text-zinc-600" : "text-green-700"}`}>
                          {/automatically/i.test(e.action) ? "✓ Automatic" : /removed/i.test(e.action) ? `Removed – ${e.name}` : /not required/i.test(e.action) ? `Not required – ${e.name}` : /changed/i.test(e.action) ? `${e.name} (was ${e.action.replace(/^Changed from /, "")})` : e.name}
                        </td>
                      </tr>
                    ))}
                    {!log.length && <tr><td colSpan={3} className="px-3 py-2 text-zinc-500">No sign-offs yet.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// What is left to do in a paused check, for the Finish button.
function workLeft(w) {
  if (!w) return "nothing";
  if (w.stage === "pages") return `${w.pageQueue?.length || 0} pages`;
  if (w.stage === "links") return `${w.linkList ? w.linkList.length : "the"} links`;
  if (w.stage === "images") return `${w.imgList ? w.imgList.length : "the"} images`;
  if (w.stage === "psi") return `${w.psiQueue ? w.psiQueue.length : "the"} accessibility audits`;
  if (w.stage === "licences") return "the font and image licence checks";
  return "the Marker.io results";
}

// Which team role each check owner maps to (people with that role are listed first).
const OWNER_ROLE = { Designer: "Designer", Developer: "Development", "Senior Developer": "Senior Developer", "Account Manager": "Account Manager", Content: "Content" };

// What the scan found, shown as a short note on rows still needing a person.
const SCAN_NOTE = { fail: "Scan found problems", review: "Scan found things to look at", manual: "Manual check" };

// Snags are raised on the page itself (Marker.io widget / extension): copy the
// text, then open the affected page. One button per finding.
function CheckRow({ c, s, team, client, onSign, site }) {
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const [showList, setShowList] = useState(false);
  async function addSnag(text, pageUrl, idx) {
    try { await navigator.clipboard.writeText(text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(-1), 2000); } catch {}
    if (pageUrl) window.open(pageUrl, "_blank", "noopener");
  }
  const auto = c.state === "pass";
  const done = auto || !!s;
  const role = OWNER_ROLE[c.owner] || "";
  const all = s?.name && !team.some((m) => m.name === s.name) ? [...team, { name: s.name, role: "" }] : team;
  // The client's own account manager goes to the very top of Account Manager checks.
  const am = role === "Account Manager" && client?.manager ? teamMemberForManager(all, client.manager) : null;
  const first = [...(am ? [am] : []), ...all.filter((m) => m.role === role && m !== am)];
  const rest = all.filter((m) => m.role !== role && m !== am);
  const value = s ? `${s.notRequired ? "nr" : "ok"}:${s.name}` : "";
  const change = (v) => { if (!v) return onSign(null); const [kind, ...n] = v.split(":"); onSign(n.join(":"), kind === "nr"); };
  const opt = (m, kind) => <option key={`${kind}:${m.name}`} value={`${kind}:${m.name}`} className="bg-white text-zinc-900">{kind === "nr" ? "Not required" : "✓ Signed off by"} {kind === "nr" ? `– ${m.name}` : m.name}</option>;
  const canSnag = c.state !== "pass" && c.state !== "manual";
  return (
    <div className={`grid gap-3 rounded-lg px-3 py-3 text-sm sm:grid-cols-[1fr_230px] ${done ? (s?.notRequired ? "bg-zinc-100" : "bg-green-50") : "bg-red-50"}`}>
      <div className="min-w-0">
        <p className="font-medium">{c.title}</p>
        {(!done || (s && c.state === "fail")) && (
          <p className="text-[11px]">
            {!done && <span className={`font-semibold ${c.state === "fail" ? "text-red-700" : c.state === "review" ? "text-amber-700" : "text-zinc-600"}`}>{SCAN_NOTE[c.state]}</span>}
            {s && c.state === "fail" && <span className="font-semibold text-red-700">Scan still shows problems</span>}
          </p>
        )}
        {c.facts?.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {c.facts.map((f, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden className={`w-4 shrink-0 text-center font-bold ${f.ok === true ? "text-green-600" : f.ok === false ? "text-red-600" : "text-amber-600"}`}>{f.ok === true ? "✓" : f.ok === false ? "✗" : "?"}</span>
                <span className="sr-only">{f.ok === true ? "Yes:" : f.ok === false ? "No:" : "Unsure:"}</span>
                <span className="text-zinc-700">{f.text}</span>
              </li>
            ))}
          </ul>
        )}
        {c.summary && (
          <p className="mt-0.5 flex gap-1.5 text-xs text-zinc-600">
            {/* A passed check's summary is a tick; otherwise it is information. */}
            {auto
              ? <span aria-hidden className="w-4 shrink-0 text-center font-bold text-green-600">✓</span>
              : <span aria-hidden className={`flex w-4 shrink-0 justify-center pt-0.5 ${c.state === "fail" ? "text-red-600" : c.state === "review" ? "text-amber-600" : "text-zinc-500"}`}><InfoIcon /></span>}
            <span>{c.summary}</span>
          </p>
        )}
        {c.items.length > 0 && (
          <button onClick={() => setShowList((v) => !v)} aria-expanded={showList} className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100">
            {showList ? <><ChevronUpIcon className="h-3.5 w-3.5" /> Hide {c.items.length === 1 ? "detail" : `${c.items.length} details`}</> : <><ChevronDownIcon className="h-3.5 w-3.5" /> Show {c.items.length === 1 ? "detail" : `${c.items.length} details`}</>}
          </button>
        )}
        {c.links.length > 0 && <p className="mt-1 text-xs">{c.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="mr-3 inline-flex items-center gap-1 text-blue-700 underline">{l.text} <ExternalIcon /></a>)}</p>}
        {c.items.length > 0 && showList && (
          <ol className="mt-1.5 list-decimal space-y-1.5 rounded bg-white/70 py-2 pl-7 pr-2 text-[11px] text-zinc-700">
            {c.items.map((i, n) => (
              <li key={n} className="break-words pl-1">
                {i.img && (
                  <a href={i.img} target="_blank" rel="noreferrer" className="mr-2 inline-block align-middle">
                    {/* Thumbnail of the client's image; plain <img> on purpose (external, unoptimised). */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/thumb?u=${encodeURIComponent(i.img)}`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="h-10 w-14 rounded border border-zinc-200 bg-white object-cover" />
                  </a>
                )}
                {i.href ? <a href={i.href} target="_blank" rel="noreferrer" className="hover:underline">{i.text}</a> : i.text}
                {i.href && !/marker\.io/.test(i.href) && canSnag && (
                  <button onClick={() => addSnag(i.snag || i.text.replace(/\s+–\s+\/\S*$/, "").replace(/ on (the )?(".*?" page|the page \/\S*)/, ""), i.href, n)} className="ml-2 inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-0 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100" title="Copies this finding and opens the page so you can add the snag with Marker.io">
                    {copiedIdx === n ? <><CheckIcon className="h-3 w-3" /> Copied – add it on the page</> : <><FlagIcon className="h-3 w-3" /> Add Snag to Marker</>}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {canSnag && !c.items.length && c.facts?.some((f) => f.ok === false) && (
          <button onClick={() => addSnag(c.facts.filter((f) => f.ok === false).map((f) => f.text).join("\n"), site, 99)} className="mt-1.5 inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100">
            {copiedIdx === 99 ? <><CheckIcon className="h-3 w-3" /> Copied – add it on the page</> : <><FlagIcon className="h-3 w-3" /> Add Snag to Marker</>}
          </button>
        )}
      </div>
      <div className="text-xs">
        {auto ? (
          <span className="inline-flex w-full items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 font-semibold text-white"><CheckIcon className="h-3.5 w-3.5" /> Passed automatically</span>
        ) : (
          <>
            {/* One control: pick a name to sign off, or mark it not required; "Not checked" removes it. */}
            <select value={value} onChange={(e) => change(e.target.value)} aria-label={`Signed off by, ${c.title}`}
              className={`w-full cursor-pointer rounded-full border-0 px-3 py-1.5 font-semibold text-white ${s ? (s.notRequired ? "bg-zinc-500" : "bg-green-600") : "bg-red-600"}`}>
              <option value="" className="bg-white text-zinc-900">Not signed off</option>
              {/* People with the matching role: sign off or mark not required. Everyone else: sign off only. */}
              {first.length > 0 && <optgroup label={role} className="bg-white text-zinc-900">{first.map((m) => opt(m, "ok"))}{first.map((m) => opt(m, "nr"))}</optgroup>}
              {rest.length > 0 && <optgroup label={first.length ? "Everyone else" : "Team"} className="bg-white text-zinc-900">{rest.map((m) => opt(m, "ok"))}{!first.length && rest.map((m) => opt(m, "nr"))}</optgroup>}
            </select>
            {s && <p className="mt-1 px-1 text-[11px] text-zinc-600">{s.notRequired ? "Not required · " : ""}{new Date(s.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
