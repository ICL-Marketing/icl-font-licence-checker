"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LaunchArea from "@/app/launch";
import { DEFAULT_SITES } from "@/data/sites";
import { buildFontEmail, buildImageEmail, isFreeLib, segmentsToText, segmentsToHtml } from "@/lib/email";
import { fontLink, isEmbeddedIconFont, fixedFix, issueLabel, freeRouteLink, isFreeFontAwesome, ISSUE_TONE, mergeImageSizes, creditOnly, imageAdminLink, stockLibraryLink, stockLicenceSignal } from "@/lib/fontlink";

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
  return mergeImageSizes((r.images || []).filter((i) => i.flag && !isFreeLib(i.flag)));
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_SITES.join("\n"));
  const [parallel, setParallel] = useState(4);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null); // null | "fonts" | "images"
  const [area, setArea] = useState("fonts"); // "fonts" | "images" | "launch"
  const [view, setView] = useState({ fonts: "results", images: "results" }); // "results" | "emails" per area
  const [filter, setFilter] = useState("ALL");
  const [open, setOpen] = useState({});
  const [exporting, setExporting] = useState("");
  const [showList, setShowList] = useState(true);
  const stopRef = useRef(false);
  const cancelledRef = useRef(new Set());
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

  const patch = (site, fields) => {
    if (cancelledRef.current.has(site)) return;
    setResults((prev) => ({ ...prev, [site]: { ...(prev[site] || { site }), ...fields } }));
  };

  // Cancel any scan for this site, drop its results and take it off the site list.
  function removeSite(site) {
    cancelledRef.current.add(site);
    setResults((prev) => { const next = { ...prev }; delete next[site]; return next; });
    setText((t) => t.split(/\r?\n/).filter((l) => normalise(l) !== site).join("\n"));
  }

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
    patch(site, { imgStatus: "RUNNING", images: [], imgError: "", imgProgress: "reading sitemap", imgDone: 0, imgTotal: 0 });
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
      patch(site, { imgProgress: `page ${scanned} of ${total}`, imgDone: scanned, imgTotal: total, images });
      while (queue.length && !stopRef.current && !cancelledRef.current.has(site)) {
        const batch = queue.splice(0, 10);
        const out = await post("/api/scan-pages", { site, urls: batch });
        scanned += (out.done || []).length;
        imagesChecked += out.imagesChecked || 0;
        for (const i of out.images || []) {
          const k = i.url.split("?")[0];
          if (!seenImg.has(k)) { seenImg.add(k); images.push(i); continue; }
          const prev = images.find((x) => x.url.split("?")[0] === k);
          if (prev) prev.pages = [...new Set([...(prev.pages || (prev.page ? [prev.page] : [])), ...(i.pages || (i.page ? [i.page] : []))])];
        }
        if (out.remaining?.length) queue.unshift(...out.remaining);
        if (!d.hasSitemap) {
          for (const l of out.links || []) {
            const k = l.replace(/\/$/, "");
            if (!visited.has(k) && visited.size < MAX_PAGES) { visited.add(k); queue.push(l); }
          }
        }
        total = scanned + queue.length;
        patch(site, { imgProgress: `page ${scanned} of ${total}`, imgDone: scanned, imgTotal: total, images: [...images] });
      }
      patch(site, { imgStatus: "DONE", images, imagesChecked, pagesScanned: scanned, pagesTotal: total, hasSitemap: !!d.hasSitemap, imgProgress: undefined, imagesScannedAt: d.scannedAt });
    } catch (e) {
      patch(site, { imgStatus: "UNREACHABLE", imgError: `Request failed: ${e.message}`, imgProgress: undefined });
    }
  }

  async function run(kind, list) {
    cancelledRef.current = new Set();
    stopRef.current = false;
    setRunning(kind);
    setShowList(false);
    setArea(kind);
    setView((v) => ({ ...v, [kind]: "results" }));
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
  const AREA_FIELDS = {
    fonts: ["status", "fonts", "ignoredFonts", "error", "fix", "platform", "cssCount", "fontPages", "seconds", "fontsScannedAt"],
    images: ["imgStatus", "images", "imgError", "imgFix", "imgProgress", "imgDone", "imgTotal", "imagesChecked", "pagesScanned", "pagesTotal", "hasSitemap", "imagesScannedAt"],
  };
  function clearArea(kind) {
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

  // Only one accordion open at a time.
  const toggleOne = (key) => setOpen((o) => (o[key] ? {} : { [key]: true }));

  const tabBtn = (id, label, count) => (
    <button onClick={() => setView((v) => ({ ...v, [area]: id }))}
      className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium ${view[area] === id ? "border-zinc-300 bg-white text-zinc-900" : "border-transparent bg-transparent text-zinc-500 hover:text-zinc-800"}`}>
      {label}{count != null && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{count}</span>}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Licence Checker</h1>
        </div>
      </header>

      <nav className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-zinc-200/70 p-1 sm:inline-grid sm:w-auto" aria-label="Licence area">
        {[["fonts", "Fonts", fontRows.length ? fontCounts.PROBLEM + fontCounts.CHECK : null],
          ["images", "Images", imgRows.length ? imgPaidSites : null],
          ["launch", "Launch checks", null]].map(([id, label, n]) => (
          <button key={id} onClick={() => setArea(id)} aria-current={area === id ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${area === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>
            {label}{n != null && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{n}</span>}
            {running === id && <span className="ml-2 text-[11px] font-normal text-blue-600">scanning…</span>}
          </button>
        ))}
      </nav>

      {area === "launch" && <section className="mt-5"><LaunchArea post={post} /></section>}

      {area !== "launch" && <>
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
        <div className="flex gap-1 border-b border-zinc-300">
          {tabBtn("results", area === "fonts" ? "Fonts found" : "Stock images found", null)}
          {tabBtn("emails", "Client emails", (area === "fonts" ? fontEmails : imageEmails).length || null)}
        </div>

        {area === "fonts" && (
          <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
            <AreaBar kind="fonts" done={fontDone} total={fontTotal} label={fontRows.length ? "Rescan fonts" : "Run fonts check"} running={running} sites={sites}
              onRun={() => run("fonts", sites)} onStop={stop} onClear={fontRows.length ? () => clearArea("fonts") : null}
              download={fontRows.length ? { label: "Download font tracker (Excel)", busy: exporting === "fonts", onClick: () => exportXlsx("fonts") } : null} />
            {view.fonts === "results" ? (<>
            {fontRows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                </div>
                <FineList
                  count={fontFine}
                  text="fonts are Google Fonts, Adobe Fonts kits, open licence, or system fonts only."
                  items={fontRows.filter((r) => r.status === "OK" || r.status === "SYSTEM").map((r) => ({
                    site: r.site, url: r.finalUrl || `https://${r.site}`,
                    detail: (() => { const f = [...new Set((r.fonts || []).filter((x) => x.status === "OK").map((x) => x.family))]; return f.length ? f.join(", ") : "System fonts only"; })(),
                  }))}
                />
                <div className="mt-4 space-y-3">
                  {fontVisible.map((r) => (
                    <SiteCard key={r.site} r={r} open={!!open["f:" + r.site]} toggle={() => toggleOne("f:" + r.site)} rerun={() => run("fonts", [r.site])} running={!!running} onRemove={() => removeSite(r.site)} />
                  ))}
                  {!fontVisible.length && <p className="text-sm text-zinc-500">{filter === "ALL" ? "Nothing outstanding." : "Nothing in this group."}</p>}
                </div>
              </>
            )}
            </>) : (
              <EmailList kind="fonts" emails={fontEmails} scanned={fontRows.length > 0}
                intro="One ready-to-send email per site, only for what the client has to answer: paid fonts with no licence found, demo fonts, font subscriptions to confirm, and fonts of unknown origin. Anything we can fix ourselves at no cost is left out. Sites with no issues get no email." />
            )}
          </div>
        )}

        {area === "images" && (
          <div className="rounded-b-xl border border-t-0 border-zinc-300 bg-white p-4">
            <AreaBar kind="images" done={imgDone} total={imgTotal} label={imgRows.length ? "Rescan images" : "Run images check"} running={running} sites={sites}
              onRun={() => run("images", sites)} onStop={stop} onClear={imgRows.length ? () => clearArea("images") : null}
              download={imgRows.length ? { label: "Download stock image tracker (Excel)", busy: exporting === "images", onClick: () => exportXlsx("images") } : null} />
            {view.images === "results" ? (<>
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
                <FineList
                  count={imgFine}
                  text="no paid stock-library images found (free libraries like Unsplash and Pexels need no licence)."
                  items={imgRows.filter((x) => x.r.imgStatus === "DONE" && !x.paid.length).map(({ r }) => {
                    const free = (r.images || []).filter((i) => i.flag && isFreeLib(i.flag)).length;
                    return {
                      site: r.site, url: r.finalUrl || `https://${r.site}`,
                      detail: `${r.pagesScanned || 0} pages, ${r.imagesChecked || 0} images checked${free ? `, ${free} from free libraries` : ""}`,
                    };
                  })}
                />
                <p className="mt-1 text-xs text-zinc-500">Flags come from file names (e.g. shutterstock_123.jpg) and embedded copyright / credit tags. The scanner cannot tell whether an image was paid for, so treat this as a list to check against purchase records.</p>
                <div className="mt-4 space-y-3">
                  {imgVisible.map(({ r, paid }) => (
                    <ImageCard key={r.site} r={r} paid={paid} open={!!open["i:" + r.site]} toggle={() => toggleOne("i:" + r.site)} rerun={() => run("images", [r.site])} running={!!running} onRemove={() => removeSite(r.site)} />
                  ))}
                  {!imgVisible.length && <p className="text-sm text-zinc-500">No paid stock-library images found on any scanned site.</p>}
                </div>
              </>
            )}
            </>) : (
              <EmailList kind="images" emails={imageEmails} scanned={imgRows.length > 0}
                intro="One ready-to-send email per site that has images from paid stock libraries. It is a heads-up for the client, not a demand: most of these are likely already licensed. Sites with no paid-library images get no email." />
            )}
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs text-zinc-400">
        <p>PROBLEM means investigate, not guilty. Fonts loaded only by JavaScript can be missed. Image flags are filename and metadata only; cross-check against purchase records.</p>
      </footer>
      </>}
    </main>
  );
}

