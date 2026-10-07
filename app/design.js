"use client";

import { useEffect, useRef, useState } from "react";
import { PlayIcon, StopIcon, RefreshIcon, TrashIcon, ChevronDownIcon, ChevronUpIcon, ExternalIcon, CopyIcon, CheckIcon, SpinnerIcon, InfoIcon } from "@/app/icons";
import { CHECK_NAMES } from "@/lib/figma";

// Accessibility checks on Figma designs, before anything is coded.
// One run per Figma link; each run keeps a result per screen (top-level frame).
const RUNS_KEY = "flc-design-v1";
const normKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9.:-]/g, "-");
// Older runs were keyed case-sensitively, so one design could appear twice; fold them together, newest wins.
function dedupe(runs) {
  const out = {};
  for (const [k, r] of Object.entries(runs || {})) {
    const nk = normKey(k);
    if (!out[nk] || String(r.scannedAt || "") >= String(out[nk].scannedAt || "")) out[nk] = { ...r, key: nk, dismissed: { ...(out[nk]?.dismissed || {}), ...(r.dismissed || {}) } };
  }
  return out;
}
const BATCH = 4;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const LEVEL = {
  fail: { label: "Fix", chip: "bg-red-600", ring: "border-red-200 bg-red-50", text: "text-red-700" },
  warn: { label: "Improve", chip: "bg-amber-500", ring: "border-amber-200 bg-amber-50", text: "text-amber-700" },
  check: { label: "Check by eye", chip: "bg-zinc-500", ring: "border-zinc-200 bg-zinc-50", text: "text-zinc-700" },
};
const ORDER = { fail: 0, warn: 1, check: 2 };

