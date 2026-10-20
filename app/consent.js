"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayIcon, StopIcon, RefreshIcon, CopyIcon, CheckIcon, ExternalIcon, SearchIcon } from "@/app/icons";

// Cookie consent: does each client site's tracking wait for its cookie banner? One site per
// request (homepage + Tag Manager container); the browser drives the queue, four at a time.
const KEY = "flc-consent-v1";
const BATCH = 4;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const host = (s) => String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

const STATUS = {
  GAP: ["Fires before consent", "bg-red-600 text-white", 0],
  NO_BANNER: ["No cookie banner", "bg-amber-500 text-white", 1],
  UNREACHABLE: ["Couldn't check", "bg-purple-600 text-white", 2],
  OK: ["Waits for consent", "bg-green-600 text-white", 3],
  NO_TRACKING: ["No tracking", "bg-zinc-400 text-white", 4],
  RUNNING: ["Checking…", "bg-blue-500 text-white", 5],
};
const FILTERS = [["ALL", "All"], ["GAP", "Fires before consent"], ["NO_BANNER", "No banner"], ["OK", "Waits for consent"], ["UNREACHABLE", "Couldn't check"]];

function Brief({ text }) {
  const [done, setDone] = useState(false);
  return <button onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 2500); }} title={text} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">{done ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy developer brief</>}</button>;
}

export default function ConsentArea({ clients = [], onRunning, onCount }) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [one, setOne] = useState("");
  const stopRef = useRef(false);
  const sharedRef = useRef(false);

  // Every website on the client list (Settings → Clients), with who looks after it.
  const clientSites = useMemo(() => {
    const out = new Map();
    for (const c of clients) for (const w of c.websites || []) { const h = host(w); if (h.includes(".") && !out.has(h)) out.set(h, { client: c.name || "", manager: c.manager || "" }); }
    return out;
  }, [clients]);

  useEffect(() => {
    const t = setTimeout(() => {
      const saved = load();
      for (const r of Object.values(saved)) if (r.status === "RUNNING") r.status = "UNREACHABLE";
      setResults(saved);
      fetch("/api/results?kind=consent").then((r) => r.json()).then((j) => {
        if (!j.shared) return;
        sharedRef.current = true;
        setResults((prev) => { const next = { ...prev }; for (const [k, v] of Object.entries(j.results || {})) if (!prev[k] || String(v.checkedAt || "") > String(prev[k].checkedAt || "")) next[k] = v; save(next); return next; });
      }).catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const gaps = Object.values(results).filter((r) => r.status === "GAP").length;
  useEffect(() => { onCount?.(gaps || null); }, [gaps, onCount]);
  useEffect(() => { onRunning?.(running); }, [running, onRunning]);

  const put = (site, r) => setResults((prev) => { const next = { ...prev, [site]: r }; save(next); return next; });
  async function checkOne(site) {
    put(site, { ...(results[site] || {}), site, status: "RUNNING" });
    let r;
    try { r = await fetch(`/api/consent?site=${encodeURIComponent(site)}`).then((x) => x.json()); } catch (e) { r = { site, status: "UNREACHABLE", summary: String(e?.message || e), checkedAt: new Date().toISOString() }; }
    if (r.error) r = { site, status: "UNREACHABLE", summary: r.error, checkedAt: new Date().toISOString() };
    put(site, r);
    fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "consent", site, data: r }) }).catch(() => {});
  }
  async function runAll(list) {
    stopRef.current = false; setRunning(true);
    const queue = [...list];
    await Promise.all(Array.from({ length: BATCH }, async () => { while (queue.length && !stopRef.current) await checkOne(queue.shift()); }));
    setRunning(false);
  }

  const rows = useMemo(() => {
    const sites = new Set([...clientSites.keys(), ...Object.keys(results)]);
    return [...sites].map((s) => ({ site: s, ...(clientSites.get(s) || {}), r: results[s] }))
      .filter((x) => filter === "ALL" || x.r?.status === filter)
      .sort((a, b) => (STATUS[a.r?.status]?.[2] ?? 6) - (STATUS[b.r?.status]?.[2] ?? 6) || a.site.localeCompare(b.site));
  }, [clientSites, results, filter]);
  const count = (k) => Object.values(results).filter((r) => r.status === k).length;
  const unchecked = [...clientSites.keys()].filter((s) => !results[s] || results[s].status === "UNREACHABLE");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Cookie consent</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">Does each site&apos;s tracking (GA4, Tag Manager, ad pixels) wait for the visitor to accept cookies? Checked from the page code and the site&apos;s Tag Manager container, free. Where it doesn&apos;t, copy the developer brief. Always confirm in a private window.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {running
            ? <button onClick={() => { stopRef.current = true; }} className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
            : <>
              <button onClick={() => runAll([...clientSites.keys()])} disabled={!clientSites.size} title="Every website on the client list (Settings → Clients)" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><PlayIcon className="h-4 w-4" /> Check all {clientSites.size} client websites</button>
              {unchecked.length > 0 && unchecked.length < clientSites.size && <button onClick={() => runAll(unchecked)} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100">Only the {unchecked.length} not checked yet</button>}
            </>}
          <form onSubmit={(e) => { e.preventDefault(); const h = host(one); if (h.includes(".")) { checkOne(h); setOne(""); } }} className="ml-auto flex items-center gap-1.5">
            <input value={one} onChange={(e) => setOne(e.target.value)} placeholder="Check one site, e.g. example.co.uk" className="w-64 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" aria-label="Website to check" />
            <button className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100"><SearchIcon className="h-4 w-4" /> Check</button>
          </form>
        </div>
        {!clientSites.size && <p className="mt-2 text-xs text-zinc-500">No client websites yet: add them in Settings → Clients.</p>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => { const n = k === "ALL" ? rows.length : count(k); return (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{label}{k !== "ALL" && n ? ` ${n}` : ""}</button>); })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Website</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">What we found</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(({ site, client, manager, r }) => (
              <tr key={site} className="align-top">
                <td className="px-3 py-2"><a href={`https://${site}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-zinc-900 hover:underline">{site} <ExternalIcon /></a>
                  {(client || manager) && <div className="text-xs text-zinc-500">{[client, manager].filter(Boolean).join(" · ")}</div>}</td>
                <td className="px-3 py-2">{r ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[r.status]?.[1] || "bg-zinc-200"}`}>{STATUS[r.status]?.[0] || r.status}</span> : <span className="text-xs text-zinc-400">Not checked</span>}</td>
                <td className="px-3 py-2 text-xs text-zinc-700">{r?.summary}{r?.bannerName && r.status !== "GAP" ? <span className="text-zinc-500"> Banner: {r.bannerName}.</span> : null}{r?.checkedAt && <div className="mt-0.5 text-[11px] text-zinc-400">Checked {new Date(r.checkedAt).toLocaleDateString("en-GB")}</div>}</td>
                <td className="px-3 py-2"><div className="flex items-center justify-end gap-2">{r?.ticket && <Brief text={r.ticket} />}
                  <button onClick={() => checkOne(site)} disabled={r?.status === "RUNNING"} aria-label={`Check ${site} again`} title="Check again" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"><RefreshIcon className="h-4 w-4" /></button></div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-zinc-500">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
