"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM } from "@/data/team";
import { evaluateLaunch, AUTO_SIGNER, STATE_LABEL } from "@/lib/launchChecks";

const RUNS_KEY = "flc-launch-v1";
const SIGN_KEY = "flc-launch-signoffs-v1";
const TEAM_KEY = "flc-team-v1";
const MAX_LINKS = 800;
const MAX_IMAGES = 600;
const FILE_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json|ico|woff2?|ttf|otf)(\?|$)/i;

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const sortNames = (a) => [...new Set(a.map((n) => n.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" }));
const hostKey = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
const hostOf = (u) => { try { return hostKey(new URL(u).host); } catch { return ""; } };
const keyFor = (input) => { let s = String(input || "").trim(); if (!/^https?:\/\//i.test(s)) s = "https://" + s; return hostOf(s); };

const STATE_CHIP = { pass: "bg-green-600", fail: "bg-red-600", review: "bg-amber-500", manual: "bg-zinc-500" };

export default function LaunchArea({ post }) {
  const [url, setUrl] = useState("");
  const [runs, setRuns] = useState({});
  const [signoffs, setSignoffs] = useState({});
  const [team, setTeam] = useState(sortNames(TEAM));
  const [openKey, setOpenKey] = useState(null);
  const [running, setRunning] = useState(null);
  const [showTeam, setShowTeam] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setRuns(load(RUNS_KEY, {}));
      setSignoffs(load(SIGN_KEY, {}));
      const saved = load(TEAM_KEY, null);
      if (Array.isArray(saved)) setTeam(sortNames(saved));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const patch = (key, fields) => setRuns((prev) => {
    const next = { ...prev, [key]: { ...(prev[key] || {}), ...fields } };
    save(RUNS_KEY, next);
    return next;
  });
  function updateTeam(list) { const s = sortNames(list); setTeam(s); save(TEAM_KEY, s); }
  function sign(key, id, name) {
    setSignoffs((prev) => {
      const site = { ...(prev[key] || {}) };
      if (name) site[id] = { name, at: new Date().toISOString() }; else delete site[id];
      const next = { ...prev, [key]: site };
      save(SIGN_KEY, next);
      return next;
    });
  }
  function removeRun(key) {
    setRuns((prev) => { const next = { ...prev }; delete next[key]; save(RUNS_KEY, next); return next; });
  }

  async function runCheck(input) {
    const key = keyFor(input);
    if (!key) return;
    stopRef.current = false;
    setRunning(key);
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
      for (const p of pages) for (const l of p.links || []) if (hostOf(l) === site && !linkSources[l]) linkSources[l] = p.url;
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

      // Keep only what the checks need, so a 500-page site fits in browser storage.
      const brokenSources = Object.fromEntries(Object.keys(linkStatus).map((l) => [l, linkSources[l]]));
      const imgSrc = Object.fromEntries(Object.keys(imageInfo).map((i) => [i, imageSources[i]]));
      const slimPages = pages.map((p) => { const rest = { ...p }; delete rest.links; delete rest.images; return rest; });
      const stopped = stopRef.current;
      patch(key, {
        status: "DONE", phase: "", start: startInfo, pages: slimPages, linkStatus, linkSources: brokenSources,
        imageInfo, imageSources: imgSrc, stopped,
        complete: {
          pages: !stopped && !leftover && !startInfo.capped && slimPages.every((p) => p.status > 0),
          links: !stopped && !linksLeft && Object.values(linkStatus).every((s) => s.status > 0),
          images: !stopped && imgAll.length <= MAX_IMAGES && Object.keys(imageInfo).length === imgAll.length,
        },
        scannedAt: new Date().toISOString(),
      });
    } catch (e) {
      patch(key, { status: "ERROR", error: `Request failed: ${e.message}` });
    } finally {
      setRunning(null);
    }
  }

  const list = useMemo(() => Object.entries(runs).sort((a, b) => (b[1].scannedAt || "9").localeCompare(a[1].scannedAt || "9")), [runs]);

  return (
    <div className="rounded-xl border border-zinc-300 bg-white p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (!running && url.trim()) runCheck(url.trim()); }} className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!running} placeholder="Paste a link, e.g. https://www.example.co.uk"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm" aria-label="Website to check" />
        {running
          ? <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
          : <button type="submit" disabled={!url.trim()} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Run launch check</button>}
      </form>
      <p className="mt-2 text-xs text-zinc-500">Checks every page in the sitemap (up to 500), then the links and images on them. Anything the scan can&apos;t fully verify needs a person to tick it off.</p>

      <TeamEditor team={team} open={showTeam} toggle={() => setShowTeam((v) => !v)} onChange={updateTeam} />

      <div className="mt-4 space-y-3">
        {list.map(([key, r]) => (
          <LaunchCard key={key} k={key} r={r} signed={signoffs[key] || {}} team={team} open={openKey === key}
            toggle={() => setOpenKey((o) => (o === key ? null : key))} onSign={(id, name) => sign(key, id, name)}
            onRescan={() => runCheck(r.input || key)} onRemove={() => removeRun(key)} busy={!!running} />
        ))}
        {!list.length && <p className="text-sm text-zinc-500">No launch checks yet.</p>}
      </div>
    </div>
  );
}

function TeamEditor({ team, open, toggle, onChange }) {
  const [name, setName] = useState("");
  return (
    <div className="mt-3 rounded-lg border border-zinc-200">
      <button onClick={toggle} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
        <span className="font-medium">Team names ({team.length})</span>
        <span className="text-xs text-zinc-400">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-100 px-3 py-3">
          <div className="flex flex-wrap gap-1.5">
            {team.map((n) => (
              <span key={n} className="flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-xs text-zinc-800">
                {n}
                <button onClick={() => onChange(team.filter((x) => x !== n))} aria-label={`Remove ${n}`} className="rounded-full px-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600">×</button>
              </span>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onChange([...team, name]); setName(""); } }} className="mt-3 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm" />
            <button type="submit" disabled={!name.trim()} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50">Add</button>
          </form>
          <p className="mt-2 text-[11px] text-zinc-500">Always sorted A–Z. Saved in this browser.</p>
        </div>
      )}
    </div>
  );
}

function LaunchCard({ k, r, signed, team, open, toggle, onSign, onRescan, onRemove, busy }) {
  const checks = useMemo(() => (r.status === "DONE" ? evaluateLaunch(r) : []), [r]);
  const auto = checks.filter((c) => c.state === "pass").length;
  const signedCount = checks.filter((c) => c.state !== "pass" && signed[c.id]).length;
  const fails = checks.filter((c) => c.state === "fail" && !signed[c.id]).length;
  const todo = checks.filter((c) => c.state !== "pass" && !signed[c.id]).length;
  const [exporting, setExporting] = useState(false);
  const [asking, setAsking] = useState(false);

  async function download() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "launch", launch: { site: k, url: r.start?.finalUrl, scannedAt: r.scannedAt, checks, signed, team } }) });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `launch-checklist-${k}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  }

  const pct = r.total ? Math.min(100, (r.done / r.total) * 100) : 0;
  const sections = ["Launch checks", "Launch actions"];
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
            {r.status === "DONE" && <button onClick={download} disabled={exporting} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50">{exporting ? "Building…" : "Download checklist (Excel)"}</button>}
            {r.scannedAt && <span className="text-[11px] text-zinc-400">Scanned {new Date(r.scannedAt).toLocaleString("en-GB")}{r.stopped ? " (stopped early)" : ""}</span>}
          </div>
          {r.status === "DONE" && sections.map((sec) => (
            <div key={sec} className="mb-4">
              <h3 className="mb-1 text-sm font-semibold">{sec}</h3>
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {checks.filter((c) => c.section === sec).map((c) => (
                  <CheckRow key={c.id} c={c} s={signed[c.id]} team={team} onSign={(name) => onSign(c.id, name)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({ c, s, team, onSign }) {
  const [name, setName] = useState(s?.name || "");
  const [more, setMore] = useState(false);
  const auto = c.state === "pass";
  const names = s?.name && !team.includes(s.name) ? [...team, s.name] : team;
  return (
    <div className={`grid gap-3 px-3 py-2.5 text-sm sm:grid-cols-[1fr_250px] ${auto || s ? "bg-green-50/50" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white ${STATE_CHIP[c.state]}`}>{STATE_LABEL[c.state]}</span>
          <span className="text-[11px] text-zinc-500">{c.owner}</span>
        </div>
        <p className="mt-1 font-medium">{c.title}</p>
        {c.summary && <p className="text-xs text-zinc-600">{c.summary}</p>}
        {(c.items.length > 0 || c.links.length > 0) && (
          <div className="mt-1 text-xs">
            {c.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="mr-3 text-blue-700 underline">{l.text}</a>)}
            {c.items.length > 0 && <button onClick={() => setMore((v) => !v)} className="text-blue-700 underline">{more ? "Hide details" : `Show ${c.items.length} detail${c.items.length === 1 ? "" : "s"}`}</button>}
            {more && (
              <ul className="mt-1 max-h-72 space-y-0.5 overflow-auto rounded bg-zinc-50 p-2 text-[11px] text-zinc-700">
                {c.items.map((i, n) => <li key={n} className="break-words">{i.href ? <a href={i.href} target="_blank" rel="noreferrer" className="hover:underline">{i.text}</a> : i.text}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="text-xs">
        {auto ? (
          <p className="flex items-center gap-1.5 font-medium text-green-700"><span aria-hidden>✓</span> Signed off: {AUTO_SIGNER}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={s?.name || name} onChange={(e) => { setName(e.target.value); if (s) onSign(e.target.value || null); }}
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1" aria-label="Checked by">
              <option value="">Checked by…</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label className={`flex items-center gap-1.5 ${!(s?.name || name) ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={!!s} disabled={!(s?.name || name)} onChange={(e) => onSign(e.target.checked ? (s?.name || name) : null)} className="h-4 w-4 accent-green-600" />
              Done
            </label>
            {s && <p className="basis-full text-[11px] text-green-700">Signed off by {s.name}, {new Date(s.at).toLocaleDateString("en-GB")}{c.state === "fail" ? " (scan still shows problems)" : ""}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