export default function DesignArea({ onRunning, onCount }) {
  const [link, setLink] = useState("");
  const [runs, setRuns] = useState({});
  const [openKey, setOpenKey] = useState(null);
  const [running, setRunning] = useState(null);
  const [figma, setFigma] = useState(null); // null unknown, true/false
  const stopRef = useRef(false);
  const sharedRef = useRef(false);
  const syncedRef = useRef({});

  useEffect(() => {
    const t = setTimeout(() => {
      const saved = dedupe(load(RUNS_KEY, {}));
      for (const r of Object.values(saved)) if (r.status === "RUNNING") Object.assign(r, { status: "PAUSED" });
      save(RUNS_KEY, saved);
      setRuns(saved);
      fetch("/api/results?kind=design").then((r) => r.json()).then((j) => {
        if (!j.shared) return;
        sharedRef.current = true;
        setRuns((prev) => {
          const next = { ...prev };
          for (const [key, run] of Object.entries(dedupe(j.results || {}))) {
            if (!prev[key] || prev[key].status === "RUNNING" || String(run.scannedAt || "") >= String(prev[key].scannedAt || "")) { next[key] = { ...run, dismissed: { ...(prev[key]?.dismissed || {}), ...(run.dismissed || {}) } }; syncedRef.current[key] = `${run.scannedAt}|${run.dismissedAt || ""}`; }
          }
          save(RUNS_KEY, next);
          return next;
        });
      }).catch(() => {});
    }, 0);
    fetch("/api/design").then((r) => r.json()).then((j) => setFigma(!!j.configured)).catch(() => setFigma(false));
    return () => clearTimeout(t);
  }, []);

  const patch = (key, fields) => setRuns((prev) => {
    const next = { ...prev, [key]: { ...(prev[key] || {}), ...fields } };
    save(RUNS_KEY, next);
    const run = next[key];
    const mark = `${run.scannedAt}|${run.dismissedAt || ""}`;
    if (sharedRef.current && run.status === "DONE" && run.scannedAt && syncedRef.current[key] !== mark) {
      syncedRef.current[key] = mark;
      fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "design", site: key, data: run }) }).catch(() => {});
    }
    return next;
  });

  const outstanding = Object.values(runs).filter((r) => r.status === "DONE").reduce((n, r) => n + (r.screens || []).reduce((m, s) => m + (s.findings || []).filter((f) => f.level === "fail" && !r.dismissed?.[findingKey(f)]).length, 0), 0);
  const dismiss = (key, keys, reason) => patch(key, { dismissed: { ...(runs[key]?.dismissed || {}), ...Object.fromEntries(keys.map((k) => [k, reason ? { reason, at: new Date().toISOString() } : undefined])) }, dismissedAt: new Date().toISOString() });
  useEffect(() => { onCount?.(outstanding); }, [outstanding, onCount]);

  async function post(body) {
    const r = await fetch("/api/design", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  // Key a run by file + node so a page/frame link and the whole file are separate runs.
  // Keys must survive the shared store, which lower-cases them and strips "#", so the
  // key is lower-case with "-" (the real, case-sensitive link is stored on the run).
  function keyFor(input) {
    try { const u = new URL(input.trim()); const m = u.pathname.match(/\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/); if (!m) return ""; const n = u.searchParams.get("node-id"); return normKey(n ? `${m[1]}#${n}` : m[1]); } catch { return ""; }
  }

  async function runCheck(input, { resume = false } = {}) {
    const key = keyFor(input);
    if (!key) return;
    stopRef.current = false;
    setRunning(key); onRunning?.(true); setOpenKey(key);
    const prev = load(RUNS_KEY, {})[key];
    let w = resume && prev?.work ? prev.work : null;
    try {
      if (!w) {
        patch(key, { key, link: input.trim(), status: "RUNNING", phase: "Reading the Figma file…", screens: [], error: "" });
        const s = await post({ step: "start", link: input });
        w = { fileKey: s.fileKey, nodeId: s.nodeId, name: s.name, queue: s.frames, screens: [] };
        patch(key, { name: s.name, fileKey: s.fileKey, total: s.frames.length, lastModified: s.lastModified || "", figmaVersion: s.version || "", work: w });
      } else {
        patch(key, { status: "RUNNING", error: "" });
      }
      while (w.queue.length) {
        if (stopRef.current) { patch(key, { status: "PAUSED", phase: "", work: w }); return; }
        const batch = w.queue.slice(0, BATCH);
        patch(key, { phase: `Checking screen ${w.screens.length + 1} of ${w.screens.length + w.queue.length}: ${batch[0].name}` });
        const j = await post({ step: "frames", fileKey: w.fileKey, ids: batch.map((f) => f.id) });
        for (const res of j.results || []) { const meta = batch.find((f) => f.id === res.id); w.screens.push({ ...res, page: meta?.page || "" }); }
        w.queue = w.queue.slice(BATCH);
        patch(key, { screens: w.screens, work: w });
      }
      // Licence check on every font the design uses.
      patch(key, { phase: "Checking font licences…" });
      const fams = [...new Set(w.screens.flatMap((s) => (s.fonts || []).map((f) => f.family)))];
      let fontChecks = [];
      try { fontChecks = (await post({ step: "fonts", families: fams })).fonts || []; } catch {}
      patch(key, { status: "DONE", phase: "", scannedAt: new Date().toISOString(), screens: w.screens, fontChecks, work: null });
    } catch (e) {
      patch(key, { status: "ERROR", phase: "", error: String(e?.message || e), work: w });
    } finally {
      setRunning(null); onRunning?.(false);
    }
  }

  function remove(key) {
    setRuns((prev) => { const next = { ...prev }; delete next[key]; save(RUNS_KEY, next); return next; });
    if (sharedRef.current) fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "design", site: key }) }).catch(() => {});
  }

  const list = Object.values(runs).sort((a, b) => String(b.scannedAt || "").localeCompare(String(a.scannedAt || "")));
  return (
    <div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Design Checks</h2>
        <p className="mt-1 text-sm text-zinc-600">Paste a Figma file, page or frame link. Every screen is checked for colour contrast, text size, line height, tap target size and link wording, and every font used is checked against Google Fonts and Adobe Fonts so licences are sorted before build.</p>
        {figma === false && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Figma is not connected yet. Add the token in Settings → Figma.</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (!running && link.trim()) runCheck(link); }} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={link} onChange={(e) => setLink(e.target.value)} disabled={!!running} placeholder="https://www.figma.com/design/…" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          {running
            ? <button type="button" onClick={() => { stopRef.current = true; }} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white"><StopIcon className="h-4 w-4" /> Stop</button>
            : <button type="submit" disabled={!link.trim() || figma === false} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><PlayIcon className="h-4 w-4" /> Check design</button>}
        </form>
      </div>

      <div className="mt-4 space-y-3">
        {list.map((r) => (
          <DesignCard key={r.key} r={r} open={openKey === r.key} toggle={() => setOpenKey(openKey === r.key ? null : r.key)}
            running={running === r.key} busy={!!running}
            onRescan={() => runCheck(r.link)} onResume={() => runCheck(r.link, { resume: true })} onRemove={() => remove(r.key)} onDismiss={(keys, reason) => dismiss(r.key, keys, reason)} />
        ))}
        {!list.length && <p className="text-sm text-zinc-500">No designs checked yet.</p>}
      </div>
    </div>
  );
}

