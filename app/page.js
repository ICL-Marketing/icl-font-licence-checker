"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SITES } from "@/data/sites";

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
  // image tab
  PAID: { text: "text-red-700", bg: "bg-red-50", border: "border-red-500", chip: "bg-red-600" },
  FREE: { text: "text-green-700", bg: "bg-green-50", border: "border-green-500", chip: "bg-green-600" },
  CLEAN: { text: "text-zinc-500", bg: "bg-zinc-100", border: "border-zinc-400", chip: "bg-zinc-500" },
};
const STORAGE_KEY = "flc-results-v1";

function normalise(s) {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
const isFreeLib = (flag) => /free/i.test(flag || "");
function imageStatus(r) {
  const flagged = (r.images || []).filter((i) => i.flag);
  if (!flagged.length) return "CLEAN";
  return flagged.some((i) => !isFreeLib(i.flag)) ? "PAID" : "FREE";
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_SITES.join("\n"));
  const [pages, setPages] = useState(4);
  const [parallel, setParallel] = useState(4);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("fonts");
  const [filter, setFilter] = useState("ALL");
  const [imgFilter, setImgFilter] = useState("ALL");
  const [open, setOpen] = useState({});
  const [exporting, setExporting] = useState(false);
  const [showList, setShowList] = useState(true);
  const stopRef = useRef(false);
  const router = useRouter();

  // Restore last run from this browser
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.results) {
        setResults(saved.results);
        if (saved.text) setText(saved.text);
        setShowList(false);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (Object.keys(results).length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ results, text }));
    } catch {}
  }, [results, text]);

  const sites = useMemo(() => [...new Set(text.split(/\r?\n|,/).map(normalise).filter((s) => s.includes(".")))], [text]);

  async function scanOne(site) {
    setResults((r) => ({ ...r, [site]: { site, status: "RUNNING", fonts: [], images: [] } }));
    try {
      const r = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site, pages }),
      });
      if (r.status === 401) { stopRef.current = true; router.push("/login"); return; }
      const data = await r.json();
      setResults((prev) => ({ ...prev, [site]: data }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [site]: { site, status: "UNREACHABLE", fonts: [], images: [], error: `Request failed: ${e.message}` } }));
    }
  }

  async function run(list) {
    stopRef.current = false;
    setRunning(true);
    setShowList(false);
    const queue = [...list];
    const workers = Array.from({ length: Math.max(1, parallel) }, async () => {
      while (queue.length && !stopRef.current) {
        const site = queue.shift();
        await scanOne(site);
      }
    });
    await Promise.all(workers);
    setRunning(false);
  }

  function runAll() { setResults({}); run(sites); }
  function rerun(site) { run([site]); }
  function stop() { stopRef.current = true; }
  function clearAll() {
    setResults({});
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setShowList(true);
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: ordered.filter((x) => x.status !== "RUNNING") }),
      });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `font-licence-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  const ordered = useMemo(() => {
    const list = Object.values(results);
    return list.sort((a, b) => (ORDER[b.status] ?? -1) - (ORDER[a.status] ?? -1) || a.site.localeCompare(b.site));
  }, [results]);

  const counts = useMemo(() => {
    const c = { PROBLEM: 0, CHECK: 0, UNREACHABLE: 0, OK: 0, SYSTEM: 0, RUNNING: 0 };
    for (const r of ordered) if (c[r.status] != null) c[r.status]++;
    return c;
  }, [ordered]);

  const imgOrdered = useMemo(() => {
    const rank = { PAID: 2, FREE: 1, CLEAN: 0 };
    return ordered
      .filter((r) => r.status !== "RUNNING" && r.status !== "UNREACHABLE")
      .map((r) => ({ r, s: imageStatus(r), flagged: (r.images || []).filter((i) => i.flag) }))
      .sort((a, b) => rank[b.s] - rank[a.s] || b.flagged.length - a.flagged.length || a.r.site.localeCompare(b.r.site));
  }, [ordered]);
  const imgCounts = useMemo(() => {
    const c = { PAID: 0, FREE: 0, CLEAN: 0, images: 0 };
    for (const x of imgOrdered) { c[x.s]++; c.images += x.flagged.filter((i) => !isFreeLib(i.flag)).length; }
    return c;
  }, [imgOrdered]);

  const done = ordered.filter((r) => r.status !== "RUNNING").length;
  const total = running ? sites.length : ordered.length;
  const visible = ordered.filter((r) => filter === "ALL" || r.status === filter);
  const imgVisible = imgOrdered.filter((x) => imgFilter === "ALL" ? x.s !== "CLEAN" : x.s === imgFilter);

  const tabBtn = (id, label, count) => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium ${tab === id ? "border-zinc-300 bg-white text-zinc-900" : "border-transparent bg-transparent text-zinc-500 hover:text-zinc-800"}`}
    >
      {label}{count != null && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{count}</span>}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Font &amp; image licence checker</h1>
          <p className="text-sm text-zinc-500">
            One scan, two separate tasks: fonts (commercial fonts self-hosted on our sites, the Glosrose / Paratype pattern) and stock images.
          </p>
        </div>
        <div className="flex gap-2">
          {ordered.length > 0 && (
            <button onClick={exportXlsx} disabled={exporting} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50">
              {exporting ? "Building…" : "Download task tracker (Excel)"}
            </button>
          )}
          {ordered.length > 0 && !running && (
            <button onClick={clearAll} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100">Clear</button>
          )}
          {running ? (
            <button onClick={stop} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
          ) : (
            <button onClick={runAll} disabled={!sites.length} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Run check on {sites.length} site{sites.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </header>

      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <button onClick={() => setShowList((v) => !v)} className="flex w-full items-center justify-between text-left text-sm font-medium">
          <span>Sites to check ({sites.length})</span>
          <span className="text-zinc-400">{showList ? "Hide" : "Show"}</span>
        </button>
        {showList && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
            <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={running} rows={10} spellCheck={false}
              className="w-full rounded-md border border-zinc-300 p-2 font-mono text-xs" placeholder="one domain per line" />
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-zinc-600">Pages per site</span>
                <input type="number" min={1} max={10} value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={running} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1" />
                <span className="text-xs text-zinc-400">Homepage plus this many internal links</span>
              </label>
              <label className="block">
                <span className="text-zinc-600">Sites at once</span>
                <input type="number" min={1} max={8} value={parallel} onChange={(e) => setParallel(Number(e.target.value))} disabled={running} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1" />
                <span className="text-xs text-zinc-400">4 is a good default. About 5 to 15s per site.</span>
              </label>
              <button onClick={() => setText(DEFAULT_SITES.join("\n"))} disabled={running} className="text-xs text-zinc-500 underline">Reset to default list</button>
            </div>
          </div>
        )}
      </section>

      {total > 0 && (
        <section className="mt-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-zinc-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {running ? `Scanning… ${done} of ${total} done` : `${done} site${done === 1 ? "" : "s"} scanned`}
          </p>

          <div className="mt-5 flex gap-1 border-b border-zinc-300">
            {tabBtn("fonts", "Task 1 · Fonts", counts.PROBLEM + counts.CHECK)}
            {tabBtn("images", "Task 2 · Stock images", imgCounts.PAID)}
          </div>

          {tab === "fonts" && (
            <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {["PROBLEM", "CHECK", "UNREACHABLE", "OK", "SYSTEM"].map((s) => (
                  <button key={s} onClick={() => setFilter(filter === s ? "ALL" : s)}
                    className={`rounded-xl border p-3 text-left ${COLOUR[s].bg} ${filter === s ? COLOUR[s].border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR[s].text}`}>{counts[s]}</div>
                    <div className={`text-xs font-medium ${COLOUR[s].text}`}>{LABEL[s]}</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">
                      {s === "PROBLEM" && "Commercial font on our own server"}
                      {s === "CHECK" && "Needs a human: subscription or unknown file"}
                      {s === "UNREACHABLE" && "Site down, blocking the scanner, or timed out"}
                      {s === "OK" && "Google Fonts, Adobe Fonts kit or open licence"}
                      {s === "SYSTEM" && "System fonts only"}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-5 space-y-3">
                {visible.map((r) => (
                  <SiteCard key={r.site} r={r} open={!!open["f:" + r.site]} toggle={() => setOpen((o) => ({ ...o, ["f:" + r.site]: !o["f:" + r.site] }))} rerun={() => rerun(r.site)} running={running} />
                ))}
                {!visible.length && <p className="text-sm text-zinc-500">Nothing in this group.</p>}
              </div>
            </div>
          )}

          {tab === "images" && (
            <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["PAID", "Sites with paid-library images", "Shutterstock, iStock, Getty, Adobe Stock… find the licence or replace"],
                  ["FREE", "Free-library images only", "Unsplash, Pexels, Pixabay: no licence needed"],
                  ["CLEAN", "No stock flags", "Nothing matched on the pages scanned"],
                ].map(([s, title, sub]) => (
                  <button key={s} onClick={() => setImgFilter(imgFilter === s ? "ALL" : s)}
                    className={`rounded-xl border p-3 text-left ${COLOUR[s].bg} ${imgFilter === s ? COLOUR[s].border : "border-transparent"}`}>
                    <div className={`text-3xl font-semibold ${COLOUR[s].text}`}>{imgCounts[s]}</div>
                    <div className={`text-xs font-medium ${COLOUR[s].text}`}>{title}</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">{sub}</div>
                  </button>
                ))}
                <div className="rounded-xl border border-transparent bg-zinc-50 p-3 text-left">
                  <div className="text-3xl font-semibold text-zinc-700">{imgCounts.images}</div>
                  <div className="text-xs font-medium text-zinc-700">Paid-library images found</div>
                  <div className="mt-1 text-[11px] leading-tight text-zinc-500">Across all scanned sites</div>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">Flags come from file names (e.g. shutterstock_123.jpg) and embedded copyright / credit tags. The scanner cannot tell whether an image was paid for, so treat this as a list to check against purchase records.</p>
              <div className="mt-4 space-y-3">
                {imgVisible.map(({ r, s, flagged }) => (
                  <ImageCard key={r.site} r={r} s={s} flagged={flagged} open={!!open["i:" + r.site]} toggle={() => setOpen((o) => ({ ...o, ["i:" + r.site]: !o["i:" + r.site] }))} />
                ))}
                {!imgVisible.length && <p className="text-sm text-zinc-500">{imgFilter === "ALL" ? "No stock-image flags on any scanned site." : "Nothing in this group."}</p>}
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="mt-10 text-xs text-zinc-400">
        <p>PROBLEM means investigate, not guilty. Fonts loaded only by JavaScript, or on deep pages, can be missed. Image flags are filename and metadata only; cross-check against purchase records.</p>
      </footer>
    </main>
  );
}

function SiteCard({ r, open, toggle, rerun, running }) {
  const c = COLOUR[r.status] || COLOUR.PENDING;
  const fonts = r.fonts || [];
  const problems = fonts.filter((f) => f.status === "PROBLEM");
  const checks = fonts.filter((f) => f.status === "CHECK");
  const oks = fonts.filter((f) => f.status === "OK");
  const headline = r.status === "RUNNING"
    ? "Scanning…"
    : r.error
      ? r.error
      : problems.length
        ? [...new Set(problems.map((f) => f.family))].join(", ")
        : checks.length
          ? [...new Set(checks.map((f) => f.family))].join(", ")
          : fonts.length
            ? `${oks.length} font${oks.length === 1 ? "" : "s"} OK`
            : r.ignoredFonts?.length
              ? "Only icon/UI fonts (ignored)"
              : "No web fonts found";

  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm ring-1 ring-zinc-100 ${c.border}`}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{LABEL[r.status] || r.status}</span>
        <span className="font-medium">{r.site}</span>
        {r.platform && <span className="text-xs text-zinc-400">{r.platform}</span>}
        <span className="basis-full text-sm text-zinc-600 sm:basis-auto sm:flex-1 sm:truncate">{headline}</span>
        {r.status !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
      </button>
      {open && r.status !== "RUNNING" && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          {r.error && <p className={`mb-2 ${r.status === "UNREACHABLE" ? "text-purple-700" : "text-red-700"}`}>{r.error}</p>}
          {r.fix && <p className="mb-2 text-sm"><b>Suggested fix:</b> {r.fix}</p>}
          {fonts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Font</th>
                    <th className="py-1 pr-2">How loaded</th>
                    <th className="py-1 pr-2">Why</th>
                    <th className="py-1 pr-2">On Adobe Fonts?</th>
                    <th className="py-1 pr-2">Suggested fix</th>
                    <th className="py-1">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {[...fonts].sort((a, b) => ORDER[b.status] - ORDER[a.status]).map((f, i) => {
                    const fc = COLOUR[f.status] || COLOUR.PENDING;
                    return (
                      <tr key={i} className={`border-t border-zinc-100 align-top ${fc.bg}`}>
                        <td className={`py-1.5 pr-2 font-semibold ${fc.text}`}>{f.status}</td>
                        <td className="py-1.5 pr-2">{f.family}{f.otherFiles > 0 && <span className="text-zinc-400"> +{f.otherFiles} more file{f.otherFiles === 1 ? "" : "s"}</span>}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{f.kind}{f.hostedOn ? ` / ${f.hostedOn}` : ""}</td>
                        <td className="py-1.5 pr-2">{f.note}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {f.status !== "OK" && f.adobe && (
                            <>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${f.adobe === "yes" ? "bg-green-100 text-green-800" : f.adobe === "no" ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-600"}`}>
                                {f.adobe === "yes" ? "Yes" : f.adobe === "no" ? "No" : "Not sure"}
                              </span>
                              <br />
                              <a href={f.adobeSearch} target="_blank" rel="noreferrer" className="text-[11px] text-blue-700 underline">Search Adobe Fonts</a>
                            </>
                          )}
                        </td>
                        <td className={`py-1.5 pr-2 ${f.status === "OK" ? "text-zinc-400" : "font-medium"}`}>{f.fix}</td>
                        <td className="py-1.5">
                          {f.meta?.copyright && <div><i>copyright:</i> {f.meta.copyright.slice(0, 140)}</div>}
                          {f.meta?.manufacturer && <div><i>manufacturer:</i> {f.meta.manufacturer.slice(0, 100)}</div>}
                          {f.meta?.licence && <div><i>licence:</i> {f.meta.licence.slice(0, 140)}</div>}
                          <a href={f.source} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-blue-700 underline">{f.source.slice(0, 160)}</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            {r.finalUrl && <span>Fetched {r.finalUrl}</span>}
            {r.pages?.length > 0 && <span>{r.pages.length} page{r.pages.length === 1 ? "" : "s"}</span>}
            {r.cssCount > 0 && <span>{r.cssCount} stylesheets</span>}
            {r.ignoredFonts?.length > 0 && <span title={r.ignoredFonts.join(", ")}>{r.ignoredFonts.length} icon/UI font{r.ignoredFonts.length === 1 ? "" : "s"} ignored</span>}
            {r.seconds != null && <span>{r.seconds}s</span>}
            {!running && <button onClick={rerun} className="underline">Re-scan</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageCard({ r, s, flagged, open, toggle }) {
  const c = COLOUR[s];
  const libs = [...new Set(flagged.map((i) => i.flag))];
  const label = s === "PAID" ? "PAID LIBRARY" : s === "FREE" ? "FREE LIBRARY" : "NO FLAGS";
  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm ring-1 ring-zinc-100 ${c.border}`}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{label}</span>
        <span className="font-medium">{r.site}</span>
        <span className="basis-full text-sm text-zinc-600 sm:basis-auto sm:flex-1 sm:truncate">
          {flagged.length ? `${flagged.length} image${flagged.length === 1 ? "" : "s"} · ${libs.join(", ")}` : `${r.imagesChecked || 0} images seen, none flagged`}
        </span>
        <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && flagged.length > 0 && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 pr-2">Library</th>
                <th className="py-1 pr-2">Image</th>
                <th className="py-1 pr-2">Embedded credit / copyright</th>
                <th className="py-1">Suggested fix</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 60).map((i, k) => {
                let name = i.url;
                try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
                const free = isFreeLib(i.flag);
                return (
                  <tr key={k} className={`border-t border-zinc-100 align-top ${free ? "bg-green-50" : "bg-red-50"}`}>
                    <td className={`py-1.5 pr-2 font-semibold ${free ? "text-green-700" : "text-red-700"}`}>{i.flag}</td>
                    <td className="py-1.5 pr-2"><a href={i.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-blue-700 underline">{name.slice(0, 80)}</a></td>
                    <td className="py-1.5 pr-2 text-zinc-600">{i.meta ? i.meta.slice(0, 160) : "—"}</td>
                    <td className="py-1.5 font-medium">{free ? "Free library: no licence needed, check attribution rules." : "Find the purchase record / licence. If none, replace the image or buy a licence."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