function Badge({ ok, bad, label }) {
  return <span className={`rounded px-1.5 py-0.5 font-semibold ${ok ? "bg-green-100 text-green-800" : bad ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-600"}`}>{label}</span>;
}

function FaIconTable({ icons, pages, version }) {
  const change = icons.filter((i) => !i.free);
  return (
    <div className="space-y-2">
      <p>{change.length ? `Change ${change.length} icon${change.length === 1 ? "" : "s"}, then switch the site to Font Awesome Free.` : "No icons need changing. Switch the site to Font Awesome Free."}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-normal">
          <thead><tr className="text-left text-zinc-500"><th className="pr-2">Icon</th><th className="pr-2">Class</th><th className="pr-2">Style</th><th className="pr-2">Pages</th><th className="pr-2">Free?</th><th>Change to</th></tr></thead>
          <tbody>
            {icons.map((i) => (
              <tr key={i.cls} className="border-t border-zinc-200">
                <td className="pr-2">{i.icon}</td>
                <td className="pr-2 font-mono">{i.cls}</td>
                <td className="pr-2">{i.style}</td>
                <td className="pr-2 tabular-nums">{i.uses}</td>
                <td className={`pr-2 font-semibold ${i.free ? "text-green-700" : "text-red-700"}`}>{i.free ? "Yes" : "No, Pro only"}</td>
                <td className={i.free ? "" : "font-mono font-semibold"}>{i.changeTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500">Checked {pages} page{pages === 1 ? "" : "s"} against Font Awesome {version || 6} Free. Icons added by CSS or JavaScript are not counted.</p>
    </div>
  );
}

// "×" on the right of a card. Asks inline before cancelling and removing the site.
function RemoveSite({ site, onRemove }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 text-xs">
        <span className="text-zinc-600">Remove {site} from the list?</span>
        <button onClick={onRemove} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white">Remove</button>
        <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100">Keep</button>
      </div>
    );
  }
  return (
    <button onClick={() => setAsking(true)} aria-label={`Remove ${site}`} title="Cancel and remove this site"
      className="shrink-0 px-3 py-3 text-lg leading-none text-zinc-400 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">×</button>
  );
}

// "N sites fine" line that expands to list those sites.
function FineList({ count, text, items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 text-sm text-zinc-600">
      <button onClick={() => setOpen((v) => !v)} disabled={!items.length} className="text-left disabled:cursor-default">
        <span className="font-semibold text-green-700">{count}</span> site{count === 1 ? "" : "s"} fine: {text}
        {items.length > 0 && <span className="ml-2 text-xs text-green-700 underline">{open ? "Hide" : "Show"}</span>}
      </button>
      {open && (
        <ul className="mt-2 grid gap-x-6 gap-y-1 rounded-lg border border-green-200 bg-green-50 p-3 text-xs sm:grid-cols-2">
          {[...items].sort((a, b) => a.site.localeCompare(b.site)).map((i) => (
            <li key={i.site} className="min-w-0">
              <a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-green-800 underline">{i.site}</a>
              <span className="text-zinc-500"> · {i.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Run / rescan, stop, download and clear for one area. Clear asks first.
function AreaBar({ kind, done, total, label, running, sites, onRun, onStop, onClear, download }) {
  const [asking, setAsking] = useState(false);
  const btn = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50";
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {running === kind ? (
          <button onClick={onStop} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
        ) : (
          <button onClick={onRun} disabled={!!running || !sites.length} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {label} on {sites.length} site{sites.length === 1 ? "" : "s"}
          </button>
        )}
        {download && <button onClick={download.onClick} disabled={download.busy} className={btn}>{download.busy ? "Building…" : download.label}</button>}
        {onClear && !running && (asking ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-zinc-600">Clear all {kind === "fonts" ? "font" : "image"} results?</span>
            <button onClick={() => { setAsking(false); onClear(); }} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white">Clear</button>
            <button onClick={() => setAsking(false)} className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100">Keep</button>
          </span>
        ) : (
          <button onClick={() => setAsking(true)} className={`${btn} sm:ml-auto`}>Clear {kind === "fonts" ? "font" : "image"} results</button>
        ))}
      </div>
      {total > 0 && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-zinc-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{running === kind ? `Scanning… ${done} of ${total} done` : `${done} site${done === 1 ? "" : "s"} scanned`}</p>
        </div>
      )}
    </div>
  );
}

function EmailList({ kind, emails, scanned, intro }) {
  const [openSite, setOpenSite] = useState(null);
  return (
    <div>
      <p className="text-sm text-zinc-600">{intro} Copy, paste into your email client, and your signature does the rest.</p>
      <div className="mt-4 space-y-4">
        {emails.map((e) => <EmailCard key={e.kind + e.site} e={e} open={openSite === e.site} toggle={() => setOpenSite((s) => (s === e.site ? null : e.site))} />)}
        {!emails.length && <p className="text-sm text-zinc-500">No sites need {kind === "fonts" ? "a font" : "an image"} email{scanned ? "." : ` (run the ${kind} check first).`}</p>}
      </div>
    </div>
  );
}

const TONE_CHIP = { red: "bg-red-600", amber: "bg-amber-500", green: "bg-green-600" };
const TONE_BORDER = { red: "border-red-500", amber: "border-amber-500", green: "border-green-500" };
const TONE_RANK = { red: 3, amber: 2, green: 1 };

function SiteCard({ r, open, toggle, rerun, running, onRemove }) {
  const fonts = r.fonts || [];
  const todo = fonts.filter((f) => (f.status === "PROBLEM" || f.status === "CHECK") && !isEmbeddedIconFont(f) && !isFreeFontAwesome(f))
    .sort((a, b) => (TONE_RANK[ISSUE_TONE[issueLabel(b)]] || 0) - (TONE_RANK[ISSUE_TONE[issueLabel(a)]] || 0));
  const labels = [...new Set(todo.map(issueLabel))];
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
        : fonts.length ? `${oks.length} font${oks.length === 1 ? "" : "s"} OK` : r.ignoredFonts?.length ? "Only icon/UI fonts (ignored)" : "No web fonts found";

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start">
      <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
        {labels.length && r.status !== "RUNNING"
          ? labels.map((l) => <span key={l} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${TONE_CHIP[ISSUE_TONE[l]] || "bg-zinc-500"}`}>{l}</span>)
          : <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{LABEL[r.status] || r.status}</span>}
        <span className="font-medium">{r.site}</span>
        {r.platform && <span className="text-xs text-zinc-400">{r.platform}</span>}
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
        {r.status !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
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
                    <th className="py-1 pr-2">How loaded</th>
                    <th className="py-1 pr-2">Why</th>
                    <th className="py-1 pr-2">Suggested fix</th>
                    <th className="py-1">Font file</th>
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
                        <td className="py-1.5 pr-2 whitespace-nowrap">{f.kind}{f.hostedOn ? ` / ${f.hostedOn}` : ""}</td>
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
                          {f.faIcons ? <FaIconTable icons={f.faIcons} pages={f.faPagesChecked} version={f.faVersion} /> : fixedFix(f)}
                          {freeRouteLink(f) && <> <a href={freeRouteLink(f)} target="_blank" rel="noreferrer" className="text-blue-700 underline">Open font page</a></>}
                        </td>
                        <td className="py-1.5">
                          <a href={f.source} target="_blank" rel="noreferrer" title={[f.meta?.copyright, f.meta?.manufacturer, f.meta?.licence].filter(Boolean).join("\n")} className="break-all font-mono text-[11px] text-blue-700 underline">{f.source.slice(0, 160)}</a>
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

function ImageCard({ r, paid, open, toggle, rerun, running, onRemove }) {
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
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start">
      <button onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 text-left">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${c.chip}`}>{label}</span>
        <span className="font-medium">{r.site}</span>
        <span className="basis-full text-sm text-zinc-700 sm:basis-auto sm:flex-1">{headline}</span>
        {st !== "RUNNING" && r.pagesScanned > 0 && <span className="text-xs text-zinc-400">{r.pagesScanned} pages</span>}
        {st !== "RUNNING" && <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>}
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
                        {i.sizes > 1 && <span className="ml-1 text-[11px] text-zinc-400">+{i.sizes - 1} other size{i.sizes === 2 ? "" : "s"}</span>}
                        {i.pages?.length > 0 && <div className="text-[11px] text-zinc-400">on {i.pages.slice(0, 3).map((p) => { try { return new URL(p).pathname || "/"; } catch { return p; } }).join(", ")}{i.pages.length > 3 ? ` +${i.pages.length - 3} more` : ""}</div>}
                      </td>
                      <td className="py-1.5 pr-2" title={stockLicenceSignal(i).reason}>
                        {(() => { const st = stockLicenceSignal(i).status; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${st === "Likely licensed" ? "bg-green-600" : st === "Possible watermarked preview" ? "bg-red-600" : "bg-amber-500"}`}>{st}</span>; })()}
                        <div className="mt-0.5 text-[11px] text-zinc-500">{stockLicenceSignal(i).reason}</div>
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{stockLibraryLink(i.url, i.flag) ? <a href={stockLibraryLink(i.url, i.flag)} target="_blank" rel="noreferrer" className="text-blue-700 underline">View on {i.flag}</a> : "—"}</td>
                      <td className="py-1.5 pr-2 text-zinc-600">{creditOnly(i.meta) || "—"}</td>
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

const EDITS_KEY = "flc-email-edits-v1";
function loadEdits() { try { return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}"); } catch { return {}; } }
function saveEdits(all) { try { localStorage.setItem(EDITS_KEY, JSON.stringify(all)); } catch {} }

function EmailCard({ e, open, toggle }) {
  const key = `${e.kind}|${e.site}`;
  const [copied, setCopied] = useState(false);
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
          <span className="ml-2 text-xs text-zinc-500">{e.count} {e.kind === "fonts" ? "font" : "image"}{e.count === 1 ? "" : "s"}</span>
          {edited && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800">Edited</span>}
          <span className="ml-2 text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
        </button>
        <button onClick={copy} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{copied ? "Copied" : "Copy email"}</button>
      </div>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3">
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