function DesignCard({ r, open, toggle, running, busy, onRescan, onResume, onRemove, onDismiss }) {
  const [asking, setAsking] = useState(false);
  const screens = r.screens || [];
  const dismissed = r.dismissed || {};
  const counts = { fail: 0, warn: 0, check: 0 };
  let hidden = 0;
  for (const s of screens) for (const f of s.findings || []) { if (dismissed[findingKey(f)]) hidden++; else counts[f.level] = (counts[f.level] || 0) + 1; }
  const done = r.status === "DONE";
  const pct = r.total ? Math.round((screens.length / r.total) * 100) : 0;
  const fonts = new Map();
  for (const s of screens) for (const f of s.fonts || []) { if (!fonts.has(f.family)) fonts.set(f.family, new Set()); f.styles.forEach((x) => fonts.get(f.family).add(x)); }
  const tone = counts.fail ? "border-red-200" : counts.warn ? "border-amber-200" : "border-zinc-200";
  return (
    <div className={`rounded-xl border bg-white shadow-sm ${tone}`}>
      <div className="flex items-stretch">
        <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-4 py-3 text-left">
          {running ? <span className="text-blue-600"><SpinnerIcon className="h-5 w-5" /></span>
            : done ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${counts.fail ? "bg-red-600" : counts.warn ? "bg-amber-500" : "bg-green-600"}`}>{counts.fail ? `${counts.fail} TO FIX` : counts.warn ? `${counts.warn} TO IMPROVE` : "FINE"}</span>
            : <span className="rounded-full bg-zinc-500 px-2 py-0.5 text-[11px] font-semibold text-white">{r.status === "ERROR" ? "COULD NOT CHECK" : "PAUSED"}</span>}
          <span className="font-medium">{r.name || r.key}</span>
          <span className="text-xs text-zinc-500">{screens.length} screen{screens.length === 1 ? "" : "s"}{r.total && !done ? ` of ${r.total}` : ""}</span>
          {done && <span className="text-xs text-zinc-500">{counts.fail} to fix · {counts.warn} to improve · {counts.check} to check by eye{hidden ? ` · ${hidden} done or ignored` : ""}</span>}
          {r.phase && <span className="basis-full text-xs text-blue-700">{r.phase}</span>}
          {r.error && <span className="basis-full text-xs text-red-700">{r.error}</span>}
          <span className="ml-auto text-zinc-400">{open ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>
        </button>
        {asking ? (
          <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 text-xs">
            <button onClick={onRemove} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white"><TrashIcon className="h-3.5 w-3.5" /> Delete</button>
            <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100">Keep</button>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} disabled={running} aria-label="Delete" className="shrink-0 px-3 py-3.5 text-zinc-400 hover:text-red-600 disabled:opacity-30"><TrashIcon /></button>
        )}
      </div>
      {running && <div className="px-4 pb-3"><div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} /></div></div>}
      {open && !running && (
        <div className="border-t border-zinc-100 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <a href={r.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">Open in Figma <ExternalIcon /></a>
            {r.scannedAt && <span className="text-zinc-500">Checked {new Date(r.scannedAt).toLocaleString("en-GB")}</span>}
            {r.lastModified && <span className="text-zinc-500" title="When Figma says the file was last saved; if your edits are newer than this, Figma had not stored them yet when the check ran">· design last saved {new Date(r.lastModified).toLocaleString("en-GB")}</span>}
            <span className="ml-auto flex gap-2">
              {r.status === "PAUSED" && <button onClick={onResume} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white disabled:opacity-40"><PlayIcon className="h-3.5 w-3.5" /> Finish check</button>}
              <button onClick={onRescan} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" /> Check again</button>
            </span>
          </div>
          {fonts.size > 0 && (
            <div className="mb-3 rounded-lg border border-zinc-200 p-3 text-sm">
              <div className="font-medium">Font licences</div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {[...fonts.entries()].sort().map(([fam, styles]) => {
                    const c = (r.fontChecks || []).find((x) => x.family.toLowerCase() === fam.toLowerCase().replace(/[-_](bold|regular|medium|light|italic|black|thin|semibold|extrabold|heavy)$/i, ""));
                    const tone = { free: "bg-green-100 text-green-800", paid: "bg-red-100 text-red-800", check: "bg-amber-100 text-amber-800" }[c?.status] || "bg-zinc-100 text-zinc-600";
                    return (
                      <tr key={fam} className="border-t border-zinc-100 align-top">
                        <td className="py-1 pr-2 whitespace-nowrap"><span className="font-medium">{fam}</span> <span className="text-zinc-500">{[...styles].join(", ")}</span></td>
                        <td className="py-1 pr-2 whitespace-nowrap">{c ? (c.link ? <a href={c.link} target="_blank" rel="noreferrer" className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>{c.label} ↗</a> : <span className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>{c.label}</span>) : <span className="text-zinc-400">Not checked yet, run Check again</span>}</td>
                        <td className="py-1 text-zinc-600">{c?.note}{c?.searchGoogle && <> <a href={c.searchGoogle} target="_blank" rel="noreferrer" className="text-blue-700 underline">Search Google Fonts</a></>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="space-y-2">
            {screens.slice().sort((a, b) => score(b, dismissed) - score(a, dismissed)).map((s) => <ScreenRow key={s.id} s={s} dismissed={dismissed} onDismiss={onDismiss} />)}
          </div>
        </div>
      )}
    </div>
  );
}
// One line per rule with every layer it applies to, so 7 tight paragraphs read as one item.
function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const rule = f.rule || f.text; // older results have text only
    const k = `${f.level}|${f.id}|${rule}`;
    if (!groups.has(k)) groups.set(k, { level: f.level, id: f.id, rule, items: [] });
    const g = groups.get(k);
    const node = f.node || "";
    const key = findingKey(f);
    if (!g.items.some((x) => x.key === key)) g.items.push({ node: node || "Layer", detail: f.detail, href: f.href, key, inInstance: String(f.nodeId || "").startsWith("I") });
  }
  return [...groups.values()];
}
// A finding's identity survives rescans: the check plus the Figma layer id in its link.
const findingKey = (f) => { if (f.nodeId) return `${f.id}|${String(f.nodeId).replace(/:/g, "-")}`; let n = (String(f.href || "").match(/node-id=([^&]+)/) || [])[1] || f.node; try { n = decodeURIComponent(n); } catch {} return `${f.id}|${n}`; };
const score = (s, dismissed = {}) => (s.findings || []).reduce((n, f) => n + (dismissed[findingKey(f)] ? 0 : f.level === "fail" ? 100 : f.level === "warn" ? 10 : 1), 0);

function ScreenRow({ s, dismissed = {}, onDismiss }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [lastAction, setLastAction] = useState(null); // {keys, label} for a one-click undo
  const act = (keys, reason, label) => { onDismiss(keys, reason); setLastAction({ keys, label }); };
  const all = (s.findings || []).slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const findings = all.filter((f) => !dismissed[findingKey(f)]);
  const doneList = all.filter((f) => dismissed[findingKey(f)]);
  const groups = groupFindings(findings);
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const byCheck = {};
  for (const f of findings) byCheck[f.id] = (byCheck[f.id] || 0) + 1;
  const tone = fails ? LEVEL.fail : warns ? LEVEL.warn : findings.length ? LEVEL.check : { ring: "border-green-200 bg-green-50", text: "text-green-700" };
  async function copy() {
    const text = `${s.name}\n${groupFindings(findings).map((g, i) => `${i + 1}. [${LEVEL[g.level].label}] ${g.rule}\n${g.items.map((f) => `   - ${f.node}${f.detail ? ` (${f.detail})` : ""}: ${f.href}`).join("\n")}`).join("\n")}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className={`rounded-lg border p-3 ${tone.ring}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`inline-flex items-center ${tone.text}`}><InfoIcon /></span>
        <a href={s.href} target="_blank" rel="noreferrer" className="font-medium hover:underline">{s.name}</a>
        {s.page && <span className="text-xs text-zinc-500">{s.page}</span>}
        <span className="text-xs text-zinc-500">{s.width}×{s.height}</span>
        <span className="ml-auto text-xs">
          {findings.length ? Object.entries(byCheck).map(([id, n]) => <span key={id} className="ml-1 rounded bg-white/80 px-1.5 py-0.5 ring-1 ring-zinc-200">{n} {CHECK_NAMES[id] || id}</span>) : <span className="text-green-700">{doneList.length ? "All done or ignored" : "Nothing found"}</span>}
          {doneList.length > 0 && <button onClick={() => setShowDone((v) => !v)} className="ml-1 text-zinc-500 underline">{showDone ? "Hide" : "Show"} {doneList.length} done/ignored</button>}
        </span>
      </div>
      {lastAction && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900">
          <span>{lastAction.label}.</span>
          <button onClick={() => { onDismiss(lastAction.keys, null); setLastAction(null); }} className="font-semibold underline">Undo</button>
          <button onClick={() => setLastAction(null)} aria-label="Dismiss" className="ml-auto text-blue-400 hover:text-blue-900">✕</button>
        </div>
      )}
      {(findings.length > 0 || doneList.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {findings.length > 0 && <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100">{show ? <><ChevronUpIcon className="h-3.5 w-3.5" /> Hide {groups.length} detail{groups.length === 1 ? "" : "s"}</> : <><ChevronDownIcon className="h-3.5 w-3.5" /> Show {groups.length} detail{groups.length === 1 ? "" : "s"}</>}</button>}
          {findings.length > 0 && <button onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy for the designer</>}</button>}
          {doneList.length > 0 && <button onClick={() => { onDismiss(doneList.map((f) => findingKey(f)), null); setLastAction(null); }} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">Restore all {doneList.length} done/ignored</button>}
        </div>
      )}
      {show && findings.length > 0 && (
        <ol className="mt-2 list-decimal space-y-2 rounded-md bg-white/70 py-2 pl-7 pr-3 text-sm">
          {groups.map((g, i) => (
            <li key={i} className="pl-1">
              <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${LEVEL[g.level].chip}`}>{LEVEL[g.level].label}</span>
              {g.rule}
              <span className="ml-1 text-xs text-zinc-500">{g.items.length} layer{g.items.length === 1 ? "" : "s"}</span>
              <span className="ml-2 inline-flex gap-1 text-[11px]">
                <button onClick={() => act(g.items.map((f) => f.key), "done", `${g.items.length} marked done`)} title="Mark every layer in this line as fixed; it stays hidden on rescans" className="rounded border border-green-300 bg-white px-1.5 py-0.5 text-green-800 hover:bg-green-50">✓ All done</button>
                <button onClick={() => act(g.items.map((f) => f.key), "ignore", `${g.items.length} ignored`)} title="Not a real problem here; hidden on rescans" className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-100">Ignore all</button>
              </span>
              <ul className="mt-1 flex flex-wrap gap-1">
                {g.items.map((f, j) => (
                  <li key={j} className="inline-flex max-w-sm items-stretch rounded border border-zinc-200 bg-white text-xs">
                    <a href={f.href} target="_blank" rel="noreferrer" title={f.inInstance ? "Inside a component instance: Figma can only select the instance, so the link opens that and this layer is inside it" : "Open in Figma"} className="inline-flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-blue-700 hover:bg-blue-50"><span className="truncate">{f.node}</span>{f.detail ? <span className="shrink-0 text-zinc-500">· {f.detail}</span> : null}<span className="shrink-0"><ExternalIcon /></span></a>
                    <button onClick={() => act([f.key], "done", "1 marked done")} title="Done (fixed)" className="border-l border-zinc-200 px-1.5 text-green-700 hover:bg-green-50">✓</button>
                    <button onClick={() => act([f.key], "ignore", "1 ignored")} title="Ignore this one" className="border-l border-zinc-200 px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">✕</button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {showDone && doneList.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1 rounded-md bg-white/70 p-2 text-xs">
          {doneList.map((f, i) => (
            <li key={i} className="inline-flex max-w-sm items-stretch rounded border border-zinc-200 bg-white line-through decoration-zinc-400">
              <span className="inline-flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-zinc-500"><span className={`mr-1 rounded px-1 text-[10px] no-underline ${dismissed[findingKey(f)].reason === "done" ? "bg-green-100 text-green-800" : "bg-zinc-100 text-zinc-600"}`}>{dismissed[findingKey(f)].reason === "done" ? "Done" : "Ignored"}</span><span className="truncate">{f.node || f.text}</span></span>
              <button onClick={() => onDismiss([findingKey(f)], null)} title="Put it back" className="border-l border-zinc-200 px-1.5 text-blue-700 hover:bg-blue-50">undo</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
