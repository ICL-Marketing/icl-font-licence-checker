"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SITES } from "@/data/sites";
import { buildFontEmail, buildImageEmail, isFreeLib } from "@/lib/email";
import { shortFix } from "@/lib/scanner";

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
const MAX_PAGES = 500;

function normalise(s) {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
function paidImages(r) {
  return (r.images || []).filter((i) => i.flag && !isFreeLib(i.flag));
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_SITES.join("\n"));
  const [parallel, setParallel] = useState(4);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null); // null | "fonts" | "images"
  const [tab, setTab] = useState("fonts");
  const [emailTab, setEmailTab] = useState("fonts");
  const [filter, setFilter] = useState("ALL");
  const [open, setOpen] = useState({});
  const [exporting, setExporting] = useState(false);
  const [showList, setShowList] = useState(true);
  const stopRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    if (!saved?.results) return;
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

  const sites = useMemo(() => [...new Set(text.split(/\r?\n|,/).map(normalise).filter((s) => s.includes(".")))], [text]);

  const patch = (site, fields) => setResults((prev) => ({ ...prev, [site]: { ...(prev[site] || { site }), ...fields } }));

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { stopRef.current = true; router.push("/login"); throw new Error("Signed out"); }
    return r.json();
  }

  // ---- Task 1: fonts (homepage + 4 pages)
  async function scanFonts(site) {
    patch(site, { status: "RUNNING", fonts: [], error: "" });
    try {
      const d = await post("/api/scan", { site, pages: 4, mode: "fonts" });
      patch(site, {
        status: d.status, fonts: d.fonts || [], ignoredFonts: d.ignoredFonts || [], error: d.error || "", fix: d.fix || "",
        finalUrl: d.finalUrl, platform: d.platform, cssCount: d.cssCount, fontPages: d.pages?.length || 0, seconds: d.seconds, fontsScannedAt: d.scannedAt,
      });
    } catch (e) {
      patch(site, { status: "UNREACHABLE", fonts: [], error: `Request failed: ${e.message}` });
    }
  }

  // ---- Task 2: images (every page)
  async function scanImages(site) {
    patch(site, { imgStatus: "RUNNING", images: [], imgError: "", imgProgress: "reading sitemap" });
    try {
      const d = await post("/api/scan", { site, pages: 4, mode: "images" });
      if (d.status === "UNREACHABLE") { patch(site, { imgStatus: "UNREACHABLE", imgError: d.error || "", imgFix: d.fix || "", imgProgress: undefined }); return; }
      const queue = [...(d.pageQueue || [])];
      const visited = new Set([...(d.pages || []), ...queue].map((u) => u.replace(/\/$/, "")));
      const images = [...(d.images || [])];
      const seenImg = new Set(images.map((i) => i.url.split("?")[0]));
      let scanned = d.pages?.length || 0;
      let imagesChecked = d.imagesChecked || 0;
      let total = scanned + queue.length;
      patch(site, { imgProgress: `page ${scanned} of ${total}`, images });
      while (queue.length && !stopRef.current) {
        const batch = queue.splice(0, 10);
        const out = await post("/api/scan-pages", { site, urls: batch });
        scanned += (out.done || []).length;
        imagesChecked += out.imagesChecked || 0;
        for (const i of out.images || []) {
          const k = i.url.split("?")[0];
          if (!seenImg.has(k)) { seenImg.add(k); images.push(i); }
        }
        if (out.remaining?.length) queue.unshift(...out.remaining);
        if (!d.hasSitemap) {
          for (const l of out.links || []) {
            const k = l.replace(/\/$/, "");
            if (!visited.has(k) && visited.size < MAX_PAGES) { visited.add(k); queue.push(l); }
          }
        }
        total = scanned + queue.length;
        patch(site, { imgProgress: `page ${scanned} of ${total}`, images: [...images] });
      }
      patch(site, { imgStatus: "DONE", images, imagesChecked, pagesScanned: scanned, pagesTotal: total, hasSitemap: !!d.hasSitemap, imgProgress: undefined, imagesScannedAt: d.scannedAt });
    } catch (e) {
      patch(site, { imgStatus: "UNREACHABLE", imgError: `Request failed: ${e.message}`, imgProgress: undefined });
    }
  }

  async function run(kind, list) {
    stopRef.current = false;
    setRunning(kind);
    setShowList(false);
    setTab(kind);
    const queue = [...list];
    const fn = kind === "fonts" ? scanFonts : scanImages;
    const workers = Array.from({ length: Math.max(1, parallel) }, async () => {
      while (queue.length && !stopRef.current) await fn(queue.shift());
    });
    await Promise.all(workers);
    setRunning(null);
  }
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
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: Object.values(results) }),
      });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `licence-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  const all = useMemo(() => Object.values(results), [results]);

  // Fonts view
  const fontRows = useMemo(() => all.filter((r) => r.status).sort((a, b) => (ORDER[b.status] ?? -1) - (ORDER[a.status] ?? -1) || a.site.localeCompare(b.site)), [all]);
  const fontCounts = useMemo(() => {
    const c = { PROBLEM: 0, CHECK: 0, UNREACHABLE: 0, OK: 0, SYSTEM: 0, RUNNING: 0 };
    for (const r of fontRows) if (c[r.status] != null) c[r.status]++;
    return c;
  }, [fontRows]);
  const fontDone = fontRows.filter((r) => r.status !== "RUNNING").length;
  const fontTotal = running === "fonts" ? sites.length : fontRows.length;
  const fontFine = fontCounts.OK + fontCounts.SYSTEM;
  const fontVisible = fontRows.filter((r) => r.status !== "OK" && r.status !== "SYSTEM" && (filter === "ALL" || r.status === filter));

  // Images view
  const imgRows = useMemo(() => all.filter((r) => r.imgStatus).map((r) => ({ r, paid: paidImages(r) }))
    .sort((a, b) => (b.r.imgStatus === "RUNNING") - (a.r.imgStatus === "RUNNING") || b.paid.length - a.paid.length || a.r.site.localeCompare(b.r.site)), [all]);
  const imgDone = imgRows.filter((x) => x.r.imgStatus !== "RUNNING").length;
  const imgTotal = running === "images" ? sites.length : imgRows.length;
  const imgPaidSites = imgRows.filter((x) => x.paid.length).length;
  const imgUnreachable = imgRows.filter((x) => x.r.imgStatus === "UNREACHABLE").length;
  const imgFine = imgRows.filter((x) => x.r.imgStatus === "DONE" && !x.paid.length).length;
  const imgVisible = imgRows.filter((x) => x.paid.length || x.r.imgStatus !== "DONE");

  const fontEmails = useMemo(() => all.map(buildFontEmail).filter(Boolean).sort((a, b) => a.site.localeCompare(b.site)), [all]);
  const imageEmails = useMemo(() => all.map(buildImageEmail).filter(Boolean).sort((a, b) => a.site.localeCompare(b.site)), [all]);

  const tabBtn = (id, label, count) => (
    <button onClick={() => setTab(id)}
      className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium ${tab === id ? "border-zinc-300 bg-white text-zinc-900" : "border-transparent bg-transparent text-zinc-500 hover:text-zinc-800"}`}>
      {label}{count != null && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{count}</span>}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Font &amp; image licence checker</h1>
          <p className="text-sm text-zinc-500">Two separate checks: fonts (quick, homepage + 4 pages) and stock images (every page). Run either from its tab.</p>
        </div>
        <div className="flex gap-2">
          {all.length > 0 && (
            <button onClick={exportXlsx} disabled={exporting} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50">
              {exporting ? "Building…" : "Download task tracker (Excel)"}
            </button>
          )}
          {all.length > 0 && !running && (
            <button onClick={clearAll} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100">Clear</button>
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

      <section className="mt-5">
        <div className="flex gap-1 border-b border-zinc-300">
          {tabBtn("fonts", "Fonts", fontRows.length ? fontCounts.PROBLEM + fontCounts.CHECK : null)}
          {tabBtn("images", "Stock images", imgRows.length ? imgPaidSites : null)}
          {tabBtn("emails", "Client emails", fontEmails.length + imageEmails.length || null)}
        </div>

        {tab === "fonts" && (
          <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
            <RunBar kind="fonts" done={fontDone} total={fontTotal} label="Run fonts check" running={running} sites={sites} onRun={() => run("fonts", sites)} onStop={stop} />
            {fontRows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {["PROBLEM", "CHECK", "UNREACHABLE"].map((s) => (
                    <button key={s} onClick={() => setFilter(filter === s ? "ALL" : s)}
                      className={`rounded-xl border p-3 text-left ${COLOUR[s].bg} ${filter === s ? COLOUR[s].border : "border-transparent"}`}>
                      <div className={`text-3xl font-semibold ${COLOUR[s].text}`}>{fontCounts[s]}</div>
                      <div className={`text-xs font-medium ${COLOUR[s].text}`}>{LABEL[s]}</div>
                      <div className="mt-1 text-[11px] leading-tight text-zinc-500">
                        {s === "PROBLEM" && "Commercial font on our own server"}
                        {s === "CHECK" && "Needs a human: subscription or unknown file"}
                        {s === "UNREACHABLE" && "Site down, blocking the scanner, or timed out"}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-zinc-600">
                  <span className="font-semibold text-green-700">{fontFine}</span> site{fontFine === 1 ? "" : "s"} fine: fonts are Google Fonts, Adobe Fonts kits, open licence, or system fonts only.
                </p>
                <div className="mt-4 space-y-3">
                  {fontVisible.map((r) => (
                    <SiteCard key={r.site} r={r} open={!!open["f:" + r.site]} toggle={() => setOpen((o) => ({ ...o, ["f:" + r.site]: !o["f:" + r.site] }))} rerun={() => run("fonts", [r.site])} running={!!running} />
                  ))}
                  {!fontVisible.length && <p className="text-sm text-zinc-500">{filter === "ALL" ? "Nothing outstanding." : "Nothing in this group."}</p>}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "images" && (
          <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
            <RunBar kind="images" done={imgDone} total={imgTotal} label="Run images check" running={running} sites={sites} onRun={() => run("images", sites)} onStop={stop} />
            {imgRows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className={`rounded-xl border border-transparent p-3 text-left ${COLOUR.PAID.bg}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.PAID.text}`}>{imgPaidSites}</div>
                    <div className={`text-xs font-medium ${COLOUR.PAID.text}`}>Sites with paid-library images</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">Shutterstock, iStock, Getty, Adobe Stock… find the licence or replace</div>
                  </div>
                  <div className={`rounded-xl border border-transparent p-3 text-left ${COLOUR.UNREACHABLE.bg}`}>
                    <div className={`text-3xl font-semibold ${COLOUR.UNREACHABLE.text}`}>{imgUnreachable}</div>
                    <div className={`text-xs font-medium ${COLOUR.UNREACHABLE.text}`}>COULDN&apos;T CHECK</div>
                    <div className="mt-1 text-[11px] leading-tight text-zinc-500">Site down, blocking the scanner, or timed out</div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-zinc-600">
                  <span className="font-semibold text-green-700">{imgFine}</span> site{imgFine === 1 ? "" : "s"} fine: no paid stock-library images found (free libraries like Unsplash and Pexels need no licence).
                </p>
                <p className="mt-1 text-xs text-zinc-500">Flags come from file names (e.g. shutterstock_123.jpg) and embedded copyright / credit tags. The scanner cannot tell whether an image was paid for, so treat this as a list to check against purchase records.</p>
                <div className="mt-4 space-y-3">
                  {imgVisible.map(({ r, paid }) => (
                    <ImageCard key={r.site} r={r} paid={paid} open={!!open["i:" + r.site]} toggle={() => setOpen((o) => ({ ...o, ["i:" + r.site]: !o["i:" + r.site] }))} rerun={() => run("images", [r.site])} running={!!running} />
                  ))}
                  {!imgVisible.length && <p className="text-sm text-zinc-500">No paid stock-library images found on any scanned site.</p>}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "emails" && (
          <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
            <p className="text-sm text-zinc-600">
              One ready-to-send email per site that has something to confirm. Replace <b>[Your name]</b>, then paste into your email client. Sites with no issues get no email.
            </p>
            <div className="mt-3 flex gap-2">
              {[["fonts", "Font emails", fontEmails.length], ["images", "Image emails", imageEmails.length]].map(([id, label, n]) => (
                <button key={id} onClick={() => setEmailTab(id)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${emailTab === id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>
                  {label} <span className="ml-1 opacity-70">{n}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-4">
              {(emailTab === "fonts" ? fontEmails : imageEmails).map((e) => <EmailCard key={e.kind + e.site} e={e} />)}
              {!(emailTab === "fonts" ? fontEmails : imageEmails).length && <p className="text-sm text-zinc-500">No sites need a {emailTab === "fonts" ? "font" : "image"} email{emailTab === "fonts" ? (fontRows.length ? "." : " (run the fonts check first).") : (imgRows.length ? "." : " (run the images check first).")}</p>}
            </div>
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs text-zinc-400">
        <p>PROBLEM means investigate, not guilty. Fonts loaded only by JavaScript can be missed. Image flags are filename and metadata only; cross-check against purchase records.</p>
      </footer>
    </main>
  );
}

function RunBar({ kind, done, total, label, running, sites, onRun, onStop }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {running === kind ? (
        <button onClick={onStop} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
      ) : (
        <button onClick={onRun} disabled={!!running || !sites.length} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {label} on {sites.length} site{sites.length === 1 ? "" : "s"}
        </button>
      )}
      {total > 0 && (
        <div className="min-w-[220px] flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-zinc-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{running === kind ? `Scanning… ${done} of ${total} done` : `${done} site${done === 1 ? "" : "s"} scanned`}</p>
        </div>
      )}
    </div>
  );
}

function SiteCard({ r, open, toggle, rerun, running }) {
  const c = COLOUR[r.status] || COLOUR.PENDING;
  const fonts = r.fonts || [];
  const todo = fonts.filter((f) => f.status === "PROBLEM" || f.status === "CHECK").sort((a, b) => ORDER[b.status] - ORDER[a.status]);
  const oks = fonts.filter((f) => f.status === "OK");
  const headline = r.status === "RUNNING"
    ? "Scanning…"
    : r.error
      ? r.error
      : todo.length
        ? todo.map((f) => `${f.family} → ${shortFix(f)}`).join("  ·  ")
        : fonts.length ? `${oks.length} font${oks.length === 1 ? "" : "s"} OK` : r.ignoredFonts?.length ? "Only icon/UI fonts (ignored)" : "No web fonts found";

  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm ring-1 ring-zinc-100 ${c.border}`}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{LABEL[r.status] || r.status}</span>
        <span className="font-medium">{r.site}</span>
        {r.platform && <span className="text-xs text-zinc-400">{r.platform}</span>}
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
        {r.status !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
      </button>
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
                    <th className="py-1 pr-2">How loaded</th>
                    <th className="py-1 pr-2">Why</th>
                    <th className="py-1 pr-2">On Adobe Fonts?</th>
                    <th className="py-1 pr-2">Suggested fix</th>
                    <th className="py-1">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {todo.map((f, i) => {
                    const fc = COLOUR[f.status] || COLOUR.PENDING;
                    return (
                      <tr key={i} className={`border-t border-zinc-100 align-top ${fc.bg}`}>
                        <td className={`py-1.5 pr-2 font-semibold ${fc.text}`}>{f.status}</td>
                        <td className="py-1.5 pr-2">{f.family}{f.otherFiles > 0 && <span className="text-zinc-400"> +{f.otherFiles} more file{f.otherFiles === 1 ? "" : "s"}</span>}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{f.kind}{f.hostedOn ? ` / ${f.hostedOn}` : ""}</td>
                        <td className="py-1.5 pr-2">{f.note}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {f.status === "PROBLEM" && f.adobe && (
                            <>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${f.adobe === "yes" ? "bg-green-100 text-green-800" : f.adobe === "no" ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-600"}`}>
                                {f.adobe === "yes" ? "Yes" : f.adobe === "no" ? "No" : "Not sure"}
                              </span>
                              <br />
                              <a href={f.adobeSearch} target="_blank" rel="noreferrer" className="text-[11px] text-blue-700 underline">Search Adobe Fonts</a>
                            </>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 font-medium">{f.fix}</td>
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
            {r.fontPages > 0 && <span>{r.fontPages} page{r.fontPages === 1 ? "" : "s"}</span>}
            {r.cssCount > 0 && <span>{r.cssCount} stylesheets</span>}
            {oks.length > 0 && <span title={[...new Set(oks.map((f) => f.family))].join(", ")} className="text-green-700">{oks.length} font{oks.length === 1 ? "" : "s"} fine</span>}
            {r.ignoredFonts?.length > 0 && <span title={r.ignoredFonts.join(", ")}>{r.ignoredFonts.length} icon/UI font{r.ignoredFonts.length === 1 ? "" : "s"} ignored</span>}
            {r.seconds != null && <span>{r.seconds}s</span>}
            {!running && <button onClick={rerun} className="underline">Re-scan</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageCard({ r, paid, open, toggle, rerun, running }) {
  const st = r.imgStatus === "RUNNING" ? "RUNNING" : r.imgStatus === "UNREACHABLE" ? "UNREACHABLE" : paid.length ? "PAID" : "OK";
  const c = COLOUR[st];
  const libs = [...new Set(paid.map((i) => i.flag))];
  const freeCount = (r.images || []).filter((i) => i.flag && isFreeLib(i.flag)).length;
  const label = st === "PAID" ? "PAID LIBRARY" : st === "RUNNING" ? "SCANNING" : st === "UNREACHABLE" ? "COULDN'T CHECK" : "OK";
  const headline = st === "RUNNING"
    ? `Scanning… ${r.imgProgress || ""}`
    : st === "UNREACHABLE"
      ? r.imgError
      : `${paid.length} image${paid.length === 1 ? "" : "s"} · ${libs.join(", ")} → find the purchase record, or replace`;
  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm ring-1 ring-zinc-100 ${c.border}`}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{label}</span>
        <span className="font-medium">{r.site}</span>
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
        {r.pagesScanned > 0 && <span className="text-xs text-zinc-400">{r.pagesScanned} pages</span>}
        {st !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
      </button>
      {open && st !== "RUNNING" && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          {r.imgFix && st === "UNREACHABLE" && <p className="mb-2"><b>Suggested fix:</b> {r.imgFix}</p>}
          {paid.length > 0 && (
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
                {paid.slice(0, 80).map((i, k) => {
                  let name = i.url;
                  try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
                  return (
                    <tr key={k} className="border-t border-zinc-100 align-top bg-red-50">
                      <td className="py-1.5 pr-2 font-semibold text-red-700">{i.flag}</td>
                      <td className="py-1.5 pr-2">
                        <a href={i.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-blue-700 underline">{name.slice(0, 80)}</a>
                        {i.page && <div className="text-[11px] text-zinc-400">on {(() => { try { return new URL(i.page).pathname || "/"; } catch { return i.page; } })()}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-zinc-600">{i.meta ? i.meta.slice(0, 160) : "—"}</td>
                      <td className="py-1.5 font-medium">Find the purchase record / licence. If none, replace the image or buy a licence.</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            {r.pagesScanned > 0 && <span>{r.pagesScanned} page{r.pagesScanned === 1 ? "" : "s"} checked{r.hasSitemap ? " (sitemap)" : " (crawled)"}</span>}
            {r.imagesChecked > 0 && <span>{r.imagesChecked} images seen</span>}
            {freeCount > 0 && <span className="text-green-700">{freeCount} free-library image{freeCount === 1 ? "" : "s"} (no licence needed)</span>}
            {!running && <button onClick={rerun} className="underline">Re-scan</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailCard({ e }) {
  const [copied, setCopied] = useState("");
  const [open, setOpen] = useState(false);
  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  }
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 text-left">
          <span className="font-medium">{e.site}</span>
          <span className="ml-2 text-xs text-zinc-500">{e.count} {e.kind === "fonts" ? "font" : "image"}{e.count === 1 ? "" : "s"}</span>
          <span className="ml-2 text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
        </button>
        <button onClick={() => copy("subject", e.subject)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100">{copied === "subject" ? "Copied" : "Copy subject"}</button>
        <button onClick={() => copy("body", e.body)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied === "body" ? "Copied" : "Copy email"}</button>
      </div>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3">
          <p className="mb-2 text-xs text-zinc-500">Subject: <span className="text-zinc-800">{e.subject}</span></p>
          <textarea readOnly value={e.body} rows={Math.min(30, e.body.split("\n").length + 1)} className="w-full rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed" />
        </div>
      )}
    </div>
  );
}
