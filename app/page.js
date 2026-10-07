"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pullSetting, pushSetting } from "@/app/shared";
import { PlayIcon, StopIcon, RefreshIcon, DownloadIcon, TrashIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon, SpinnerIcon } from "@/app/icons";
import LaunchArea from "@/app/launch";
import { DEFAULT_SITES } from "@/data/sites";
import { loadClients } from "@/app/clients";
import { scanFonts as scanFontsShared, scanImages as scanImagesShared } from "@/app/scans";
import { clientForSite, normaliseClients } from "@/lib/clients";
import { buildFontEmail, buildImageEmail, isFreeLib, segmentsToText, segmentsToHtml } from "@/lib/email";
import { fontLink, isEmbeddedIconFont, fixedFix, issueLabel, freeRouteLink, isFreeFontAwesome, ISSUE_TONE, mergeImageSizes, creditOnly, imageAdminLink, stockLibraryLink, stockLicenceSignal, imageKey, isFontFixed, isImageFixed } from "@/lib/fontlink";

const ORDER = { PROBLEM: 4, CHECK: 3, UNREACHABLE: 2, OK: 1, SYSTEM: 0 };
const LABEL = { PROBLEM: "PROBLEM", CHECK: "CHECK", UNREACHABLE: "COULDN'T CHECK", OK: "OK", SYSTEM: "NO WEB FONTS", RUNNING: "SCANNING" };
const COLOUR = {
  PROBLEM: { text: "text-red-700", bg: "bg-red-50", border: "border-red-500", chip: "bg-red-600" },
  CHECK: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-500", chip: "bg-amber-500" },
  UNREACHABLE: { text: "text-purple-700", bg: "bg-purple-50", border: "border-purple-500", chip: "bg-purple-600" },
  OK: { text: "text-green-700", bg: "bg-green-50", border: "border-green-500", chip: "bg-green-600" },
  SYSTEM: { text: "text-zinc-500", bg: "bg-zinc-100", border: "border-zinc-400", chip: "bg-zinc-500" },
  PENDING: { text: "text-zinc-400", bg: "bg-white", border: "border-zinc-200", chip: "bg-zinc-300" },
  RUNNING: { text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-400", chip: "bg-blue-500" },
  PAID: { text: "text-red-700", bg: "bg-red-50", border: "border-red-500", chip: "bg-red-600" },
};
const STORAGE_KEY = "flc-results-v2";
const AREA_FIELDS_STATIC = {
  fonts: ["status", "fonts", "ignoredFonts", "error", "fix", "platform", "cssCount", "fontPages", "seconds", "fontsScannedAt", "fixedFonts", "fixedFontsAt"],
  images: ["imgStatus", "images", "imgError", "imgFix", "imgProgress", "imgDone", "imgTotal", "imagesChecked", "pagesScanned", "pagesTotal", "hasSitemap", "imagesScannedAt", "fixedImages", "fixedImagesAt"],
};

function normalise(s) {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
// Paid-library images still to deal with (fixed ones excluded) and the fixed ones.
function paidImages(r) {
  return mergeImageSizes((r.images || []).filter((i) => i.flag && !isFreeLib(i.flag) && !isImageFixed(r, i)));
}
function fixedImagesOf(r) {
  return mergeImageSizes((r.images || []).filter((i) => i.flag && !isFreeLib(i.flag) && isImageFixed(r, i)));
}
// Fonts still needing attention on a site (fixed ones excluded) and the fixed ones.
const needsWork = (f) => (f.status === "PROBLEM" || f.status === "CHECK") && !isEmbeddedIconFont(f) && !isFreeFontAwesome(f);
function fontTodo(r) { return (r.fonts || []).filter((f) => needsWork(f) && !isFontFixed(r, f)); }
function fontFixedList(r) { return (r.fonts || []).filter((f) => needsWork(f) && isFontFixed(r, f)); }
// A site whose every font issue is marked fixed counts as fine.
function effectiveFontStatus(r) {
  if ((r.status === "PROBLEM" || r.status === "CHECK") && (r.fonts || []).some(needsWork) && !fontTodo(r).length) return "OK";
  return r.status;
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_SITES.join("\n"));
  const [parallel, setParallel] = useState(4);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null); // null | "fonts" | "images"
  const [launchRunning, setLaunchRunning] = useState(false);
  const [postRunning, setPostRunning] = useState(false);
  const [launchCount, setLaunchCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [area, setAreaState] = useState("launch"); // "launch" | "post" | "fonts" | "images"
  const TAB_SLUG = { fonts: "fonts", images: "images", launch: "launch", post: "post-launch" };
  const setArea = (id) => {
    setAreaState(id);
    try { const u = new URL(window.location.href); u.searchParams.set("tab", TAB_SLUG[id]); const sel = selected[id]; if (sel) u.searchParams.set("site", sel); else u.searchParams.delete("site"); window.history.replaceState(null, "", u.search); } catch {}
  };
  // One report page per site: which site is open in each area (null = the list).
  const [selected, setSelected] = useState({ fonts: null, images: null });
  const selectSite = (kind, site) => {
    setSelected((o) => ({ ...o, [kind]: site }));
    try { const u = new URL(window.location.href); if (site) u.searchParams.set("site", site); else u.searchParams.delete("site"); window.history.replaceState(null, "", u.search); } catch {}
  };
  const [filter, setFilter] = useState("ALL");
  // Extra filters for the site lists: text search, account manager, issue type / library, fixed state.
  const [ff, setFf] = useState({ q: "", manager: "", issue: "", fixed: "" }); // fonts
  const [imf, setImf] = useState({ q: "", manager: "", lib: "", licence: "", fixed: "" }); // images
  const managerOf = (site) => clientForSite(clients, site)?.manager || "";
  const [open, setOpen] = useState({});
  const [exporting, setExporting] = useState("");
  const [showList, setShowList] = useState(true);
  const [imgFilter, setImgFilter] = useState("ALL"); // "ALL" | "PAID" | "UNREACHABLE" | "FINE"
  const showFontFine = filter === "FINE";
  const showImgFine = imgFilter === "FINE";
  const [clients, setClients] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => setClients(loadClients()), 0);
    pullSetting("email-edits", EDITS_KEY); // team's edited email wording
    fetch("/api/clients").then((r) => r.json()).then((j) => { if (j.shared && Array.isArray(j.clients) && j.clients.length) setClients(normaliseClients(j.clients)); }).catch(() => {});
    return () => clearTimeout(t);
  }, []);
  const stopRef = useRef(false);
  const cancelledRef = useRef(new Set());
  const router = useRouter();

  // Each tab has its own URL (?tab=…), so links to a tab can be shared.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = Object.keys(TAB_SLUG).find((k) => TAB_SLUG[k] === q.get("tab"));
    const site = q.get("site");
    setTimeout(() => { if (id) setAreaState(id); if (id && site && (id === "fonts" || id === "images")) setSelected((o) => ({ ...o, [id]: site })); }, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    if (!saved?.results) return;
    // Nothing is scanning straight after a page load, so any "running" result
    // was cut off by a reload or closed tab. Mark it as interrupted.
    for (const r of Object.values(saved.results)) {
      if (r.status === "RUNNING") Object.assign(r, { status: "UNREACHABLE", error: "Scan was interrupted (page reloaded or closed). Press Re-scan." });
      if (r.imgStatus === "RUNNING") Object.assign(r, { imgStatus: "UNREACHABLE", imgProgress: undefined,
        imgError: `Scan was interrupted${r.imgTotal || r.imgProgress ? ` at ${r.imgProgress || `page ${r.imgDone} of ${r.imgTotal}`}` : ""} (page reloaded or closed). Re-scan this site.`,
        imgFix: "Open the site and press Re-scan, or run the images check again." });
    }
    const t = setTimeout(() => {
      setResults(saved.results);
      if (saved.text) setText(saved.text);
      setShowList(false);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      if (Object.keys(results).length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ results, text }));
    } catch {}
  }, [results, text]);

  // Shared results (when storage is set up): pull everyone's on load, push each
  // site's result when its scan finishes, so the whole team sees the same lists.
  const sharedRef = useRef(false);
  const syncedRef = useRef({}); // site -> { fontsScannedAt, imagesScannedAt } already pushed
  const SHARED_FIELDS = { fonts: AREA_FIELDS_STATIC.fonts, images: AREA_FIELDS_STATIC.images };
  useEffect(() => {
    (async () => {
      try {
        const [f, i] = await Promise.all(["fonts", "images"].map((k) => fetch(`/api/results?kind=${k}`).then((r) => r.json())));
        if (!f.shared && !i.shared) return;
        sharedRef.current = true;
        setResults((prev) => {
          const next = { ...prev };
          const sitesSeen = new Set();
          for (const [kind, res] of [["fonts", f.results || {}], ["images", i.results || {}]]) {
            for (const [site, data] of Object.entries(res)) {
              sitesSeen.add(site);
              const cur = next[site] || { site };
              const stamp = kind === "fonts" ? "fontsScannedAt" : "imagesScannedAt";
              if (!cur[stamp] || String(data[stamp] || "") > String(cur[stamp])) {
                next[site] = { ...cur, ...data, site };
                syncedRef.current[site] = { ...(syncedRef.current[site] || {}), [stamp]: data[stamp] };
              }
            }
          }
          if (sitesSeen.size) setShowList(false);
          return next;
        });
        setText((t) => { const have = new Set(t.split(/\r?\n/).map(normalise)); const add = [...new Set([...Object.keys(f.results || {}), ...Object.keys(i.results || {})])].filter((s) => !have.has(s)); return add.length ? `${t.trim()}\n${add.join("\n")}`.trim() : t; });
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (!sharedRef.current) return;
    for (const [site, r] of Object.entries(results)) {
      const done = syncedRef.current[site] || {};
      for (const [kind, stamp] of [["fonts", "fontsScannedAt"], ["images", "imagesScannedAt"]]) {
        const fixedStamp = kind === "fonts" ? "fixedFontsAt" : "fixedImagesAt";
        const mark = `${r[stamp]}|${r[fixedStamp] || ""}`;
        if (r[stamp] && mark !== done[stamp] && r.status !== "RUNNING" && r.imgStatus !== "RUNNING") {
          syncedRef.current[site] = { ...done, [stamp]: mark };
          const data = Object.fromEntries(SHARED_FIELDS[kind].concat(["finalUrl"]).filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
          data[stamp] = r[stamp];
          fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, site, data }) }).catch(() => {});
        }
      }
    }
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before closing or reloading while a scan is in progress.
  useEffect(() => {
    if (!running && !launchRunning && !postRunning) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, launchRunning, postRunning]);

  const sites = useMemo(() => [...new Set(text.split(/\r?\n|,/).map(normalise).filter((s) => s.includes(".")))], [text]);

  const patch = (site, fields) => {
    if (cancelledRef.current.has(site)) return;
    setResults((prev) => ({ ...prev, [site]: { ...(prev[site] || { site }), ...fields } }));
  };

  // "Mark as fixed": one font, one image, or everything outstanding on a site.
  const now = () => new Date().toISOString();
  function setFontFixed(site, families, on) {
    setResults((prev) => {
      const r = prev[site]; if (!r) return prev;
      const fixed = { ...(r.fixedFonts || {}) };
      for (const fam of families) { if (on) fixed[fam] = now(); else delete fixed[fam]; }
      return { ...prev, [site]: { ...r, fixedFonts: fixed, fixedFontsAt: now() } };
    });
  }
  function setImageFixed(site, keys, on) {
    setResults((prev) => {
      const r = prev[site]; if (!r) return prev;
      const fixed = { ...(r.fixedImages || {}) };
      for (const k of keys) { if (on) fixed[k] = now(); else delete fixed[k]; }
      return { ...prev, [site]: { ...r, fixedImages: fixed, fixedImagesAt: now() } };
    });
  }

  // Cancel any scan for this site, drop its results and take it off the site list.
  function removeSite(site) {
    cancelledRef.current.add(site);
    setResults((prev) => { const next = { ...prev }; delete next[site]; return next; });
    if (sharedRef.current) for (const kind of ["fonts", "images"]) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, site }) }).catch(() => {});
    setText((t) => t.split(/\r?\n/).filter((l) => normalise(l) !== site).join("\n"));
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { stopRef.current = true; router.push("/login"); throw new Error("Signed out"); }
    return r.json();
  }

  // Font and image scans live in app/scans.js (shared with the launch checks).
  const scanFonts = (site) => scanFontsShared(post, site, (f) => patch(site, f));
  const scanImages = (site) => scanImagesShared(post, site, (f) => patch(site, f), () => stopRef.current || cancelledRef.current.has(site));

  async function run(kind, list) {
    cancelledRef.current = new Set();
    stopRef.current = false;
    setRunning(kind);
    setShowList(false);
    setArea(kind);
    const queue = [...list];
    const fn = kind === "fonts" ? scanFonts : scanImages;
    const workers = Array.from({ length: Math.max(1, parallel) }, async () => {
      while (queue.length && !stopRef.current) {
        const next = queue.shift();
        if (!cancelledRef.current.has(next)) await fn(next);
      }
    });
    await Promise.all(workers);
    setRunning(null);
  }
  function stop() { stopRef.current = true; }
  // Clear one area's results only; the other area's results stay.
  const AREA_FIELDS = AREA_FIELDS_STATIC;
  function clearArea(kind) {
    if (sharedRef.current) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) }).catch(() => {});
    for (const site of Object.keys(syncedRef.current)) delete syncedRef.current[site][kind === "fonts" ? "fontsScannedAt" : "imagesScannedAt"];
    setResults((prev) => {
      const next = {};
      for (const [site, r] of Object.entries(prev)) {
        const kept = { ...r };
        for (const k of AREA_FIELDS[kind]) delete kept[k];
        if (kept.status || kept.imgStatus) next[site] = kept;
      }
      if (!Object.keys(next).length) { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
      return next;
    });
    setOpen({});
    if (kind === "fonts") setFilter("ALL");
  }

  async function exportXlsx(kind) {
    setExporting(kind);
    try {
      const r = await fetch("/api/export", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: Object.values(results), kind }),
      });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${kind === "images" ? "stock-image" : "font"}-licence-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting("");
    }
  }

  const all = useMemo(() => Object.values(results), [results]);

  // Fonts view
  const fontRows = useMemo(() => all.filter((r) => r.status).map((r) => ({ ...r, status: effectiveFontStatus(r) })).sort((a, b) => (ORDER[b.status] ?? -1) - (ORDER[a.status] ?? -1) || a.site.localeCompare(b.site)), [all]);
  const fontCounts = useMemo(() => {
    const c = { PROBLEM: 0, CHECK: 0, UNREACHABLE: 0, OK: 0, SYSTEM: 0, RUNNING: 0 };
    for (const r of fontRows) if (c[r.status] != null) c[r.status]++;
    return c;
  }, [fontRows]);
  const fontDone = fontRows.filter((r) => r.status !== "RUNNING").length;
  const fontTotal = Math.max(sites.length, fontRows.length);
  const fontFine = fontCounts.OK + fontCounts.SYSTEM;
  // Green (free fixes) first, then amber, then red; couldn't-check sites last.
  const toneOrder = (r) => {
    if (r.status === "RUNNING") return -1;
    const tones = fontTodo(r).map((f) => ISSUE_TONE[issueLabel(f)]);
    if (!tones.length) return 4;
    return Math.max(...tones.map((t) => TONE_RANK[t] || 0));
  };
  // Among sites with the same worst issue, those that also have a green (free fix) pill come first.
  const hasGreen = (r) => fontTodo(r).some((f) => ISSUE_TONE[issueLabel(f)] === "green") ? 0 : 1;
  const managers = [...new Set(clients.map((c) => c.manager).filter(Boolean))].sort();
  const fontIssues = [...new Set(fontRows.flatMap((r) => fontTodo(r).map(issueLabel)))].sort();
  const fontVisible = fontRows.filter((r) => r.status !== "OK" && r.status !== "SYSTEM" && (filter === "ALL" || r.status === filter) && filter !== "FINE")
    .filter((r) => !ff.q || r.site.includes(ff.q.toLowerCase()) || (clientForSite(clients, r.site)?.name || "").toLowerCase().includes(ff.q.toLowerCase()) || fontTodo(r).some((f) => f.family.toLowerCase().includes(ff.q.toLowerCase())))
    .filter((r) => !ff.manager || (ff.manager === "__none" ? !managerOf(r.site) : managerOf(r.site) === ff.manager))
    .filter((r) => !ff.issue || fontTodo(r).some((f) => issueLabel(f) === ff.issue))
    .filter((r) => !ff.fixed || (ff.fixed === "some" ? fontFixedList(r).length > 0 : fontFixedList(r).length === 0))
    .sort((a, b) => toneOrder(a) - toneOrder(b) || hasGreen(a) - hasGreen(b) || a.site.localeCompare(b.site));

  // Images view
  const imgRows = useMemo(() => all.filter((r) => r.imgStatus).map((r) => ({ r, paid: paidImages(r) }))
    .sort((a, b) => (b.r.imgStatus === "RUNNING") - (a.r.imgStatus === "RUNNING") || b.paid.length - a.paid.length || a.r.site.localeCompare(b.r.site)), [all]);
  const imgDone = imgRows.filter((x) => x.r.imgStatus !== "RUNNING").length;
  const imgTotal = Math.max(sites.length, imgRows.length);
  const imgPaidSites = imgRows.filter((x) => x.paid.length).length;
  const imgUnreachable = imgRows.filter((x) => x.r.imgStatus === "UNREACHABLE").length;
  const imgFine = imgRows.filter((x) => x.r.imgStatus === "DONE" && !x.paid.length).length;
  const imgLibs = [...new Set(imgRows.flatMap((x) => x.paid.map((i) => i.flag)))].sort();
  const imgVisible = imgRows.filter((x) => x.paid.length || x.r.imgStatus !== "DONE")
    .filter((x) => imgFilter === "ALL" || (imgFilter === "PAID" ? x.paid.length > 0 : imgFilter === "UNREACHABLE" ? x.r.imgStatus === "UNREACHABLE" : false))
    .filter((x) => !imf.q || x.r.site.includes(imf.q.toLowerCase()) || (clientForSite(clients, x.r.site)?.name || "").toLowerCase().includes(imf.q.toLowerCase()))
    .filter((x) => !imf.manager || (imf.manager === "__none" ? !managerOf(x.r.site) : managerOf(x.r.site) === imf.manager))
    .filter((x) => !imf.lib || x.paid.some((i) => i.flag === imf.lib))
    .filter((x) => !imf.licence || x.paid.some((i) => stockLicenceSignal(i).status === imf.licence))
    .filter((x) => !imf.fixed || (imf.fixed === "some" ? fixedImagesOf(x.r).length > 0 : fixedImagesOf(x.r).length === 0));

  const fontEmails = all.map((r) => buildFontEmail(r, clientForSite(clients, r.site))).filter(Boolean).sort((a, b) => a.site.localeCompare(b.site));
  const imageEmails = all.map((r) => buildImageEmail(r, clientForSite(clients, r.site))).filter(Boolean).sort((a, b) => a.site.localeCompare(b.site));
  // The site whose report page is open (if any) in each area.
  const selFont = selected.fonts ? fontRows.find((x) => x.site === selected.fonts) : null;
  const selFontEmail = selFont ? fontEmails.find((x) => x.site === selFont.site) : null;
  const selImg = selected.images ? imgRows.find((x) => x.r.site === selected.images) : null;
  const selImgEmail = selImg ? imageEmails.find((x) => x.site === selImg.r.site) : null;

  // Only one accordion open at a time.

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Website Checker</h1>
        <Link href="/settings" aria-label="Settings" title="Settings" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Link>
      </header>

      <nav className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-xl bg-zinc-200/70 p-1 sm:inline-grid sm:w-auto" aria-label="Licence area">
        {[["launch", "Launch Checks", launchCount || null],
          ["post", "Post Launch Checks", postCount || null],
          ["fonts", "Font Licenses", fontRows.length ? fontCounts.PROBLEM + fontCounts.CHECK : null],
          ["images", "Image Licenses", imgRows.length ? imgPaidSites : null]].map(([id, label, n]) => (
          <button key={id} onClick={() => setArea(id)} aria-current={area === id ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${area === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>
            {label}{n != null && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{n}</span>}
            {(running === id || (id === "launch" && launchRunning) || (id === "post" && postRunning)) && <span className="ml-2 inline-block align-middle text-blue-600" title="Scanning"><SpinnerIcon /></span>}
          </button>
        ))}
      </nav>

      {/* All areas stay mounted so a running scan carries on when you switch tabs. */}
      <section className={`mt-5 ${area === "launch" ? "" : "hidden"}`}><LaunchArea post={post} mode="launch" onRunning={setLaunchRunning} onCount={setLaunchCount} onSiteResult={patch} siteResults={results} /></section>
      <section className={`mt-5 ${area === "post" ? "" : "hidden"}`}><LaunchArea post={post} mode="post" onRunning={setPostRunning} onCount={setPostCount} onSiteResult={patch} siteResults={results} /></section>

      <div className={area !== "launch" && area !== "post" ? "" : "hidden"}>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <button onClick={() => setShowList((v) => !v)} className="flex w-full items-center justify-between text-left text-sm font-medium">
          <span>Sites to check ({sites.length})</span>
          <span className="text-zinc-400">{showList ? "Hide" : "Show"}</span>
        </button>
        {showList && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
            <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!!running} rows={10} spellCheck={false}
              className="w-full rounded-md border border-zinc-300 p-2 font-mono text-xs" placeholder="one domain per line" />
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-zinc-600">Sites at once</span>
                <input type="number" min={1} max={8} value={parallel} onChange={(e) => setParallel(Number(e.target.value))} disabled={!!running} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1" />
                <span className="text-xs text-zinc-400">4 is a good default.</span>
              </label>
              <button onClick={() => setText(DEFAULT_SITES.join("\n"))} disabled={!!running} className="text-xs text-zinc-500 underline">Reset to default list</button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4">
        {area === "fonts" && (
          <div className="rounded-xl border border-zinc-300 bg-white p-4">
            <AreaBar kind="fonts" done={fontDone} total={fontTotal} label={fontRows.length ? "Rescan fonts" : "Run fonts check"} running={running} sites={sites}
              onRun={() => run("fonts", sites)} onStop={stop} onClear={fontRows.length ? () => clearArea("fonts") : null}
              retry={{ sites: fontRows.filter((r) => r.status === "UNREACHABLE").map((r) => r.site), onClick: () => run("fonts", fontRows.filter((r) => r.status === "UNREACHABLE").map((r) => r.site)) }}
              download={fontRows.length ? { label: "Download font tracker (Excel)", busy: exporting === "fonts", onClick: () => exportXlsx("fonts") } : null} />
            {selFont ? (
              <SiteReport onBack={() => selectSite("fonts", null)}
                main={<SiteCard r={selFont} open toggle={() => selectSite("fonts", null)} rerun={() => run("fonts", [selFont.site])} running={!!running} onRemove={() => { removeSite(selFont.site); selectSite("fonts", null); }} onFixed={(fams, on) => setFontFixed(selFont.site, fams, on)} />}
                aside={selFontEmail ? <EmailCard e={selFontEmail} result={results[selFont.site]} client={clientForSite(clients, selFont.site)} open toggle={() => {}} /> : null} />
            ) : (<>
            {fontRows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {["PROBLEM", "CHECK", "UNREACHABLE"].map((s) => (
                    <button key={s} onClick={() => setFilter(filter === s ? "ALL" : s)}
                      className={`rounded-xl border p-3 text-left ${COLOUR[s].bg} ${filter === s ? COLOUR[s].border : "border-transparent"}`}>
                      <div className={`text-3xl font-semibold ${COLOUR[s].text}`}>{fontCounts[s]}</div>
                      <div className={`text-xs font-medium ${COLOUR[s].text}`}>{LABEL[s]}</div>
                      <div className="mt-1 text-[11px] leading-tight text-zinc-500">
                        {s === "PROBLEM" && "Paid, demo, Font Awesome Pro or no licence info"}
                        {s === "CHECK" && "Hosted subscription to confirm"}
                        {s === "UNREACHABLE" && "Site down, blocking the scanner, or timed out"}
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setFilter(showFontFine ? "ALL" : "FINE")} aria-pressed={showFontFine} className={`rounded-xl border p-3 text-left ${COLOUR.OK.bg} ${showFontFine ? COLOUR.OK.border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.OK.text}`}>{fontFine}</div>
                    <div className={`text-xs font-medium ${COLOUR.OK.text}`}>FINE</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">Google Fonts, Adobe Fonts kits, open licence or system fonts only.</div>
                  </button>
                </div>
                {showFontFine && (
                  <ul className="mt-3 grid gap-x-6 gap-y-1 rounded-lg border border-green-200 bg-green-50 p-3 text-xs sm:grid-cols-2">
                    {fontRows.filter((r) => r.status === "OK" || r.status === "SYSTEM").map((r) => {
                      const f = [...new Set((r.fonts || []).filter((x) => x.status === "OK").map((x) => x.family))];
                      const fixed = fontFixedList(r).length;
                      return (
                        <li key={r.site} className="min-w-0">
                          <a href={r.finalUrl || `https://${r.site}`} target="_blank" rel="noreferrer" className="font-medium text-green-800 underline">{r.site}</a>
                          <span className="text-zinc-500"> · {fixed ? `${fixed} fixed${f.length ? `, ${f.join(", ")}` : ""}` : f.length ? f.join(", ") : "System fonts only"}</span>
                          {fixed > 0 && <button onClick={() => setFontFixed(r.site, fontFixedList(r).map((x) => x.family), false)} className="ml-2 text-[11px] text-green-700 underline">undo fixes</button>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <FilterBar value={ff} onChange={setFf} count={fontVisible.length} managers={managers} fields={[
                  { key: "issue", label: "All issues", options: fontIssues },
                  { key: "fixed", label: "Fixed or not", options: [["some", "Has fixed items"], ["none", "Nothing fixed yet"]] },
                ]} />
                <div className="mt-3 space-y-3">
                  {fontVisible.map((r) => (
                    <SiteCard key={r.site} r={r} open={false} toggle={() => selectSite("fonts", r.site)} rerun={() => run("fonts", [r.site])} running={!!running} onRemove={() => removeSite(r.site)} onFixed={(fams, on) => setFontFixed(r.site, fams, on)} />
                  ))}
                  {!fontVisible.length && filter !== "FINE" && <p className="text-sm text-zinc-500">{filter === "ALL" ? "Nothing outstanding." : "Nothing in this group."}</p>}
                </div>
              </>
            )}
            </>)}
          </div>
        )}

        {area === "images" && (
          <div className="rounded-xl border border-zinc-300 bg-white p-4">
            <AreaBar kind="images" done={imgDone} total={imgTotal} label={imgRows.length ? "Rescan images" : "Run images check"} running={running} sites={sites}
              onRun={() => run("images", sites)} onStop={stop} onClear={imgRows.length ? () => clearArea("images") : null}
              retry={{ sites: imgRows.filter((x) => x.r.imgStatus === "UNREACHABLE").map((x) => x.r.site), onClick: () => run("images", imgRows.filter((x) => x.r.imgStatus === "UNREACHABLE").map((x) => x.r.site)) }}
              download={imgRows.length ? { label: "Download stock image tracker (Excel)", busy: exporting === "images", onClick: () => exportXlsx("images") } : null} />
            {selImg ? (
              <SiteReport onBack={() => selectSite("images", null)}
                main={<ImageCard r={selImg.r} paid={selImg.paid} open toggle={() => selectSite("images", null)} rerun={() => run("images", [selImg.r.site])} running={!!running} onRemove={() => { removeSite(selImg.r.site); selectSite("images", null); }} onFixed={(keys, on) => setImageFixed(selImg.r.site, keys, on)} />}
                aside={selImgEmail ? <EmailCard e={selImgEmail} result={results[selImg.r.site]} client={clientForSite(clients, selImg.r.site)} open toggle={() => {}} /> : null} />
            ) : (<>
            {imgRows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <button onClick={() => setImgFilter(imgFilter === "PAID" ? "ALL" : "PAID")} aria-pressed={imgFilter === "PAID"} className={`rounded-xl border p-3 text-left ${COLOUR.PAID.bg} ${imgFilter === "PAID" ? COLOUR.PAID.border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.PAID.text}`}>{imgPaidSites}</div>
                    <div className={`text-xs font-medium ${COLOUR.PAID.text}`}>Sites with paid-library images</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">Shutterstock, iStock, Getty, Adobe Stock… find the licence or replace</div>
                  </button>
                  <button onClick={() => setImgFilter(imgFilter === "UNREACHABLE" ? "ALL" : "UNREACHABLE")} aria-pressed={imgFilter === "UNREACHABLE"} className={`rounded-xl border p-3 text-left ${COLOUR.UNREACHABLE.bg} ${imgFilter === "UNREACHABLE" ? COLOUR.UNREACHABLE.border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.UNREACHABLE.text}`}>{imgUnreachable}</div>
                    <div className={`text-xs font-medium ${COLOUR.UNREACHABLE.text}`}>COULDN&apos;T CHECK</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">Site down, blocking the scanner, or timed out</div>
                  </button>
                  <button onClick={() => setImgFilter(showImgFine ? "ALL" : "FINE")} aria-pressed={showImgFine} className={`rounded-xl border p-3 text-left ${COLOUR.OK.bg} ${showImgFine ? COLOUR.OK.border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.OK.text}`}>{imgFine}</div>
                    <div className={`text-xs font-medium ${COLOUR.OK.text}`}>FINE</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">No paid stock-library images (free libraries like Unsplash and Pexels need no licence).</div>
                  </button>
                </div>
                {showImgFine && (
                  <ul className="mt-3 grid gap-x-6 gap-y-1 rounded-lg border border-green-200 bg-green-50 p-3 text-xs sm:grid-cols-2">
                    {imgRows.filter((x) => x.r.imgStatus === "DONE" && !x.paid.length).map(({ r }) => {
                      const free = (r.images || []).filter((i) => i.flag && isFreeLib(i.flag)).length;
                      return (
                        <li key={r.site} className="min-w-0">
                          <a href={r.finalUrl || `https://${r.site}`} target="_blank" rel="noreferrer" className="font-medium text-green-800 underline">{r.site}</a>
                          <span className="text-zinc-500"> · {fixedImagesOf(r).length ? `${fixedImagesOf(r).length} fixed, ` : ""}{r.pagesScanned || 0} pages, {r.imagesChecked || 0} images checked{free ? `, ${free} from free libraries` : ""}</span>
                          {fixedImagesOf(r).length > 0 && <button onClick={() => setImageFixed(r.site, fixedImagesOf(r).map((i) => imageKey(i.url, i.flag)), false)} className="ml-2 text-[11px] text-green-700 underline">undo fixes</button>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-1 text-xs text-zinc-500">Flags come from file names (e.g. shutterstock_123.jpg) and embedded copyright / credit tags. The scanner cannot tell whether an image was paid for, so treat this as a list to check against purchase records.</p>
                <FilterBar value={imf} onChange={setImf} count={imgVisible.length} managers={managers} fields={[
                  { key: "lib", label: "All libraries", options: imgLibs },
                  { key: "licence", label: "Any licence check", options: ["Likely licensed", "Possible preview", "Could not check"] },
                  { key: "fixed", label: "Fixed or not", options: [["some", "Has fixed items"], ["none", "Nothing fixed yet"]] },
                ]} />
                <div className="mt-3 space-y-3">
                  {imgVisible.map(({ r, paid }) => (
                    <ImageCard key={r.site} r={r} paid={paid} open={false} toggle={() => selectSite("images", r.site)} rerun={() => run("images", [r.site])} running={!!running} onRemove={() => removeSite(r.site)} onFixed={(keys, on) => setImageFixed(r.site, keys, on)} />
                  ))}
                  {!imgVisible.length && imgFilter !== "FINE" && <p className="text-sm text-zinc-500">{imgFilter === "ALL" ? "No paid stock-library images found on any scanned site." : "Nothing in this group."}</p>}
                </div>
              </>
            )}
            </>)}
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs text-zinc-400">
        <p>PROBLEM means investigate, not guilty. Fonts loaded only by JavaScript can be missed. Image flags are filename and metadata only; cross-check against purchase records.</p>
      </footer>
      </div>
    </main>
  );
}

function Badge({ ok, bad, label }) {
  return <span className={`rounded px-1.5 py-0.5 font-semibold ${ok ? "bg-green-100 text-green-800" : bad ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-600"}`}>{label}</span>;
}

function FaIconTable({ icons, pages, version, site }) {
  const change = icons.filter((i) => !i.free);
  const [showFree, setShowFree] = useState(false);
  const shown = showFree ? icons : change;
  const pageLink = (p) => { try { return new URL(p, site || "https://x").href; } catch { return p; } };
  return (
    <div className="space-y-2">
      <p>{change.length ? `Swap ${change.length} Pro-only icon${change.length === 1 ? "" : "s"} for the free version shown, then switch the site to Font Awesome Free.` : "No Pro-only icons in use. Switch the site to Font Awesome Free."}</p>
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-normal">
            <thead><tr className="text-left text-zinc-500"><th className="pr-2">Icon</th><th className="pr-2">Current class</th><th className="pr-2">Change to</th><th className="pr-2">Where it is used</th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.cls} className="border-t border-zinc-200 align-top">
                  <td className="pr-2">{i.icon}<div className="text-zinc-400">{i.style}{i.free ? " · free" : " · Pro only"}</div></td>
                  <td className="pr-2 font-mono">{i.cls}</td>
                  <td className={`pr-2 ${i.free ? "text-zinc-500" : "font-mono font-semibold text-green-800"}`}>{i.changeTo}</td>
                  <td className="pr-2">
                    {(i.pages || []).slice(0, 4).map((p, n) => <span key={p}>{n ? ", " : ""}<a href={pageLink(p)} target="_blank" rel="noreferrer" className="text-blue-700 underline">{p}</a></span>)}
                    {i.uses > (i.pages || []).length && <span className="text-zinc-400"> {i.pages?.length ? "+" : ""}{i.uses - (i.pages || []).length} more page{i.uses - (i.pages || []).length === 1 ? "" : "s"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {icons.length > change.length && <button onClick={() => setShowFree((v) => !v)} className="text-[11px] text-blue-700 underline">{showFree ? "Hide icons that are already free" : `Show ${icons.length - change.length} icon${icons.length - change.length === 1 ? "" : "s"} that are already free`}</button>}
      <p className="text-[11px] text-zinc-500">Checked {pages} page{pages === 1 ? "" : "s"} against Font Awesome {version || 6} Free. Icons added by CSS or JavaScript are not counted.</p>
    </div>
  );
}

// Delete (bin) icon on the right of a card. Asks inline before cancelling and removing the site.
function RemoveSite({ site, onRemove }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 text-xs">
        <span className="text-zinc-600">Delete {site}?</span>
        <button onClick={onRemove} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white"><TrashIcon className="h-3.5 w-3.5" /> Delete</button>
        <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100">Keep</button>
      </div>
    );
  }
  return (
    <button onClick={() => setAsking(true)} aria-label={`Remove ${site}`} title="Delete this site's results"
      className="shrink-0 px-3 py-3.5 text-zinc-400 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"><TrashIcon /></button>
  );
}

// Run / rescan, stop, download and clear for one area. Clear asks first.
function AreaBar({ kind, done, total, label, running, sites, onRun, onStop, onClear, download, retry }) {
  const [asking, setAsking] = useState(false);
  const btn = "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50";
  const primary = "inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
  const unfinished = retry?.sites.length > 0;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {running === kind ? (
          <button onClick={onStop} className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"><StopIcon /> Stop</button>
        ) : (
          <>
            {/* Finishing what is left is the main action when some sites did not complete. */}
            {unfinished && <button onClick={retry.onClick} className={primary}><RefreshIcon /> Re-scan {retry.sites.length} unfinished site{retry.sites.length === 1 ? "" : "s"}</button>}
            <button onClick={onRun} disabled={!!running || !sites.length} className={unfinished ? btn : primary}>
              {/Rescan/.test(label) ? <RefreshIcon /> : <PlayIcon />} {label} on {sites.length} site{sites.length === 1 ? "" : "s"}
            </button>
          </>
        )}
        {download && <button onClick={download.onClick} disabled={download.busy} className={btn}><DownloadIcon /> {download.busy ? "Building…" : download.label}</button>}
        {onClear && !running && (asking ? (
          <span className="flex items-center gap-2 text-sm sm:ml-auto">
            <span className="text-zinc-600">Clear all {kind === "fonts" ? "font" : "image"} results?</span>
            <button onClick={() => { setAsking(false); onClear(); }} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white"><TrashIcon className="h-3.5 w-3.5" /> Clear</button>
            <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100">Keep</button>
          </span>
        ) : (
          <button onClick={() => setAsking(true)} className={`${btn} text-red-700 hover:bg-red-50 sm:ml-auto`}><TrashIcon /> Clear {kind === "fonts" ? "font" : "image"} results</button>
        ))}
      </div>
      {total > 0 && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-zinc-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{running === kind ? `Scanning… ${done} of ${total} done` : done < total ? `${done} of ${total} sites scanned` : `${done} site${done === 1 ? "" : "s"} scanned`}</p>
        </div>
      )}
    </div>
  );
}

// Search + dropdown filters for a site list. `fields` are extra selects: {key, label, options: [value | [value, label]]}.
function FilterBar({ value, onChange, count, managers, fields }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const active = Object.values(value).some(Boolean);
  const sel = "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-2 text-xs">
      <input value={value.q} onChange={(e) => set("q", e.target.value)} placeholder="Search site, client or font" aria-label="Search" className="min-w-0 flex-1 basis-40 rounded-md border border-zinc-300 px-2 py-1.5 text-xs" />
      <select value={value.manager} onChange={(e) => set("manager", e.target.value)} aria-label="Account manager" className={sel}>
        <option value="">All account managers</option>
        {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        <option value="__none">No client matched</option>
      </select>
      {fields.map((f) => (
        <select key={f.key} value={value[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} className={sel}>
          <option value="">{f.label}</option>
          {f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
        </select>
      ))}
      <span className="ml-auto text-zinc-500">{count} site{count === 1 ? "" : "s"}</span>
      {active && <button onClick={() => onChange(Object.fromEntries(Object.keys(value).map((k) => [k, ""])))} className="text-blue-700 underline">Clear filters</button>}
    </div>
  );
}

// One site's report page: back link, the site card (open) and its client email.
// Results take two thirds, the client email sits in the right-hand third.
function SiteReport({ onBack, main, aside }) {
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900">← All sites</button>
      {aside ? (
        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          <div className="min-w-0 lg:col-span-2">{main}</div>
          <div className="min-w-0 lg:sticky lg:top-4">{aside}</div>
        </div>
      ) : main}
    </div>
  );
}

// "green" tone = we can fix it free (Adobe/Google link, remove, free version): orange, since it is still a job.
const TONE_CHIP = { red: "bg-red-600", amber: "bg-amber-500", green: "bg-orange-500" };
const TONE_BORDER = { red: "border-red-500", amber: "border-amber-500", green: "border-orange-400" };
const TONE_RANK = { red: 3, amber: 2, green: 1 };

function SiteCard({ r, open, toggle, rerun, running, onRemove, onFixed }) {
  const fonts = r.fonts || [];
  const todo = fontTodo(r).sort((a, b) => (TONE_RANK[ISSUE_TONE[issueLabel(b)]] || 0) - (TONE_RANK[ISSUE_TONE[issueLabel(a)]] || 0));
  const fixedFonts = fontFixedList(r);
  // Pills: green first, then amber, then red.
  const labels = [...new Set(todo.map(issueLabel))].sort((a, b) => (TONE_RANK[ISSUE_TONE[a]] || 0) - (TONE_RANK[ISSUE_TONE[b]] || 0));
  const worst = labels.map((l) => ISSUE_TONE[l]).sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0];
  const c = r.status === "RUNNING" || r.status === "UNREACHABLE" || !worst
    ? (COLOUR[r.status] || COLOUR.PENDING)
    : { ...COLOUR.PROBLEM, border: TONE_BORDER[worst] };
  const oks = fonts.filter((f) => f.status === "OK");
  const headline = r.status === "RUNNING"
    ? "Scanning…"
    : r.error
      ? r.error
      : todo.length
        ? [...new Set(todo.map((f) => f.family))].join(", ")
        : fixedFonts.length ? `All ${fixedFonts.length} fixed` : fonts.length ? `${oks.length} font${oks.length === 1 ? "" : "s"} OK` : r.ignoredFonts?.length ? "Only icon/UI fonts (ignored)" : "No web fonts found";

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start">
      <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
        {labels.length && r.status !== "RUNNING"
          ? labels.map((l) => <span key={l} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${TONE_CHIP[ISSUE_TONE[l]] || "bg-zinc-500"}`}>{l}</span>)
          : r.status === "RUNNING" ? <span className="text-blue-600" title="Scanning"><SpinnerIcon className="h-5 w-5" /></span>
          : <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{LABEL[r.status] || r.status}</span>}
        <span className="font-medium">{r.site}</span>
        {fixedFonts.length > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">{fixedFonts.length} fixed</span>}
        {r.platform && <span className="text-xs text-zinc-400">{r.platform}</span>}
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
      </button>
      <RemoveSite site={r.site} onRemove={onRemove} />
      </div>
      {open && r.status !== "RUNNING" && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          {r.error && <p className={`mb-2 ${r.status === "UNREACHABLE" ? "text-purple-700" : "text-red-700"}`}>{r.error}</p>}
          {r.fix && <p className="mb-2 text-sm"><b>Suggested fix:</b> {r.fix}</p>}
          {todo.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Font</th>
                    <th className="py-1 pr-2">Loaded from</th>
                    <th className="py-1 pr-2">Why</th>
                    <th className="w-1/2 py-1 pr-2">Suggested fix</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {todo.map((f, i) => {
                    const fc = COLOUR[f.status] || COLOUR.PENDING;
                    return (
                      <tr key={i} className={`border-t border-zinc-100 align-top ${fc.bg}`}>
                        <td className="py-1.5 pr-2 whitespace-nowrap"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${TONE_CHIP[ISSUE_TONE[issueLabel(f)]] || "bg-zinc-500"}`}>{issueLabel(f)}</span></td>
                        <td className={`py-1.5 pr-2 font-semibold ${fc.text}`}><a href={fontLink(f)} target="_blank" rel="noreferrer" title="Font foundry page" className="underline decoration-dotted underline-offset-2">{f.family}</a>{f.otherFiles > 0 && <span className="font-normal text-zinc-400"> +{f.otherFiles} more file{f.otherFiles === 1 ? "" : "s"}</span>}
                          {f.styles?.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{f.styles.map((st) => <span key={st} className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-200">{st}</span>)}</div>}</td>
                        <td className="max-w-[200px] py-1.5 pr-2">
                          <div className="whitespace-nowrap">{f.kind}{f.hostedOn ? ` / ${f.hostedOn}` : ""}</div>
                          <a href={f.source} target="_blank" rel="noreferrer" title={[f.source, f.meta?.copyright, f.meta?.manufacturer, f.meta?.licence].filter(Boolean).join("\n")} className="block truncate font-mono text-[11px] text-blue-700 underline">{(() => { try { return decodeURIComponent(new URL(f.source).pathname.split("/").pop()) || f.source; } catch { return f.source; } })()}</a>
                        </td>
                        <td className="py-1.5 pr-2">{f.note}</td>
                        <td className="py-1.5 pr-2 font-medium">
                          {f.status === "PROBLEM" && f.adobe && (
                            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                              <Badge ok={(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || ""))} bad={f.adobe === "no" && !(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || ""))} label={(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) ? "On Adobe Fonts" : f.adobe === "no" ? "Not on Adobe Fonts" : "Adobe: not sure"} />
                              {!(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) && <Badge ok={f.google === "yes"} bad={f.google === "no"} label={f.google === "yes" ? "On Google Fonts" : f.google === "no" ? "Not on Google Fonts" : "Google: not sure"} />}
                              {!(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) && f.google !== "yes" && f.freeVersion && <Badge ok={f.freeVersion.isFree} bad={!f.freeVersion.isFree} label={f.freeVersion.isFree ? "Free version exists" : "No free version"} />}
                              {f.freeRoute === "none" && !(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) && (
                                <span className="text-zinc-500">
                                  Search: <a href={f.adobeSearch} target="_blank" rel="noreferrer" className="text-blue-700 underline">Adobe</a> · <a href={f.googleSearch} target="_blank" rel="noreferrer" className="text-blue-700 underline">Google</a> · <a href={f.squirrelSearch} target="_blank" rel="noreferrer" className="text-blue-700 underline">Font Squirrel</a>
                                </span>
                              )}
                              {f.freeVersion?.url && !(f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) && f.google !== "yes" && <a href={f.freeVersion.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">Free version link</a>}
                            </div>
                          )}
                          {f.faIcons ? <FaIconTable icons={f.faIcons} pages={f.faPagesChecked} version={f.faVersion} site={r.finalUrl || `https://${r.site}`} /> : fixedFix(f)}
                          {freeRouteLink(f) && <> <a href={freeRouteLink(f)} target="_blank" rel="noreferrer" className="text-blue-700 underline">Open font page</a></>}
                        </td>
                        <td className="py-1.5 pl-2 whitespace-nowrap">
                          <button onClick={() => onFixed([f.family], true)} className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-white px-2 py-0.5 text-[11px] font-medium text-green-800 hover:bg-green-50"><CheckIcon className="h-3 w-3" /> Mark as fixed</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {fixedFonts.length > 0 && (
            <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-900">
              <span className="font-semibold">Fixed:</span> {fixedFonts.map((f) => <span key={f.family} className="mr-2 inline-flex items-center gap-1">{f.family} <button onClick={() => onFixed([f.family], false)} className="text-green-700 underline">undo</button></span>)}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            {todo.length > 0 && <button onClick={() => onFixed(todo.map((f) => f.family), true)} className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-green-700"><CheckIcon className="h-3 w-3" /> Mark everything as fixed</button>}
            {r.finalUrl && <span>Fetched {r.finalUrl}</span>}
            {r.fontPages > 0 && <span>{r.fontPages} page{r.fontPages === 1 ? "" : "s"}</span>}
            {r.cssCount > 0 && <span>{r.cssCount} stylesheets</span>}
            {oks.length > 0 && <span title={[...new Set(oks.map((f) => f.family))].join(", ")} className="text-green-700">{oks.length} font{oks.length === 1 ? "" : "s"} fine</span>}
            {r.ignoredFonts?.length > 0 && <span title={r.ignoredFonts.join(", ")}>{r.ignoredFonts.length} icon/UI font{r.ignoredFonts.length === 1 ? "" : "s"} ignored</span>}
            {r.seconds != null && <span>{r.seconds}s</span>}
            {!running && <button onClick={rerun} className="inline-flex items-center gap-1 underline"><RefreshIcon className="h-3 w-3" /> Re-scan</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageCard({ r, paid, open, toggle, rerun, running, onRemove, onFixed }) {
  const fixedImgs = fixedImagesOf(r);
  const st = r.imgStatus === "RUNNING" ? "RUNNING" : r.imgStatus === "UNREACHABLE" ? "UNREACHABLE" : paid.length ? "PAID" : "OK";
  const c = COLOUR[st];
  const libs = [...new Set(paid.map((i) => i.flag))];
  const freeCount = (r.images || []).filter((i) => i.flag && isFreeLib(i.flag)).length;
  const label = st === "PAID" ? "PAID LIBRARY" : st === "RUNNING" ? "SCANNING" : st === "UNREACHABLE" ? "COULDN'T CHECK" : "OK";
  const headline = st === "RUNNING"
    ? `Scanning… ${r.imgProgress || ""}`
    : st === "UNREACHABLE"
      ? r.imgError
      : paid.length ? `${paid.length} image${paid.length === 1 ? "" : "s"} · ${libs.join(", ")} → find the purchase record, or replace` : fixedImgs.length ? `All ${fixedImgs.length} fixed` : "No paid-library images";
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start">
      <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
        {st === "RUNNING" ? <span className="text-blue-600" title="Scanning"><SpinnerIcon className="h-5 w-5" /></span>
          : <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{label}</span>}
        <span className="font-medium">{r.site}</span>
        {fixedImgs.length > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">{fixedImgs.length} fixed</span>}
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
        {st !== "RUNNING" && r.pagesScanned > 0 && <span className="text-xs text-zinc-400">{r.pagesScanned} pages</span>}
      </button>
      <RemoveSite site={r.site} onRemove={onRemove} />
      </div>
      {st === "RUNNING" && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-valuemin={0} aria-valuemax={r.imgTotal || 0} aria-valuenow={r.imgDone || 0}>
            {r.imgTotal > 0
              ? <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, ((r.imgDone || 0) / r.imgTotal) * 100)}%` }} />
              : <div className="h-full w-1/4 animate-pulse rounded-full bg-blue-300" />}
          </div>
        </div>
      )}
      {open && st !== "RUNNING" && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          {r.imgFix && st === "UNREACHABLE" && <p className="mb-2"><b>Suggested fix:</b> {r.imgFix}</p>}
          {paid.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-2">Library</th>
                  <th className="py-1 pr-2">Image</th>
                  <th className="py-1 pr-2">Licence check</th>
                  <th className="py-1 pr-2">Check on library</th>
                  <th className="py-1 pr-2">Embedded credit / copyright</th>
                  <th className="py-1 pr-2">Suggested fix</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {paid.slice(0, 80).map((i, k) => {
                  let name = i.url;
                  try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
                  return (
                    <tr key={k} className="border-t border-zinc-100 align-top bg-red-50">
                      <td className="py-1.5 pr-2 font-semibold text-red-700">{i.flag}</td>
                      <td className="py-1.5 pr-2">
                        <a href={i.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-blue-700 underline">{name.slice(0, 80)}</a>
                        {i.sizes > 1 && <span className="ml-1 text-[11px] text-zinc-400">+{i.sizes - 1} other size{i.sizes === 2 ? "" : "s"}</span>}
                        {i.pages?.length > 0 && <div className="text-[11px] text-zinc-400">on {i.pages.slice(0, 3).map((p) => { try { return new URL(p).pathname || "/"; } catch { return p; } }).join(", ")}{i.pages.length > 3 ? ` +${i.pages.length - 3} more` : ""}</div>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2" title={stockLicenceSignal(i).reason}>
                        {(() => { const st = stockLicenceSignal(i).status; return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${st === "Likely licensed" ? "bg-green-600" : st === "Possible preview" ? "bg-red-600" : "bg-amber-500"}`}>{st}</span>; })()}
                        <div className="mt-0.5 text-[11px] text-zinc-500">{stockLicenceSignal(i).reason}</div>
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{stockLibraryLink(i.url, i.flag) ? <a href={stockLibraryLink(i.url, i.flag)} target="_blank" rel="noreferrer" className="text-blue-700 underline">View on {i.flag}</a> : "—"}</td>
                      <td className="py-1.5 pr-2 text-zinc-600">{creditOnly(i.meta) || "—"}</td>
                      <td className="py-1.5 pr-2 font-medium">Find the purchase record / licence. If none, replace the image or buy a licence.</td>
                      <td className="py-1.5 whitespace-nowrap"><button onClick={() => onFixed([imageKey(i.url, i.flag)], true)} className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-white px-2 py-0.5 text-[11px] font-medium text-green-800 hover:bg-green-50"><CheckIcon className="h-3 w-3" /> Mark as fixed</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {fixedImgs.length > 0 && (
            <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-900">
              <span className="font-semibold">Fixed:</span> {fixedImgs.map((i) => { let n = i.url; try { n = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {} return <span key={i.url} className="mr-2 inline-flex items-center gap-1">{n.slice(0, 50)} <button onClick={() => onFixed([imageKey(i.url, i.flag)], false)} className="text-green-700 underline">undo</button></span>; })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            {paid.length > 0 && <button onClick={() => onFixed(paid.map((i) => imageKey(i.url, i.flag)), true)} className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-green-700"><CheckIcon className="h-3 w-3" /> Mark everything as fixed</button>}
            {r.pagesScanned > 0 && <span>{r.pagesScanned} page{r.pagesScanned === 1 ? "" : "s"} checked{r.hasSitemap ? " (sitemap)" : " (crawled)"}</span>}
            {r.imagesChecked > 0 && <span>{r.imagesChecked} images seen</span>}
            {freeCount > 0 && <span className="text-green-700">{freeCount} free-library image{freeCount === 1 ? "" : "s"} (no licence needed)</span>}
            {!running && <button onClick={rerun} className="inline-flex items-center gap-1 underline"><RefreshIcon className="h-3 w-3" /> Re-scan</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const EDITS_KEY = "flc-email-edits-v1";
function loadEdits() { try { return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}"); } catch { return {}; } }
function saveEdits(all) { try { localStorage.setItem(EDITS_KEY, JSON.stringify(all)); } catch {} pushSetting("email-edits", all); }

function EmailCard({ e, open, toggle, result, client }) {
  const key = `${e.kind}|${e.site}`;
  const [copied, setCopied] = useState(false);
  const [copiedTo, setCopiedTo] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  async function downloadSheet() {
    setSheetBusy(true);
    try {
      const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "client-images", results: [result] }) });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `stock-images-${e.site}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setSheetBusy(false); }
  }
  async function copyTo() {
    try { await navigator.clipboard.writeText(client.emails.join(", ")); setCopiedTo(true); setTimeout(() => setCopiedTo(false), 1500); } catch {}
  }
  const [edits, setEdits] = useState({});
  useEffect(() => { const t = setTimeout(() => setEdits(loadEdits()[key] || {}), 0); return () => clearTimeout(t); }, [key]);
  const text = segmentsToText(e.segments, edits);
  const edited = Object.keys(edits).length > 0;

  function update(id, value) {
    setEdits((prev) => {
      const next = { ...prev, [id]: value };
      const all = loadEdits(); all[key] = next; saveEdits(all);
      return next;
    });
  }
  function reset() {
    const all = loadEdits(); delete all[key]; saveEdits(all);
    setEdits({});
  }
  async function copy() {
    const html = segmentsToHtml(e.segments, edits);
    try {
      // Rich copy keeps image names as links when pasted into an email.
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { return; }
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button onClick={toggle} className="flex-1 text-left">
          <span className="font-medium">{e.site}</span>
          <span className="ml-2 text-xs text-zinc-500">{e.count} {e.kind === "fonts" ? "font" : "image"}{e.count === 1 ? "" : "s"}{e.attach ? " · spreadsheet to attach" : ""}</span>
          {edited && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800">Edited</span>}
          <span className="ml-2 inline-block align-middle text-zinc-400">{open ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>
        </button>
        {e.attach && (
          <button onClick={downloadSheet} disabled={sheetBusy} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50" title="Spreadsheet of all the images to attach to this email"><DownloadIcon className="h-3.5 w-3.5" /> {sheetBusy ? "Building…" : "Spreadsheet to attach"}</button>
        )}
        <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy email</>}</button>
      </div>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3">
          {/* Who it goes to, from the client list. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs">
            {client ? (
              <>
                <span><span className="text-zinc-500">To:</span> {client.emails.length ? client.emails.map((m, i) => <span key={m}>{i ? ", " : ""}<a href={`mailto:${m}`} className="text-blue-700 underline">{m}</a></span>) : <span className="text-amber-700">no email address on file</span>}</span>
                {client.emails.length > 0 && <button onClick={copyTo} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] hover:bg-zinc-100">{copiedTo ? <><CheckIcon className="h-3 w-3" /> Copied</> : <><CopyIcon className="h-3 w-3" /> Copy addresses</>}</button>}
                <span className="text-zinc-500">{client.name}{client.poc ? ` · ${client.poc}` : ""}{client.manager ? ` · Account manager: ${client.manager}` : ""}</span>
              </>
            ) : <span className="text-amber-700">No client matched to {e.site}. Add the website to the client in Settings → Clients.</span>}
          </div>
          <p className="mb-2 text-[11px] text-zinc-500"><span className="rounded bg-orange-100 px-1 text-orange-900">Orange text</span> is specific to this site. Click it to edit; changes are saved in this browser and included when you copy.</p>
          <div className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-800">
            {e.segments.map((seg, i) => typeof seg === "string"
              ? <span key={i}>{seg}</span>
              : seg.link
              ? <a key={seg.id} href={seg.href} target="_blank" rel="noreferrer" className="text-blue-700 underline">{seg.v}</a>
              : seg.href
              ? <span key={seg.id}><span
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(ev) => { const v = ev.currentTarget.innerText; if (v !== (edits[seg.id] ?? seg.v)) update(seg.id, v); }}
                  className={`rounded px-0.5 underline outline-none focus:ring-2 focus:ring-orange-400 ${edits[seg.id] !== undefined ? "bg-orange-200 text-orange-950" : "bg-orange-100 text-orange-900"}`}
                >{edits[seg.id] ?? seg.v}</span><a href={seg.href} target="_blank" rel="noreferrer" title="Open in the site\u2019s media library" className="ml-0.5 text-blue-700 no-underline">↗</a></span>
              : <span
                  key={seg.id}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(ev) => { const v = ev.currentTarget.innerText; if (v !== (edits[seg.id] ?? seg.v)) update(seg.id, v); }}
                  className={`rounded px-0.5 outline-none focus:ring-2 focus:ring-orange-400 ${seg.href ? "underline" : ""} ${edits[seg.id] !== undefined ? "bg-orange-200 text-orange-950" : "bg-orange-100 text-orange-900"}`}
                >{edits[seg.id] ?? seg.v}</span>)}
          </div>
          {edited && <button onClick={reset} className="mt-2 text-xs text-zinc-500 underline">Reset to generated text</button>}
        </div>
      )}
    </div>
  );
}
