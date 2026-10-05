"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadTeam, normaliseTeam } from "@/app/team";
import { evaluateLaunch } from "@/lib/launchChecks";

const RUNS_KEY = "flc-launch-v1";
const SIGN_KEY = "flc-launch-signoffs-v1";
const LOG_KEY = "flc-launch-log-v1";
const MARKER_KEY = "flc-marker-v1"; // {site: Marker.io project link}
const MAX_LINKS = 800;
const MAX_IMAGES = 600;
const MAX_PSI = 100; // pages audited by Google PageSpeed (about 20s each, 6 at a time)
const FILE_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json|ico|woff2?|ttf|otf)(\?|$)/i;

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const hostKey = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
const hostOf = (u) => { try { return hostKey(new URL(u).host); } catch { return ""; } };
const keyFor = (input) => { let s = String(input || "").trim(); if (!/^https?:\/\//i.test(s)) s = "https://" + s; return hostOf(s); };


export default function LaunchArea({ post, onRunning }) {
  const [url, setUrl] = useState("");
  const [markerLink, setMarkerLink] = useState("");
  const [markerReady, setMarkerReady] = useState(null); // null unknown, true/false from /api/marker
  const [runs, setRuns] = useState({});
  const [signoffs, setSignoffs] = useState({});
  const [logs, setLogs] = useState({});
  const [shared, setShared] = useState(false);
  const [team, setTeam] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [running, setRunning] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const saved = load(RUNS_KEY, {});
      for (const r of Object.values(saved)) if (r.status === "RUNNING") Object.assign(r, { status: "ERROR", error: "Check was interrupted (page reloaded or closed). Press Rescan." });
      setRuns(saved);
      setSignoffs(load(SIGN_KEY, {}));
      setLogs(load(LOG_KEY, {}));
      setTeam(loadTeam());
    }, 0);
    // Shared store (when set up) wins over this browser's copy.
    fetch("/api/marker").then((r) => r.json()).then((j) => setMarkerReady(!!(j.configured && j.ok))).catch(() => setMarkerReady(false));
    fetch("/api/team").then((r) => r.json()).then((j) => { if (j.shared && Array.isArray(j.team) && j.team.length) setTeam(normaliseTeam(j.team)); }).catch(() => {});
    for (const key of Object.keys(load(RUNS_KEY, {}))) refreshSignoffs(key);
    return () => clearTimeout(t);
  }, []);

  async function refreshSignoffs(key) {
    try {
      const j = await (await fetch(`/api/signoffs?site=${encodeURIComponent(key)}`)).json();
      if (!j.shared) return;
      setShared(true);
      setSignoffs((prev) => ({ ...prev, [key]: j.signoffs || {} }));
      setLogs((prev) => ({ ...prev, [key]: j.log || [] }));
    } catch {}
  }

  const patch = (key, fields) => setRuns((prev) => {
    const next = { ...prev, [key]: { ...(prev[key] || {}), ...fields } };
    save(RUNS_KEY, next);
    return next;
  });
  // Every sign-off change is logged: who, which check, when.
  async function sign(key, check, name) {
    const at = new Date().toISOString();
    const prevSign = signoffs[key]?.[check.id];
    const entry = name
      ? { at, checkId: check.id, check: check.title, action: prevSign ? `Changed from ${prevSign.name}` : "Signed off", name }
      : { at, checkId: check.id, check: check.title, action: "Sign-off removed", name: prevSign?.name || "" };
    setSignoffs((prev) => {
      const site = { ...(prev[key] || {}) };
      if (name) site[check.id] = { name, at }; else delete site[check.id];
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
        const j = await post("/api/signoffs", { site: key, checkId: check.id, check: check.title, name });
        if (j.shared) {
          setSignoffs((prev) => ({ ...prev, [key]: j.signoffs || {} }));
          setLogs((prev) => ({ ...prev, [key]: j.log || [] }));
        }
      } catch {}
    }
  }
  function removeRun(key) {
    setRuns((prev) => { const next = { ...prev }; delete next[key]; save(RUNS_KEY, next); return next; });
  }

  async function runCheck(input, markerProject) {
    const key = keyFor(input);
    if (!key) return;
    if (markerProject !== undefined) { const all = load(MARKER_KEY, {}); if (markerProject.trim()) all[key] = markerProject.trim(); else delete all[key]; save(MARKER_KEY, all); }
    stopRef.current = false;
    setRunning(key);
    onRunning?.(true);
    setOpenKey(key);
    patch(key, { input, status: "RUNNING", phase: "Reading the site", done: 0, total: 1, error: "" });
    try {
      const start = await post("/api/launch", { step: "start", url: input });
      if (start.error) { patch(key, { status: "ERROR", error: start.error }); return; }
      const { pageQueue, ...startInfo } = start;
      const site = startInfo.host;

      // 1) Every page from the sitemap (or crawled from the homepage when there is none).
      const queue = [...pageQueue];
      const queued = new Set(queue.map((u) => u.replace(/\/$/, "")));
      const pages = [];
      let leftover = 0;
      while (queue.length && !stopRef.current) {
        patch(key, { phase: "Checking pages", done: pages.length, total: pages.length + queue.length });
        const batch = queue.splice(0, 10);
        const out = await post("/api/launch", { step: "pages", urls: batch });
        if (out.error) { leftover += batch.length; continue; }
        pages.push(...(out.pages || []));
        if (out.remaining?.length) queue.unshift(...out.remaining);
        if (!startInfo.hasSitemap) {
          for (const p of out.pages || []) for (const l of p.links || []) {
            const k = l.replace(/\/$/, "");
            if (hostOf(l) === site && !FILE_RE.test(l) && !queued.has(k) && queued.size < 500) { queued.add(k); queue.push(l); }
          }
        }
      }
      leftover += queue.length;

      // 2) Internal links: pages already fetched give their own status, the rest are checked.
      const statusOf = {};
      for (const p of pages) { statusOf[p.url] = { status: p.status, error: p.error || "" }; if (p.finalUrl) statusOf[p.finalUrl] ||= statusOf[p.url]; }
      const linkSources = {};
      const linkTexts = {};
      for (const p of pages) for (const l of p.links || []) if (hostOf(l) === site && !linkSources[l]) { linkSources[l] = p.url; linkTexts[l] = p.linkText?.[l] || ""; }
      const linkStatus = {};
      const toCheck = [];
      for (const l of Object.keys(linkSources)) {
        if (statusOf[l] || statusOf[l.replace(/\/$/, "")] || statusOf[l + "/"]) linkStatus[l] = statusOf[l] || statusOf[l.replace(/\/$/, "")] || statusOf[l + "/"];
        else toCheck.push(l);
      }
      const linkList = toCheck.slice(0, MAX_LINKS);
      let linksLeft = toCheck.length - linkList.length;
      while (linkList.length && !stopRef.current) {
        patch(key, { phase: "Checking links", done: Object.keys(linkStatus).length, total: Object.keys(linkStatus).length + linkList.length });
        const batch = linkList.splice(0, 40);
        const out = await post("/api/launch", { step: "urls", urls: batch });
        Object.assign(linkStatus, out.results || {});
        if (out.remaining?.length) linkList.unshift(...out.remaining);
      }
      linksLeft += linkList.length;

      // 3) Images: do they load, and how big are they.
      const imageSources = {};
      for (const p of pages) for (const i of p.images || []) if (!imageSources[i]) imageSources[i] = p.url;
      const imgAll = Object.keys(imageSources);
      const imgList = imgAll.slice(0, MAX_IMAGES);
      const imageInfo = {};
      while (imgList.length && !stopRef.current) {
        patch(key, { phase: "Checking images", done: Object.keys(imageInfo).length, total: Object.keys(imageInfo).length + imgList.length });
        const batch = imgList.splice(0, 40);
        const out = await post("/api/launch", { step: "urls", urls: batch });
        Object.assign(imageInfo, out.results || {});
        if (out.remaining?.length) imgList.unshift(...out.remaining);
      }

      // 4) Google PageSpeed (Lighthouse) on each page: contrast, text size, other accessibility errors, image savings.
      const okUrls = pages.filter((p) => p.status >= 200 && p.status < 400 && !p.notHtml && !p.error).map((p) => p.url);
      const psiList = okUrls.slice(0, MAX_PSI);
      const psi = {};
      let psiError = "";
      let psiDone = 0;
      patch(key, { phase: "Accessibility audit (Google PageSpeed)", done: 0, total: psiList.length });
      const psiQueue = [...psiList];
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (psiQueue.length && !stopRef.current && !psiError) {
          const u = psiQueue.shift();
          let out = await post("/api/launch", { step: "psi", url: u });
          if (!out.ok && !out.fatal) out = await post("/api/launch", { step: "psi", url: u }); // one retry
          if (out.fatal) { psiError = out.error; break; }
          if (out.ok) psi[u] = out;
          psiDone++;
          patch(key, { done: psiDone });
        }
      }));

      // Keep only what the checks need, so a 500-page site fits in browser storage.
      const brokenSources = Object.fromEntries(Object.keys(linkStatus).map((l) => [l, linkSources[l]]));
      const brokenTexts = Object.fromEntries(Object.keys(linkStatus).map((l) => [l, linkTexts[l] || ""]));
      const imgSrc = Object.fromEntries(Object.keys(imageInfo).map((i) => [i, imageSources[i]]));
      const slimPages = pages.map((p) => { const rest = { ...p }; delete rest.links; delete rest.images; delete rest.linkText; return rest; });
      const stopped = stopRef.current;
      patch(key, {
        status: "DONE", phase: "", start: startInfo, pages: slimPages, linkStatus, linkSources: brokenSources, linkTexts: brokenTexts,
        imageInfo, imageSources: imgSrc, stopped, psi, psiError,
        complete: {
          pages: !stopped && !leftover && !startInfo.capped && slimPages.every((p) => p.status > 0),
          links: !stopped && !linksLeft && Object.values(linkStatus).every((s) => s.status > 0),
          images: !stopped && imgAll.length <= MAX_IMAGES && Object.keys(imageInfo).length === imgAll.length,
          psi: !stopped && !psiError && okUrls.length <= MAX_PSI && psiList.every((u) => psi[u]?.ok),
        },
        scannedAt: new Date().toISOString(),
      });
    } catch (e) {
      patch(key, { status: "ERROR", error: `Request failed: ${e.message}` });
    } finally {
      setRunning(null);
      onRunning?.(false);
      refreshSignoffs(key);
    }
  }

  const list = useMemo(() => Object.entries(runs).sort((a, b) => (b[1].scannedAt || "9").localeCompare(a[1].scannedAt || "9")), [runs]);

  return (
    <div className="rounded-xl border border-zinc-300 bg-white p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (!running && url.trim() && /^https?:\/\//.test(markerLink.trim())) { runCheck(url.trim(), markerLink); setMarkerLink(""); } }} className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => { setUrl(e.target.value); const k = keyFor(e.target.value); if (k) setMarkerLink(load(MARKER_KEY, {})[k] || ""); }} disabled={!!running} placeholder="Website link, e.g. https://www.example.co.uk"
          className="min-w-0 flex-1 basis-64 rounded-md border border-zinc-300 px-3 py-2 text-sm" aria-label="Website to check" />
        <input value={markerLink} onChange={(e) => setMarkerLink(e.target.value)} disabled={!!running} placeholder="Marker.io project link" required
          className="min-w-0 flex-1 basis-64 rounded-md border border-zinc-300 px-3 py-2 text-sm" aria-label="Marker.io project link" />
        {running
          ? <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
          : <button type="submit" disabled={!url.trim() || !/^https?:\/\//.test(markerLink.trim())} title={!/^https?:\/\//.test(markerLink.trim()) ? "Add the Marker.io project link first" : ""} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Run launch check</button>}
      </form>
      <p className="mt-2 text-xs text-zinc-500">Checks every page in the sitemap (up to 500), the links and images on them, and runs Google&apos;s accessibility audit on each page (up to 100). Anything the scan can&apos;t fully verify needs a person to tick it off. Completed checks drop to the bottom.</p>

      <div className="mt-4 space-y-3">
        {list.map(([key, r]) => (
          <LaunchCard key={key} k={key} r={r} signed={signoffs[key] || {}} log={logs[key] || []} shared={shared} team={team} open={openKey === key}
            toggle={() => { if (openKey !== key) refreshSignoffs(key); setOpenKey((o) => (o === key ? null : key)); }} onSign={(check, name) => sign(key, check, name)}
            onRescan={() => runCheck(r.input || key)} onRemove={() => removeRun(key)} busy={!!running} markerReady={markerReady}
            onSnag={(id, snag) => patch(key, { snags: { ...(r.snags || {}), [id]: snag } })} />
        ))}
        {!list.length && <p className="text-sm text-zinc-500">No launch checks yet.</p>}
      </div>
    </div>
  );
}

function LaunchCard({ k, r, signed, log, shared, team, open, toggle, onSign, onRescan, onRemove, busy, markerReady, onSnag }) {
  const checks = useMemo(() => (r.status === "DONE" ? evaluateLaunch(r) : []), [r]);
  const auto = checks.filter((c) => c.state === "pass").length;
  const signedCount = checks.filter((c) => c.state !== "pass" && signed[c.id]).length;
  const fails = checks.filter((c) => c.state === "fail" && !signed[c.id]).length;
  const todo = checks.filter((c) => c.state !== "pass" && !signed[c.id]).length;
  const [exporting, setExporting] = useState("");
  const [marker, setMarker] = useState(() => load(MARKER_KEY, {})[k] || "");
  const saveMarker = (v) => { setMarker(v); const all = load(MARKER_KEY, {}); if (v.trim()) all[k] = v.trim(); else delete all[k]; save(MARKER_KEY, all); };
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
          ? { site: k, url: r.start?.finalUrl, scannedAt: r.scannedAt, checks: slim, signed, log }
          : { kind: "launch", launch: { site: k, url: r.start?.finalUrl, scannedAt: r.scannedAt, checks: slim, signed, team: team.map((m) => m.name) } }) });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${word ? "launch-sign-off-log" : "launch-checklist"}-${k}-${new Date().toISOString().slice(0, 10)}.${word ? "docx" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(""); }
  }

  const pct = r.total ? Math.min(100, (r.done / r.total) * 100) : 0;
  // Grouped by who does them. Within a group: things to do first, launch-day actions marked.
  const owners = ["Designer", "Developer", "Senior Developer", "Account Manager"];
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start">
        <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
          {r.status === "RUNNING" && <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white">SCANNING</span>}
          {r.status === "ERROR" && <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-semibold text-white">COULDN&apos;T CHECK</span>}
          {r.status === "DONE" && (todo ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${fails ? "bg-red-600" : "bg-amber-500"}`}>{todo} TO SIGN OFF</span>
            : <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">READY TO LAUNCH</span>)}
          <span className="font-medium">{k}</span>
          <span className="basis-full text-sm text-zinc-600 sm:basis-auto sm:flex-1">
            {r.status === "RUNNING" ? `${r.phase}… ${r.total > 1 ? `${r.done} of ${r.total}` : ""}`
              : r.status === "ERROR" ? r.error
              : `${auto} passed automatically · ${signedCount} signed off · ${fails} with problems · ${r.pages?.length || 0} pages`}
          </span>
          {r.status !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
        </button>
        {asking ? (
          <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 text-xs">
            <span className="text-zinc-600">Remove this check?</span>
            <button onClick={onRemove} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white">Remove</button>
            <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100">Keep</button>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} disabled={r.status === "RUNNING"} aria-label={`Remove ${k}`} className="shrink-0 px-3 py-3 text-lg leading-none text-zinc-400 hover:text-red-600 disabled:opacity-30">×</button>
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
        <div className="border-t border-zinc-100 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={onRescan} disabled={busy} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Rescan</button>
            {r.status === "DONE" && <button onClick={() => download("word")} disabled={!!exporting} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50">{exporting === "word" ? "Building…" : "Download sign-off log (Word)"}</button>}
            {r.status === "DONE" && (
              <span className="flex items-center gap-1.5 text-xs">
                <input value={marker} onChange={(e) => saveMarker(e.target.value)} placeholder="Marker.io project link" aria-label="Marker.io project link"
                  className="w-56 rounded-md border border-zinc-300 px-2 py-1.5 text-xs" />
                {/^https?:\/\//.test(marker) && <a href={marker} target="_blank" rel="noreferrer" className="rounded-md bg-zinc-100 px-2.5 py-1.5 font-medium text-zinc-800 hover:bg-zinc-200">Open in Marker.io ↗</a>}
              </span>
            )}
            {r.status === "DONE" && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                <input type="checkbox" checked={hideDone} onChange={(e) => { setHideDone(e.target.checked); save("flc-launch-hide-done", e.target.checked); }} className="h-3.5 w-3.5" />
                Hide completed ({checks.length - todo})
              </label>
            )}
            {r.scannedAt && <span className="text-[11px] text-zinc-400">Scanned {new Date(r.scannedAt).toLocaleString("en-GB")}{r.stopped ? " (stopped early)" : ""}</span>}
          </div>
          {r.status === "DONE" && owners.map((who) => {
            const mine = checks.filter((c) => c.owner === who).map((c, i) => ({ c, i, done: c.state === "pass" || !!signed[c.id] }));
            const left = mine.filter((x) => !x.done).length;
            return (
              <div key={who} className="mb-4">
                <h3 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {who}
                  <span className={`text-[11px] font-normal ${left ? "text-zinc-500" : "text-green-700"}`}>{mine.length - left} of {mine.length} complete</span>
                </h3>
                <div className="space-y-2">
                  {mine.filter((x) => !(hideDone && x.done)).sort((a, b) => a.done - b.done || a.i - b.i).map(({ c }) => (
                    <CheckRow key={c.id} c={c} s={signed[c.id]} team={team} onSign={(name) => onSign(c, name)} marker={marker} markerReady={markerReady} snag={r.snags?.[c.id]} onSnag={(sn) => onSnag(c.id, sn)} />
                  ))}
                  {hideDone && !left && <p className="px-3 py-2.5 text-sm text-green-700">All {who} checks are complete.</p>}
                </div>
              </div>
            );
          })}
          {r.status === "DONE" && (
            <div className="rounded-lg border border-zinc-200">
              <button onClick={() => setShowLog((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
                <span className="font-semibold">Sign-off log ({log.length})</span>
                <span className="text-xs text-zinc-400">{shared ? "Shared with the team" : "Saved in this browser only"} · {showLog ? "Hide" : "Show"}</span>
              </button>
              {showLog && (
                <table className="w-full border-t border-zinc-100 text-xs">
                  <thead><tr className="text-left text-zinc-500"><th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Check</th><th className="px-3 py-1.5">Action</th><th className="px-3 py-1.5">Name</th></tr></thead>
                  <tbody>
                    {[...log].reverse().map((e, i) => (
                      <tr key={i} className="border-t border-zinc-100 align-top">
                        <td className="whitespace-nowrap px-3 py-1.5">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td className="px-3 py-1.5">{e.check}</td>
                        <td className={`px-3 py-1.5 ${/removed/i.test(e.action) ? "text-red-700" : "text-green-700"}`}>{e.action}</td>
                        <td className="px-3 py-1.5 font-medium">{e.name}</td>
                      </tr>
                    ))}
                    {!log.length && <tr><td colSpan={4} className="px-3 py-2 text-zinc-500">No sign-offs yet.</td></tr>}
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

// Which team role each check owner maps to (people with that role are listed first).
const OWNER_ROLE = { Designer: "Designer", Developer: "Development", "Senior Developer": "Senior Developer", "Account Manager": "Account Manager", Content: "Content" };

// What the scan found, shown as a short note on rows still needing a person.
const SCAN_NOTE = { fail: "Scan found problems", review: "Scan found things to look at", manual: "Manual check" };

// Ready-to-paste snag text for Marker.io (or any ticket tool).
function snagText(c) {
  const lines = [c.title];
  for (const f of c.facts || []) if (f.ok === false) lines.push(`- ${f.text}`);
  if (c.items.length) c.items.slice(0, 30).forEach((i, n) => lines.push(`${n + 1}. ${i.text}`));
  else if (c.summary && !(c.facts || []).some((f) => f.ok === false)) lines.push(c.summary);
  if (c.items.length > 30) lines.push(`…and ${c.items.length - 30} more`);
  return lines.join("\n");
}

function CheckRow({ c, s, team, onSign, marker, markerReady, snag, onSnag }) {
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [snagError, setSnagError] = useState("");
  async function createSnag() {
    setCreating(true); setSnagError("");
    try {
      const r = await fetch("/api/marker", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: c.title, description: snagText(c).split("\n").slice(1).join("\n"), project: marker || "" }) });
      const j = await r.json();
      if (j.ok) onSnag({ at: new Date().toISOString(), link: j.link || "", tool: j.tool });
      else setSnagError(j.error || "Marker.io did not accept the snag.");
    } catch (e) { setSnagError(`Could not reach Marker.io: ${e.message}`); }
    finally { setCreating(false); }
  }
  async function copySnag() {
    try { await navigator.clipboard.writeText(snagText(c)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
    if (/^https?:\/\//.test(marker || "")) window.open(marker, "_blank", "noopener");
  }
  const auto = c.state === "pass";
  const done = auto || !!s;
  const role = OWNER_ROLE[c.owner] || "";
  const all = s?.name && !team.some((m) => m.name === s.name) ? [...team, { name: s.name, role: "" }] : team;
  const first = all.filter((m) => m.role === role);
  const rest = all.filter((m) => m.role !== role);
  return (
    <div className={`grid gap-3 rounded-lg px-3 py-3 text-sm sm:grid-cols-[1fr_230px] ${done ? "bg-green-50" : "bg-red-50"}`}>
      <div className="min-w-0">
        <p className="font-medium">{c.title}</p>
        <p className="text-[11px] text-zinc-500">
          {c.section === "Launch actions" ? "On launch day" : "Before launch"}
          {!done && <span className={`ml-2 font-semibold ${c.state === "fail" ? "text-red-700" : c.state === "review" ? "text-amber-700" : "text-zinc-600"}`}>· {SCAN_NOTE[c.state]}</span>}
          {s && c.state === "fail" && <span className="ml-2 font-semibold text-red-700">· Scan still shows problems</span>}
        </p>
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
        {/* The summary itself opens the details when there are any. */}
        {c.summary && (c.items.length
          ? <button onClick={() => setMore((v) => !v)} className="mt-0.5 text-left text-xs text-zinc-700 hover:text-blue-700" aria-expanded={more}>
              {c.summary} <span className="whitespace-nowrap font-medium text-blue-700">{more ? "Hide ▴" : "Show ▾"}</span>
            </button>
          : <p className="mt-0.5 text-xs text-zinc-600">{c.summary}</p>)}
        {(c.items.length > 0 || c.links.length > 0) && (
          <div className="mt-1 text-xs">
            {c.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="mr-3 text-blue-700 underline">{l.text}</a>)}
            {c.state !== "pass" && c.state !== "manual" && (snag ? (
              <span className="mr-3 text-[11px] font-medium text-green-700">✓ Snag sent to Marker.io {new Date(snag.at).toLocaleDateString("en-GB")}{snag.link && <> · <a href={snag.link} target="_blank" rel="noreferrer" className="underline">open</a></>}</span>
            ) : markerReady ? (
              <button onClick={createSnag} disabled={creating} className="mr-3 rounded bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                title={marker ? `Creates the snag in ${marker}` : "Creates the snag in Marker.io (add the project link on the scan to file it in the right project)"}>
                {creating ? "Sending…" : "Create snag in Marker.io"}
              </button>
            ) : (
              <button onClick={copySnag} className="mr-3 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100" title="Copies the problem as text; opens your Marker.io project if a link is set">
                {copied ? "Copied – paste into Marker.io" : "Copy snag for Marker.io"}
              </button>
            ))}
            {snagError && <span className="mr-3 text-[11px] text-red-700">{snagError}</span>}
            {more && (
              <ol className="mt-1 max-h-80 list-decimal space-y-1.5 overflow-auto rounded bg-white/70 py-2 pl-7 pr-2 text-[11px] text-zinc-700">
                {c.items.map((i, n) => <li key={n} className="break-words pl-1">{i.href ? <a href={i.href} target="_blank" rel="noreferrer" className="hover:underline">{i.text}</a> : i.text}</li>)}
              </ol>
            )}
          </div>
        )}
      </div>
      <div className="text-xs">
        {auto ? (
          <span className="inline-flex w-full items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 font-semibold text-white"><span aria-hidden>✓</span> Passed automatically</span>
        ) : (
          <>
            {/* One control: pick a name to sign off, "Not checked" to remove it. */}
            <select value={s?.name || ""} onChange={(e) => onSign(e.target.value || null)} aria-label={`Signed off by, ${c.title}`}
              className={`w-full cursor-pointer rounded-full border-0 px-3 py-1.5 font-semibold text-white ${s ? "bg-green-600" : "bg-red-600"}`}>
              <option value="" className="bg-white text-zinc-900">Not checked</option>
              {first.length > 0 && <optgroup label={role} className="bg-white text-zinc-900">{first.map((m) => <option key={m.name} value={m.name} className="bg-white text-zinc-900">✓ Checked by {m.name}</option>)}</optgroup>}
              {rest.length > 0 && <optgroup label={first.length ? "Everyone else" : "Team"} className="bg-white text-zinc-900">{rest.map((m) => <option key={m.name} value={m.name} className="bg-white text-zinc-900">✓ Checked by {m.name}</option>)}</optgroup>}
            </select>
            {s && <p className="mt-1 px-1 text-[11px] text-green-700">{new Date(s.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
