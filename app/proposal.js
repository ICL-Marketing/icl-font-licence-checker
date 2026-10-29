"use client";
// Proposal deck for one client, step by step: assess the ideas, add your own, Claude writes the copy,
// then review it, add screenshots and download the ICL-branded .pptx.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, CopyIcon, CheckIcon, ExternalIcon, SpinnerIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon } from "@/app/icons";
import { useClaudeHandler, withTitle } from "@/app/claudeInbox";
import { FIXED_SLIDES, TEAMS, lineFromIdea, proposalPrompt, parseProposalReply, teamHours, lineValue, priceFor, ideasText, tierPlan, tierOptions, copyEdits, withEdits, quarter, snapHours, rateOf, DAY_RATE, withTeam, withoutTeam, withHours, RETAINER_DEFAULTS, normalisePoints } from "@/lib/proposal";
import Link from "next/link";
import { loadTemplate, templateMeta, listSlides, TEMPLATE_KEY, ANCHORS } from "@/lib/deckTemplate";
import { PACKAGE_GROUPS, PACKAGE_TEAMS, pickedPackages, effectivePackages, isPackageLine, packagesOf, SINGLE_TIER, isSeoLine } from "@/lib/packages";
import { ideaType, serviceFor, IDEA_SERVICES } from "@/lib/clientIdeas";

function Grow({ value, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={`resize-none overflow-hidden ${className}`} {...rest} />;
}
const STEPS = ["Ideas", "Packages & retainer", "Claude writes it", "Review & download"];
const input = "w-full rounded-md border border-zinc-300 px-2 py-1 text-sm";
const num = "w-[4.5rem] rounded-md border border-zinc-300 px-1.5 py-0.5 text-right text-sm";

// Each client's proposal is saved straight away in this browser, and to the shared store (one record per client).
const LOCAL = "flc-proposals-v1";
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || "{}") || {}; } catch { return {}; } };
const newer = (a, b) => (!a ? b : !b ? a : String(a.updatedAt || "") >= String(b.updatedAt || "") ? a : b);
async function loadDoc(id) {
  const local = readLocal()[id] || null;
  const [res, old] = await Promise.all([
    fetch("/api/results?kind=proposals").then((r) => r.json()).catch(() => ({})),
    fetch("/api/settings?key=proposals").then((r) => r.json()).catch(() => ({})), // where drafts were kept before
  ]);
  return newer(newer(local, res.results?.[id] || null), old.value?.byClient?.[id] || null);
}
function saveLocal(id, doc) { try { const all = readLocal(); all[id] = doc; localStorage.setItem(LOCAL, JSON.stringify(all)); } catch {} }
// keepalive lets the save finish even if the page is closed or refreshed straight after.
const saveShared = (id, doc) => fetch("/api/results", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "proposals", site: id, data: doc }) }).then((r) => r.json()).catch(() => ({ error: true }));
// Screenshots are shrunk to 1800px wide JPEGs so the deck stays a sensible size.
function shrink(file, maxW = 1800, quality = 0.86) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onerror = bad;
    r.onload = () => { const img = new Image(); img.onerror = bad; img.onload = () => { const k = Math.min(1, maxW / img.naturalWidth); const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", quality)); }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}

// A plain text box for hours (no number arrows). It saves when you leave it or press Enter, rounded to the half hour.
function HoursBox({ value, on, onCommit, label }) {
  const [text, setText] = useState(null);
  const commit = () => { if (text === null) return; const t = text.trim(); setText(null); if (t === "" ? on : Number.isFinite(Number(t)) && String(value) !== t) onCommit(t); };
  return <input type="text" inputMode="decimal" value={text ?? String(value ?? "")} placeholder="–" onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label={label} className={`w-12 rounded-full px-1 py-0 text-right text-[11px] font-normal outline-none ${on ? "bg-white text-zinc-900" : "bg-zinc-100 text-zinc-900 placeholder:text-zinc-400"}`} />;
}
const PACKAGE_TEAM_KEYS = Object.keys(PACKAGE_TEAMS);
const TIER_PILL = { bronze: "bg-[#f1dfc4] text-[#7a4f12]", silver: "bg-zinc-200 text-zinc-700", gold: "bg-[#fbefb0] text-[#7a6008]" };
const NEXT_TIER = { bronze: "silver", silver: "gold", gold: "bronze" };
// The idea's price (or package), in its tier's colour when Bronze / Silver / Gold is on: click to move it to the next tier.
// Off when the deck leaves prices out ("Include prices" unticked): no price pills anywhere in the editor either.
const PricesShown = createContext(true);
// Under an idea's title: its service (Design, Development, SEO…) and links to the pages on their current site that
// show it, each opening in a new tab.
// The title is the one line of detail; Issue and Solution show on hover.
function IdeaDetail({ idea }) {
  const links = [...new Set([...(idea.links || []), idea.evidenceUrl].filter((u) => /^https?:\/\//.test(u || "")))];
  const label = (u) => { try { const x = new URL(u); return x.pathname === "/" ? x.hostname.replace(/^www\./, "") : x.pathname.replace(/\/$/, ""); } catch { return u; } };
  const sv = idea.service || serviceFor(idea.title);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ${IDEA_SERVICES[sv] || "bg-zinc-500"}`}>{sv.replace(/^Web /, "").replace(/^./, (c) => c.toUpperCase())}</span>
      {links.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-blue-700 hover:underline">{label(u)}<ExternalIcon className="h-3 w-3" /></a>)}
    </span>
  );
}
function PricePill({ line, onChange, picked = [], rate = DAY_RATE, tier, onTier }) {
  if (!useContext(PricesShown)) return null;
  const pkg = isPackageLine(line) && (() => { const g = packagesOf(line, picked)[0]; const t = g?.tiers.find((x) => g.picked.includes(x.id)); return g ? `${g.name} package · ${t?.price} ${t?.period}` : "Package"; })();
  const pill = `whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tier ? TIER_PILL[tier] : "bg-indigo-100 text-indigo-800"}`;
  const label = pkg || priceFor(line, rate);
  return (
    <span className="inline-flex items-center gap-1">
      {tier && onTier ? <button type="button" onClick={() => onTier(NEXT_TIER[tier])} title={`${tier[0].toUpperCase()}${tier.slice(1)} option. Click to move it to ${NEXT_TIER[tier]}`} className={`${pill} hover:opacity-80`}>{label} · {tier[0].toUpperCase()}{tier.slice(1)}</button> : <span className={pill} title={pkg ? "Priced by the package, not by the hour. Change the tier in step 2" : "The hours at this client's day rate"}>{label}</span>}
      {line.free && <button type="button" onClick={() => onChange({ free: false })} title="Marked free earlier. Click to charge for it" className="rounded-full border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">Free ×</button>}
    </span>
  );
}
// Who does it and for how long, in one row: each team is a pill with its hours. A blank box means that team isn't needed.
// SEO, PPC and Videography are sold as packages, so their pills just switch on and off.
// With Bronze / Silver / Gold on, the price pill takes its tier's colour; click it to move the idea to the next tier.
function Effort({ line, onChange, picked = [], rate = DAY_RATE, tier, onTier, pill = true }) {
  const shown = useContext(PricesShown); // no prices: no time estimates either
  const team = line.team || [], th = teamHours(line), total = Object.values(th).reduce((a, b) => a + b, 0);
  const setTeam = (next) => onChange(withTeam(line, next));
  const setHours = (k, v) => {
    if (v === "" || Number(v) === 0) return team.includes(k) && onChange(withoutTeam(line, k)); // blank or 0 takes the team off
    const h = quarter(Number(v)); if (!Number.isFinite(h)) return; // whole hours (a half hour only under an hour)
    if (!team.includes(k)) { const t = withTeam(line, [...team, k]); return onChange({ ...t, ...withHours({ ...line, ...t }, k, h) }); }
    onChange(withHours(line, k, h));
  };
  if (!shown) return null;
  return (
    <span className="flex w-full flex-wrap items-center gap-1 text-xs text-zinc-500">
      {TEAMS.map(([k, name, short]) => {
        const on = team.includes(k), cls = `inline-flex items-center gap-1 rounded-full border py-0.5 text-[11px] font-semibold ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500"}`;
        if (PACKAGE_TEAM_KEYS.includes(k)) return <button key={k} type="button" onClick={() => (on ? onChange(withoutTeam(line, k)) : setTeam([...team, k]))} className={`${cls} px-2 ${on ? "" : "hover:bg-zinc-100"}`} title={`${name} is priced by its package`}>{name}</button>;
        // Click the name to take the team off (clears its hours) or put it back.
        return <span key={k} className={`${cls} pl-0.5 pr-0.5`}><button type="button" onClick={() => (on ? onChange(withoutTeam(line, k)) : setTeam([...team, k]))} title={on ? `Take ${name} off this idea` : `Add ${name}`} className={`rounded-full px-1.5 ${on ? "hover:bg-zinc-700" : "hover:bg-zinc-100"}`}>{short}</button><HoursBox value={on ? th[k] : ""} on={on} onCommit={(v) => setHours(k, v)} label={`${name} hours`} /></span>;
      })}
      {!isPackageLine(line) && <span className="ml-1">= {total} {total === 1 ? "hr" : "hrs"}</span>}
      {pill && <PricePill line={line} onChange={onChange} picked={picked} rate={rate} tier={tier} onTier={onTier} />}
    </span>
  );
}
function ImageDrop({ value, onChange, label, status, onShot, shotLabel = "Use the page screenshot" }) {
  const ref = useRef(null);
  const take = async (f) => { if (f && f.type.startsWith("image/")) onChange(await shrink(f)); };
  return (
    <div tabIndex={0} onPaste={(e) => take([...e.clipboardData.files][0])} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }} className="relative flex h-32 w-48 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-center text-[11px] text-zinc-500 outline-none hover:border-zinc-400 focus:border-blue-500" onClick={() => ref.current?.click()} title="Click to choose, drop a file, or click then Ctrl+V to paste a screenshot">
      {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : status === "loading" ? <span className="flex items-center gap-1.5 px-2"><SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> Taking a screenshot…</span> : <span className="px-2">{status === "failed" ? "Screenshot didn't load. " : ""}{label}<br />click, drop or paste{onShot && <><br /><button type="button" onClick={(e) => { e.stopPropagation(); onShot(); }} className="mt-1 font-semibold text-blue-700 hover:underline">{shotLabel}</button></>}</span>}
      {value && <button onClick={(e) => { e.stopPropagation(); onChange(null); }} aria-label="Remove image" className="absolute right-1 top-1 rounded bg-white/90 p-0.5 text-zinc-500 hover:text-red-700"><TrashIcon className="h-3.5 w-3.5" /></button>}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files[0])} />
    </div>
  );
}
// Bullet points as a proper list: Enter adds the next point, Backspace on an empty one removes it.
function Bullets({ items, onChange }) {
  const refs = useRef([]);
  const list = items.length ? items : [""];
  const focus = (n) => setTimeout(() => refs.current[n]?.focus(), 0);
  return (
    <ul className="space-y-1 rounded-md border border-zinc-300 px-2 py-1.5">
      {list.map((b, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-900" />
          <input ref={(el) => { refs.current[i] = el; }} value={b} placeholder="A bullet point" aria-label={`Bullet ${i + 1}`}
            onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onChange([...list.slice(0, i + 1), "", ...list.slice(i + 1)]); focus(i + 1); }
              if (e.key === "Backspace" && !b && list.length > 1) { e.preventDefault(); onChange(list.filter((_, j) => j !== i)); focus(Math.max(0, i - 1)); }
            }}
            className="min-w-0 flex-1 rounded px-1 py-0.5 outline-none focus:bg-zinc-50" />
          <button type="button" disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} aria-label="Move bullet up" title="Move up" className="rounded p-0.5 text-zinc-400 hover:text-zinc-900 disabled:invisible"><ChevronUpIcon className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={i === list.length - 1} onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }} aria-label="Move bullet down" title="Move down" className="rounded p-0.5 text-zinc-400 hover:text-zinc-900 disabled:invisible"><ChevronDownIcon className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove bullet" className="rounded p-0.5 text-zinc-300 hover:text-red-700"><TrashIcon className="h-3.5 w-3.5" /></button>
        </li>
      ))}
      <li><button type="button" onClick={() => { onChange([...list, ""]); focus(list.length); }} className="pl-3.5 text-xs text-zinc-500 hover:text-zinc-900">+ Add bullet</button></li>
    </ul>
  );
}
// Take a whole slide out of the deck (and put it back).
function SlideToggle({ hidden, onToggle }) {
  return hidden
    ? <button type="button" onClick={onToggle} className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-blue-700 hover:bg-blue-50">Put slide back</button>
    : <button type="button" onClick={onToggle} title="Leave this slide out of the deck" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-zinc-400 hover:bg-red-50 hover:text-red-700"><TrashIcon className="h-3.5 w-3.5" /> Remove slide</button>;
}
function BlockList({ label, items, onChange, hidden, onToggle }) {
  if (!items?.length) return null;
  return (
    <div><div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><span className={hidden ? "line-through" : ""}>{label}</span>{hidden && <span className="normal-case tracking-normal text-zinc-400">Not in the deck</span>}<span className="ml-auto"><SlideToggle hidden={hidden} onToggle={onToggle} /></span></div>
      {!hidden && <>
      <div className="grid gap-2 sm:grid-cols-2">{items.map((b, i) => (
        <div key={i} className="space-y-1 rounded-md border border-zinc-200 p-2">
          <input value={b.title} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={`${input} font-semibold`} />
          <Grow value={b.text} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className={input} />
        </div>))}
      </div></>}
    </div>
  );
}

export function ProposalModal({ group, onClose, onLink }) {
  const id = group.clientId || group.name;
  const website = (group.recs.find((x) => x.website) || {}).website || "";
  // Ideas worth pitching: not declined or done, not our own internal jobs.
  // Support jobs (fixes, cookie banners, footer years, alt text…) go to support, never into a proposal.
  const isSupport = (i) => ideaType(i) === "fix" || (i.service || serviceFor(i.title)) === "Support";
  const supportKeys = new Set(group.queue.filter(isSupport).map((i) => i.key));
  const pool = group.queue.filter((i) => !["declined", "done"].includes(i.status) && !i.internal && !isSupport(i));
  const [doc, setDoc] = useState(null); // { step, picked: {key: line}, own: [line], notes, copy }
  const [images, setImages] = useState({});
  // Screenshots of the client's pages (the ones Claude picked), taken for you in the review step. Kept in this browser only.
  const [shotState, setShotState] = useState({}); // key -> "loading" | "failed"
  const asked = useRef(new Set());
  // Where each picture came from: "shot" (their site, captioned "Current layout" in the deck), "stock" or "own".
  const [shotKind, setShotKind] = useState({});
  // A stock photo for an idea with nothing to screenshot yet (a new page or feature), so every idea slide has a picture.
  const getStock = (key, q) => getShot(key, "", "", `/api/stock?q=${encodeURIComponent(q)}`);
  function getShot(key, url, sel = "", src = "") {
    asked.current.add(key);
    setShotState((o) => ({ ...o, [key]: "loading" }));
    fetch(src || `/api/shot?url=${encodeURIComponent(url)}${sel ? `&sel=${encodeURIComponent(sel)}` : ""}`).then((r) => (r.ok ? r.blob() : Promise.reject())).then(shrink)
      .then((data) => { setImages((o) => ({ ...o, [key]: data })); setShotKind((o) => ({ ...o, [key]: src ? "stock" : "shot" })); setShotState((o) => ({ ...o, [key]: "" })); })
      .catch(() => setShotState((o) => ({ ...o, [key]: "failed" })));
  }
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  // Where the finished deck lives once it's uploaded (e.g. SharePoint), kept on the client for the whole team.
  const [deckUrl, setDeckUrl] = useState(group.client?.proposalUrl || "");
  const saveLink = (v) => { const u = String(v || "").trim(); if (u && !/^https?:\/\//i.test(u)) return; setDeckUrl(u); onLink?.(u); };
  const [reply, setReply] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const saveT = useRef(null);
  const pending = useRef(null);
  const [saved, setSaved] = useState("");
  const flush = () => {
    const d = pending.current; if (!d) return;
    pending.current = null; clearTimeout(saveT.current); setSaved("Saving…");
    saveShared(id, d).then((r) => setSaved(r.shared ? "Saved" : r.error ? "Saved on this computer only (couldn't reach the shared store)" : "Saved on this computer"));
  };
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  // Anything not yet sent goes when the window closes or the page is left.
  useEffect(() => { const f = () => flushRef.current(); window.addEventListener("pagehide", f); return () => { window.removeEventListener("pagehide", f); f(); }; }, []);
  const [points, setPoints] = useState(RETAINER_DEFAULTS);
  const [tplExtras, setTplExtras] = useState([]); // extra slides from the uploaded template, so they can be left out of this deck
  useEffect(() => { templateMeta().then((m) => setTplExtras((m?.extras || []).map((e, i) => ({ ...e, i })).filter((e) => !/^\s*our clients\b/i.test(e.title || "")))).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/settings?key=retainer-points").then((r) => r.json()).then((j) => { if (j.shared && j.value?.items) setPoints(normalisePoints(j.value)); }).catch(() => {}); }, []);
  const [defaultRate, setDefaultRate] = useState(DAY_RATE); // Settings → Proposals; each client can have its own
  useEffect(() => { fetch("/api/settings?key=day-rate").then((r) => r.json()).then((j) => setDefaultRate(rateOf(j.value))).catch(() => {}); }, []);

  useEffect(() => {
    let live = true;
    loadDoc(id).then((saved) => {
      if (!live) return;
      if (saved) { setDoc(saved); return; }
      // First time: starred ideas, then Claude's top ideas while the total stays inside about 3 days (18 hrs).
      const order = [...pool.filter((i) => i.starred), ...group.top.filter((i) => !i.internal && ideaType(i) !== "fix"), ...pool].filter((i, n, a) => a.findIndex((x) => x.key === i.key) === n);
      const picked = {}; let hrs = 0;
      for (const i of order) { const l = lineFromIdea(i); if (i.starred || (Object.keys(picked).length < 5 && hrs + l.max <= 18)) { picked[i.key] = l; hrs += l.max; } }
      setDoc({ step: 0, picked, own: [], notes: "", copy: null });
    });
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const change = (fn) => setDoc((d) => {
    const next = { ...fn(d), updatedAt: new Date().toISOString(), client: group.name };
    saveLocal(id, next);
    pending.current = next;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(flush, 300);
    return next;
  });
  const allLines = (doc ? [...pool.filter((i) => doc.picked[i.key]).map((i) => doc.picked[i.key]), ...Object.values(doc.picked).filter((l) => !pool.some((i) => i.key === l.key) && !l.custom), ...doc.own] : []).filter((l) => l.custom || (!supportKeys.has(l.key) && l.service !== "Support")).map((l) => { const t = Object.values(teamHours(l)).reduce((x, y) => x + y, 0); return t && !isPackageLine(l) ? { ...l, min: t, max: t } : l.min === l.max ? l : { ...l, min: l.max }; }) // the total is always the rounded team hours // one set figure (older drafts had a range); support jobs never. New ideas start with design beside development, but you can take it off
;
  // Take an idea out of this proposal (yours are deleted; Client Ideas ones are just unticked).
  const removeLine = (key) => change((d) => { const picked = { ...d.picked }; delete picked[key]; return { ...d, picked, own: d.own.filter((x) => x.key !== key) }; });
  const setLine = (key, fields) => change((d) => (d.own.some((l) => l.key === key) ? { ...d, own: d.own.map((l) => (l.key === key ? { ...l, ...fields, max: Math.max(fields.max ?? l.max, fields.min ?? l.min) } : l)) } : { ...d, picked: { ...d.picked, [key]: { ...d.picked[key], ...fields, max: Math.max(fields.max ?? d.picked[key].max, fields.min ?? d.picked[key].min) } } }));
  const chosenIds = doc?.points || points.filter((x) => x.always).map((x) => x.id);
  const chosen = points.filter((x) => chosenIds.includes(x.id));
  const pkgIds = effectivePackages(doc?.packages || [], allLines);
  const picked = pickedPackages(pkgIds);
  // Biggest first by value (hours at the day rate, packages at their price), free work last, when a step opens.
  // After that each idea keeps its place while you change its hours or teams; new ideas join at the end.
  const [order, setOrder] = useState(null); // { scope, keys }
  const dayRate = Number(doc?.dayRate) > 0 ? Number(doc.dayRate) : defaultRate;
  const sorted = [...allLines].sort((a, b) => isSeoLine(a) - isSeoLine(b) || lineValue(b, picked, dayRate) - lineValue(a, picked, dayRate)); // the SEO idea always last
  const scope = `${id}:${doc?.step}`, kept = order?.scope === scope ? order.keys : null;
  const lines = kept ? [...kept.map((k) => allLines.find((l) => l.key === k)).filter(Boolean), ...sorted.filter((l) => !kept.includes(l.key))] : sorted;
  if (lines.map((l) => l.key).join() !== (kept || []).join()) setOrder({ scope, keys: lines.map((l) => l.key) });
  const resort = () => setOrder({ scope, keys: sorted.map((l) => l.key) });
  const unsorted = lines.some((l, n) => l.key !== sorted[n]?.key);
  const prompt = doc && lines.length ? withTitle("Proposal deck", group.name, proposalPrompt({ client: group.name, website, lines: lines.map((l) => { const i = pool.find((x) => x.key === l.key); return i ? { ...l, issue: l.issue || i.issue || "", solution: l.solution || i.solution || "", links: l.links || [...new Set([...(i.links || []), i.evidenceUrl].filter(Boolean))] } : l; }), notes: doc.notes, points: chosen, packages: picked, keep: copyEdits(doc.copy), prices: !doc.noPrices, ideaNotes: (doc.claudeNotes || "").trim() })) : "";

  function applyReply(text) {
    const copy = parseProposalReply(text);
    if (!copy.ideas.length) throw new Error("No ideas in that reply. Paste Claude's whole JSON block.");
    // Ideas Claude added from Notes for Claude ("new:…" keys) join the deck as your own ideas.
    const known = new Set(lines.map((l) => l.key));
    const added = copy.ideas.filter((x) => !known.has(x.key) && /^new:/.test(x.key));
    change((d) => ({ ...d, own: [...d.own.filter((l) => !added.some((x) => x.key === l.key)), ...added.map((x) => ({ ...lineFromIdea({ key: x.key, title: x.title, why: x.intro, service: x.service || serviceFor(x.title), hours: x.max }), custom: true }))], copy: { ...withEdits(copy, copyEdits(d.copy)), hide: d.copy?.hide || {} }, step: 3 }));
    setReply(""); setErr("");
    return `Proposal copy for ${group.name}: ${copy.ideas.length} idea slides${added.length ? ` (${added.length} new from your notes)` : ""}`;
  }
  useClaudeHandler("proposal", applyReply);
  useEffect(() => {
    if (doc?.step !== 3 || !doc.copy) return;
    const seoKeys = new Set(allLines.filter(isSeoLine).map((l) => l.key)); // the SEO slide is text only
    const t = setTimeout(() => {
      if (website && !doc.copy.noCover && !images.cover && !asked.current.has("cover")) getShot("cover", `https://${website}`);
      if (!doc.copy.hide?.pictures) for (const c of doc.copy.ideas || []) if (!seoKeys.has(c.key) && !c.noImage && !images[c.key] && !asked.current.has(c.key)) { if (c.shot) getShot(c.key, c.shot, c.shotSel); else getStock(c.key, c.stock || c.title); }
    }, 0);
    return () => clearTimeout(t);
  });
  async function copyPrompt(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  async function download() {
    setBusy(true); setErr("");
    try {
      const { buildDeck } = await import("@/app/proposalDeck");
      const template = await loadTemplate().catch(() => null);
      await buildDeck({ client: group.name, website, lines, copy: doc.copy, images, packages: pkgIds, template, dayRate, tiers: doc.tiersOn ? doc.tierOf || {} : false, savings: doc.tierSavings || {}, prices: !doc.noPrices, captions: Object.fromEntries(Object.entries(shotKind).filter(([, k]) => k === "shot").map(([key]) => [key, "Current layout"])) });
    }
    catch (e) { setErr(`Couldn't build the deck: ${e.message}`); }
    setBusy(false);
  }
  // Drafts from before hand edits were tracked get Claude's text as it stands now as their starting point.
  const setCopy = (fields) => change((d) => ({ ...d, copy: { ...d.copy, original: d.copy?.original || withEdits(d.copy, null).original, ...fields } }));
  const hidden = doc?.copy?.hide || {};
  const toggle = (k) => ({ hidden: !!hidden[k], onToggle: () => setCopy({ hide: { ...hidden, [k]: !hidden[k] } }) });
  // The Bronze / Silver / Gold slide is off unless switched on (hide.tiers === false).
  const tiersToggle = { hidden: !doc?.tiersOn, onToggle: () => change((d) => ({ ...d, tiersOn: !d.tiersOn })) };
  const ownSplit = Object.keys(doc?.tierOf || {}).length > 0;
  const options = doc?.tiersOn && !doc.noPrices ? (ownSplit ? [tierPlan(lines, picked, dayRate, doc.tierOf, doc.tierSavings || {})].filter(Boolean) : tierOptions(lines, picked, dayRate, doc.tierSavings || {})) : [];
  const plan = options[0] || null;
  const tierProps = (key) => (plan?.tierOf[key] ? { tier: plan.tierOf[key], onTier: (t) => change((d) => ({ ...d, tierOf: { ...plan.tierOf, ...d.tierOf, [key]: t } })) } : {}); // moving one idea makes the (first) option your own split
  const optText = (p) => ["bronze", "silver", "gold"].map((t) => `${t[0].toUpperCase()}${t.slice(1)} £${p[t].price.toLocaleString("en-GB")} (${p[t].lines.length})`).join(" · ");
  const tierPreview = !plan ? "needs at least three paid ideas" : options.length > 1 ? `${options.length} options, one slide each (keep the best, delete the others): ${options.map((p, n) => `${n + 1}) ${optText(p)}`).join("  |  ")}` : optText(plan);
  const setIdeaCopy = (key, fields) => setCopy({ ideas: doc.copy.ideas.map((x) => (x.key === key ? { ...x, ...fields } : x)) });
  const step = doc?.step || 0;
  const canGo = (n) => n === 0 || (n <= 2 ? lines.length > 0 : !!doc?.copy);

  return (
    <PricesShown.Provider value={!doc?.noPrices}>
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3"><h3 className="text-lg font-semibold">Proposal deck: {group.name}</h3>{website && <a href={`https://${website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">{website} <ExternalIcon /></a>}{deckUrl && <a href={deckUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100" title="The finished deck on SharePoint">Saved deck <ExternalIcon /></a>}<span className="ml-auto text-xs text-zinc-400">{saved}</span><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button></div>
        {!doc ? <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><SpinnerIcon className="h-4 w-4 animate-spin" /> Loading…</div> : (
          <div className="space-y-4 px-5 py-4">
            <ol className="flex flex-wrap items-center gap-1.5">{STEPS.map((s, n) => (
              <li key={s}><button onClick={() => canGo(n) && change((d) => ({ ...d, step: n }))} disabled={!canGo(n)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${step === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{n < step ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <span className="opacity-60">{n + 1}</span>}{s}</button></li>))}
              {/* Unticked: no prices, costs or hours anywhere in the deck (no estimate bars, summary, cost, package, support or tier slides). */}
              <li className="ml-auto mr-3 flex items-center"><label className="inline-flex items-center gap-1.5 text-xs leading-none text-zinc-600" title="Untick for a deck with no prices, costs or hours at all"><input type="checkbox" checked={!doc.noPrices} onChange={() => change((d) => ({ ...d, noPrices: !d.noPrices }))} className="h-3.5 w-3.5" />Include prices</label></li>
              {!doc.noPrices && <li className="flex items-center"><label className="inline-flex items-center gap-1 text-xs text-zinc-600" title={`This client's day rate: prices the hours on each slide. Empty uses the default (£${defaultRate}) from Settings → Proposals`}>Day rate £<input type="number" min={1} step={25} value={doc.dayRate ?? ""} placeholder={String(defaultRate)} onChange={(e) => change((d) => ({ ...d, dayRate: e.target.value === "" ? undefined : Number(e.target.value) }))} className={num} aria-label="Day rate for this client" /></label></li>}
            </ol>

            {step === 0 && (
              <div className="space-y-2">
                {doc.noPrices ? <p className="text-xs text-zinc-600">Tick the ideas to pitch. Starred ideas are ticked for you.</p> : <p className="text-xs text-zinc-600">Tick the ideas to pitch. Starred ideas and the top ones that fit in about 3 days are ticked for you. Adjust the hours (for a person doing it by hand, not AI) and who does it. Aim for about <b>3 days</b>: it&apos;s an easy yes, and the retainer slide pitches the rest.</p>}
                {!doc.noPrices && <label className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
                  <input type="checkbox" checked={!!doc.tiersOn} onChange={tiersToggle.onToggle} className="mt-0.5 h-4 w-4" />
                  <span><span className="font-semibold">Offer Bronze / Silver / Gold options</span> <span className="text-zinc-500">(a &quot;Choose your package&quot; slide built from these ideas; Silver is priced to be the easy choice)</span>
                    {doc.tiersOn && <span className="mt-1 block text-xs text-zinc-600">{tierPreview}{plan && " · click a price pill to move an idea to another tier (this makes one split of your own; reset to auto for 3 options)"}{doc.tierOf && Object.keys(doc.tierOf).length > 0 && <> · <button type="button" onClick={(e) => { e.preventDefault(); change((d) => ({ ...d, tierOf: {} })); }} className="underline hover:text-zinc-900">reset to auto</button></>}
                      {plan && <span className="mt-1 flex flex-wrap items-center gap-3" onClick={(e) => e.preventDefault()}>{["silver", "gold"].map((t) => <span key={t} className="inline-flex items-center gap-1" title={`Leave blank for the usual saving. Price = the ${t} items' total minus this saving`}>{t[0].toUpperCase()}{t.slice(1)} saving £<input type="number" min={0} step={50} value={doc.tierSavings?.[t] ?? ""} placeholder={String(Math.round(plan[t].full - plan[t].price))} onChange={(e) => { const v = e.target.value; change((d) => ({ ...d, tierSavings: { ...d.tierSavings, [t]: v === "" ? undefined : Number(v) } })); }} className="w-20 rounded border border-zinc-300 px-1.5 py-0.5 text-xs" /></span>)}<span className="text-zinc-500">Thin out Bronze or Silver by moving their biggest ideas up a tier.</span></span>}</span>}</span>
                </label>}
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {pool.length === 0 && <li className="p-3 text-sm text-zinc-500">No ideas for this client yet. Add your own below.</li>}
                  {pool.map((i) => { const l = doc.picked[i.key]; return (
                    <li key={i.key} className={`flex flex-wrap items-start gap-2 px-3 py-2 text-sm ${l ? "bg-emerald-50/50" : ""}`}>
                      <input type="checkbox" checked={!!l} onChange={() => change((d) => { const p = { ...d.picked }; if (p[i.key]) delete p[i.key]; else p[i.key] = lineFromIdea(i); return { ...d, picked: p }; })} className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-[16rem] flex-1 leading-snug" title={[i.issue && `Issue: ${i.issue}`, i.solution && `Solution: ${i.solution}`].filter(Boolean).join("\n") || i.why}>{i.title}{i.starred && <span className="ml-1.5 text-amber-500">★</span>}<IdeaDetail idea={i} /></span>
                      {l && <><PricePill picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(i.key, f)} {...tierProps(l.key)} /><Effort pill={false} picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(i.key, f)} /></>}
                    </li>); })}
                  {Object.values(doc.picked).filter((l) => !pool.some((i) => i.key === l.key)).map((l) => (
                    <li key={l.key} className="flex flex-wrap items-center gap-2 bg-amber-50/60 px-3 py-2 text-sm">
                      <input type="checkbox" checked onChange={() => removeLine(l.key)} className="h-4 w-4" title="Untick to take it out of this proposal" />
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="Still in this proposal, but no longer on the Client Ideas list (done, declined or removed)">Not in Client Ideas now</span>
                      <span className="min-w-[16rem] flex-1 leading-snug" title={l.why}>{l.title}</span>
                      <PricePill picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(l.key, f)} {...tierProps(l.key)} /><Effort pill={false} picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(l.key, f)} />
                    </li>))}
                </ul>
                {doc.own.length > 0 && <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{doc.own.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">Yours</span><span className="min-w-[16rem] flex-1 leading-snug" title={l.why}>{l.title}</span><PricePill picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(l.key, f)} {...tierProps(l.key)} /><button onClick={() => change((d) => ({ ...d, own: d.own.filter((x) => x.key !== l.key) }))} aria-label="Remove" className="rounded p-1 text-zinc-400 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button><Effort pill={false} picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(l.key, f)} /></li>))}
                </ul>}
                {/* Notes for Claude: your own ideas, which Claude researches, turns into full ideas and adds to. */}
                <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes for Claude</div>
                  <Grow value={doc.claudeNotes || ""} onChange={(e) => change((d) => ({ ...d, claudeNotes: e.target.value }))} placeholder="Ideas you'd like Claude to look into, one per line, e.g. a members' area for investors, a German version of the energy pages" className={`${input} min-h-[4.5rem]`} />
                  <p className="text-xs text-zinc-500">These go into the prompt in step 3: Claude researches each one and adds the ones that hold up as extra idea slides.</p>
                </div>
                <div className="flex justify-end"><button onClick={() => change((d) => ({ ...d, step: 1 }))} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Next: packages & retainer</button></div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Packages to offer (optional)</div>
                  <div className="space-y-1.5">{PACKAGE_GROUPS.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-center gap-1.5"><span className="w-32 shrink-0 text-xs font-semibold text-zinc-700">{g.name}{g.fixed ? <span className="block text-[10px] font-normal text-zinc-500">Set price, no hours</span> : <span className="block text-[10px] font-normal text-zinc-500">Monthly</span>}</span>
                      {g.tiers.map((x) => { const id = `${g.id}:${x.id}`, on = pkgIds.includes(id); return <button key={id} type="button" title={x.items.join(" · ")} onClick={() => change((d) => ({ ...d, packages: SINGLE_TIER.has(g.id) ? [...pkgIds.filter((y) => !y.startsWith(`${g.id}:`)), ...(on ? [] : [id])] : on ? pkgIds.filter((y) => y !== id) : [...pkgIds, id] }))} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-indigo-700 bg-indigo-700 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100"}`}>{on ? "✓ " : ""}{x.name} · {x.price}</button>; })}
                    </div>))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">Each package you pick gets its own slide, and Claude mentions it in the copy. SEO, PPC and Videography work is always priced by its package (Bronze by default, videography from £1,999), so it has no hours and shows under costs instead.</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Retainer selling points<Link href="/settings?section=proposals" target="_blank" className="ml-auto font-medium normal-case tracking-normal text-blue-700 hover:underline">Edit in Settings</Link></div>
                  <div className="flex flex-wrap gap-1.5">{points.map((x) => { const on = chosenIds.includes(x.id); return <button key={x.id} type="button" title={x.text} onClick={() => change((d) => ({ ...d, points: on ? chosenIds.filter((y) => y !== x.id) : [...chosenIds, x.id] }))} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100"}`}>{on ? "✓ " : ""}{x.title}</button>; })}</div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">Claude builds the retainer slide from the ones ticked. Untick any that don&apos;t fit this client (e.g. Local to you).</p>
                </div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes for Claude (optional)<textarea value={doc.notes} onChange={(e) => change((d) => ({ ...d, notes: e.target.value }))} rows={2} placeholder="e.g. They're launching a new service in spring; keep it to a refresh, not a rebuild" className={`${input} mt-0.5 font-normal normal-case tracking-normal`} /></label>
                <div className="flex justify-between"><button onClick={() => change((d) => ({ ...d, step: 0 }))} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Back</button><button onClick={() => change((d) => ({ ...d, step: 2 }))} disabled={!lines.length} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Next: Claude writes it</button></div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-600">Claude checks {website || "their website"} and writes the deck copy: background, biggest wins, a slide per idea and the retainer pitch. It also flags any hour estimate that looks wrong. Use a new chat with web search on.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => copyPrompt(true)} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"><ExternalIcon /> Copy and open Claude</button>
                  <button onClick={() => copyPrompt(false)} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">{copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy prompt</>}</button>
                </div>
                <textarea readOnly value={prompt} rows={5} className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-600" />
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Paste Claude&apos;s reply<textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} placeholder="```json { &quot;proposal&quot;: … } ```" className={`${input} mt-0.5 font-mono text-xs font-normal normal-case tracking-normal`} /></label>
                {err && <p className="text-sm text-red-700">{err}</p>}
                <div className="flex justify-between"><button onClick={() => change((d) => ({ ...d, step: 1 }))} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Back</button><button onClick={() => { try { applyReply(reply); } catch (e) { setErr(e.message); } }} disabled={!reply.trim()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Use this reply</button></div>
              </div>
            )}

            {step === 3 && doc.copy && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start gap-3">
                  <ImageDrop value={images.cover} status={shotState.cover} onShot={website ? () => { setCopy({ noCover: false }); getShot("cover", `https://${website}`); } : null} onChange={(v) => { setImages((o) => ({ ...o, cover: v })); if (!v) setCopy({ noCover: true }); }} label="Cover image (their homepage is added for you)" />
                  <label className="min-w-[14rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Deck title<input value={doc.copy.deckTitle} onChange={(e) => setCopy({ deckTitle: e.target.value.toUpperCase() })} className={`${input} mt-0.5`} /><span className="mt-1 block font-normal normal-case tracking-normal text-zinc-500">Images stay in this browser only (not saved), so add them just before you download.</span></label>
                </div>
                <BlockList label="Background" items={doc.copy.background} onChange={(background) => setCopy({ background })} {...toggle("background")} />
                <BlockList label="Where the biggest wins are" items={doc.copy.wins} onChange={(wins) => setCopy({ wins })} {...toggle("wins")} />
                <div className="space-y-2"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Idea slides{unsorted && <button type="button" onClick={resort} className="rounded px-1.5 py-0.5 font-normal normal-case tracking-normal text-blue-700 hover:bg-blue-50">Sort biggest first</button>}</div>
                  {lines.map((l, n) => { const c = doc.copy.ideas.find((x) => x.key === l.key); return (
                    <div key={l.key} className="relative flex flex-wrap gap-3 rounded-lg border border-zinc-200 p-3 pr-10">
                      <button onClick={() => { if (window.confirm(`Take “${c?.title || l.title}” out of this proposal?`)) removeLine(l.key); }} aria-label="Remove from deck" title="Remove this idea from the deck" className="absolute right-2 top-2 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button>
                      <div className="min-w-[16rem] flex-1 space-y-1">
                        {!c ? <p className="text-sm text-amber-700">{n + 1}. {l.title}: Claude didn&apos;t write this one, so the slide uses your title and notes.</p> : <>
                          <input value={c.title} onChange={(e) => setIdeaCopy(l.key, { title: e.target.value })} className={`${input} font-semibold`} aria-label="Slide title" />
                          <Grow value={c.intro} onChange={(e) => setIdeaCopy(l.key, { intro: e.target.value })} className={input} aria-label="Intro" />
                          <Bullets items={c.bullets} onChange={(bullets) => setIdeaCopy(l.key, { bullets })} />
                          <input value={c.closing} onChange={(e) => setIdeaCopy(l.key, { closing: e.target.value })} placeholder="Closing benefit (optional)" className={input} />
                        </>}
                        <div className="flex flex-wrap items-center gap-2 pt-1"><Effort picked={picked} rate={dayRate} line={l} onChange={(f) => setLine(l.key, f)} {...tierProps(l.key)} />
                          {!doc.noPrices && c?.max && c.max !== l.max && <button onClick={() => { const th = teamHours(l), tot = Object.values(th).reduce((x, y) => x + y, 0) || 1, hrs = Object.fromEntries(Object.entries(th).map(([k, h]) => [k, snapHours((h * c.max) / tot)])); const t = Object.values(hrs).reduce((x, y) => x + y, 0); setLine(l.key, { hrs, min: t, max: t }); }} title={c.hoursNote} className="block w-full rounded-md bg-orange-50 px-2.5 py-1.5 text-left text-[11px] text-orange-800 ring-1 ring-orange-200 hover:bg-orange-100"><span className="font-semibold">Claude suggests {c.max} hrs · use</span>{c.hoursNote && <span className="mt-0.5 block">{c.hoursNote}</span>}</button>}</div>
                      </div>
                      <ImageDrop value={images[l.key]} status={shotState[l.key]} onShot={c ? () => { setIdeaCopy(l.key, { noImage: false }); if (c.shot) getShot(l.key, c.shot, c.shotSel); else getStock(l.key, c.stock || c.title); } : null} shotLabel={c?.shot ? "Use the page screenshot" : "Use a stock photo"} onChange={(v) => { setImages((o) => ({ ...o, [l.key]: v })); setShotKind((o) => ({ ...o, [l.key]: "own" })); if (!v && c) setIdeaCopy(l.key, { noImage: true }); }} label="No picture on this slide" />
                    </div>); })}
                </div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Roadmap slide title<input value={doc.copy.roadmapTitle || ""} onChange={(e) => setCopy({ roadmapTitle: e.target.value })} placeholder="Too much in one go? Roadmap it over N months with a support retainer (N is worked out for you)" className={`${input} mt-0.5 font-normal normal-case tracking-normal`} /></label>
                <BlockList label="Support retainer" items={doc.copy.retainer} onChange={(retainer) => setCopy({ retainer })} {...toggle("retainer")} />
                <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Standard slides</div>
                  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{[["agenda", "Agenda"], ["linkedin", "LinkedIn suggestions (and LinkedIn Automations in monthly costs)"], ["pictures", "Pictures on idea slides"], ["effort", "Investment summary table"], ["tiers", "Bronze / Silver / Gold options (switch on to add)"], ["roadmap", "Month-by-month roadmap"], ["costs", "Monthly / one-off costs table"], ["services", "Our service retainer offering"], ["support", "Support packages (Bronze, Silver, Gold)"], ["packages", "SEO / PPC package slides"], ...tplExtras.map((e) => [`extra:${e.i}`, `Your slide: ${e.title.slice(0, 50)}`])].map(([k, name]) => (
                    <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-sm"><span className={(k === "tiers" ? tiersToggle.hidden : hidden[k]) ? "text-zinc-400 line-through" : ""}>{name}{k === "tiers" && !tiersToggle.hidden && <span className="ml-2 text-xs text-zinc-500">{tierPreview}</span>}</span>{k === "linkedin" && !hidden.linkedin && <label className="text-xs text-zinc-600">Posts a month <input type="number" min={1} value={doc.copy.linkedinPosts ?? ""} placeholder="8" onChange={(e) => setCopy({ linkedinPosts: e.target.value === "" ? undefined : Number(e.target.value) })} className="ml-1 w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-xs" /></label>}<span className="ml-auto"><SlideToggle {...(k === "tiers" ? tiersToggle : toggle(k))} /></span></li>))}
                  </ul>
                </div>
                {err && <p className="text-sm text-red-700">{err}</p>}
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Link to the saved deck (SharePoint)
                  <span className="mt-0.5 flex gap-2"><input defaultValue={deckUrl} key={deckUrl} onBlur={(e) => saveLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} placeholder="Paste the SharePoint link after you upload the deck" className={`${input} font-normal normal-case tracking-normal`} />
                    {deckUrl && <a href={deckUrl} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-3 text-sm font-normal normal-case tracking-normal text-zinc-700 hover:bg-zinc-100">Open <ExternalIcon /></a>}</span>
                  <span className="mt-1 block font-normal normal-case tracking-normal text-zinc-500">Shows as a Deck link on the client in Client Ideas, for everyone.</span></label>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3">
                  <button onClick={() => change((d) => ({ ...d, step: 2 }))} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Back: ask Claude again</button>
                  <button onClick={async () => { await navigator.clipboard.writeText(ideasText({ lines, copy: doc.copy })).catch(() => {}); setTextCopied(true); setTimeout(() => setTextCopied(false), 2500); }} title="Every idea from the deck as text (title, intro, bullet points, hours; no prices), ready to paste into the written proposal. Headings and bullets are kept in Word and Google Docs." className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100">{textCopied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon /> Copy changes as text</>}</button>
                  <button onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy && <SpinnerIcon className="h-4 w-4 animate-spin" />} Download deck (.pptx)</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </PricesShown.Provider>
  );
}

// Settings → Proposals: the day rate that prices the hours on each idea slide and orders the ideas.
export function DayRateEditor() {
  const [rate, setRate] = useState("");
  const [state, setState] = useState("");
  useEffect(() => { fetch("/api/settings?key=day-rate").then((r) => r.json()).then((j) => setRate(String(rateOf(j.value)))).catch(() => setRate(String(DAY_RATE))); }, []);
  async function save() {
    const n = Number(rate);
    if (!(n > 0)) { setState("Enter a number above 0"); return; }
    setState("Saving…");
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "day-rate", value: { rate: n } }) }).then((x) => x.json()).catch(() => ({}));
    setState(r.shared ? "Saved" : "Couldn't save to the shared store");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-600">£</span><input type="number" min={1} step={25} value={rate} onChange={(e) => setRate(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className="w-28 rounded-md border border-zinc-300 px-2 py-1 text-sm" aria-label="Day rate in pounds" />
      <span className="text-zinc-500">per 7.5-hour day{rate > 0 ? ` (£${Math.round(Number(rate) / 7.5)} an hour)` : ""}</span>
      {state && <span className="text-xs text-zinc-500">{state}</span>}
    </div>
  );
}

// Settings → Proposals: the retainer selling points every proposal can pick from.
export function RetainerPointsEditor() {
  const [items, setItems] = useState(null);
  const [state, setState] = useState("");
  useEffect(() => { fetch("/api/settings?key=retainer-points").then((r) => r.json()).then((j) => setItems(normalisePoints(j.shared ? j.value : null))).catch(() => setItems(normalisePoints(null))); }, []);
  async function save(next) {
    setItems(next); setState("Saving…");
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "retainer-points", value: { items: next } }) }).then((x) => x.json()).catch(() => ({}));
    setState(r.shared ? "Saved" : "Saved on this page only (no shared store)");
  }
  if (!items) return <p className="text-sm text-zinc-500">Loading…</p>;
  const set = (n, f) => setItems(items.map((x, j) => (j === n ? { ...x, ...f } : x)));
  return (
    <div className="space-y-2">
      {items.map((x, n) => (
        <div key={x.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-zinc-200 p-2">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <input value={x.title} onChange={(e) => set(n, { title: e.target.value })} onBlur={() => save(items)} placeholder="e.g. Local to you" className={`${input} font-semibold`} />
            <Grow value={x.text} onChange={(e) => set(n, { text: e.target.value })} onBlur={() => save(items)} placeholder="One sentence Claude can use" className={input} />
          </div>
          <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-zinc-600" title="Ticked for every new proposal (you can untick it per client)"><input type="checkbox" checked={x.always} onChange={(e) => save(items.map((y, j) => (j === n ? { ...y, always: e.target.checked } : y)))} /> Ticked by default</label>
          <button onClick={() => save(items.filter((_, j) => j !== n))} aria-label="Delete point" className="mt-0.5 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex items-center gap-3"><button onClick={() => save([...items, { id: `p${Date.now().toString(36)}`, title: "New point", text: "", always: false }])} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">+ Add point</button><span className="text-xs text-zinc-500">{state}</span></div>
    </div>
  );
}

// Settings → Proposals: your own PowerPoint slides for the parts of the deck that never change.
export function TemplateEditor() {
  const [meta, setMeta] = useState(undefined); // the saved template's details (null = none)
  const [file, setFile] = useState(null); // { name, zip, slides }
  const [slots, setSlots] = useState({}); // slot -> index into file.slides
  const [extras, setExtras] = useState({}); // index into file.slides -> anchor (extra slides to include)
  const [state, setState] = useState("");
  useEffect(() => { templateMeta().then(setMeta).catch(() => setMeta(null)); }, []);
  async function pick(f) {
    if (!f || !/\.pptx$/i.test(f.name)) { setState("Choose a .pptx file"); return; }
    setState("Reading…");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(f);
      const slides = await listSlides(zip);
      // A first guess at which slide is which, from the words on it.
      const guess = (re) => slides.findIndex((x) => re.test(x.title));
      const g = { support: guess(/support packages|bronze support/i), services: guess(/service retainer offering/i), seo: guess(/\bseo\b.*package|seo packages/i), ppc: guess(/\bppc\b.*package|ppc packages/i), video: guess(/videography/i), closing: slides.length - 1 };
      setFile({ name: f.name, zip, slides }); setSlots(Object.fromEntries(Object.entries(g).filter(([, v]) => v >= 0))); setExtras({}); setState("");
    } catch (e) { setState(`Couldn't read that file: ${e.message}`); }
  }
  async function save() {
    const chosen = Object.entries(slots).filter(([, v]) => Number.isInteger(v));
    const extraList = Object.entries(extras).map(([i, after]) => ({ i: Number(i), after })).sort((a, b) => a.i - b.i);
    if (!chosen.length && !extraList.length) { setState("Pick at least one slide"); return; }
    setState("Preparing…");
    try {
      const [{ default: PptxGenJS }, { pruneTemplate, saveTemplate }] = await Promise.all([import("pptxgenjs"), import("@/lib/deckTemplate")]);
      const shell = new PptxGenJS(); shell.defineLayout({ name: "ICL", width: 19.44, height: 12.5 }); shell.layout = "ICL";
      const paths = [...new Set([...chosen.map(([, v]) => file.slides[v].path), ...extraList.map((e) => file.slides[e.i].path)])];
      const blob = await pruneTemplate(file.zip, paths, await shell.write({ outputType: "blob" }));
      const map = Object.fromEntries(chosen.map(([k, v]) => [k, paths.indexOf(file.slides[v].path)]));
      const m = await saveTemplate(blob, map, file.name, (i, n) => setState(`Uploading… ${i} of ${n}`), extraList.map((e) => ({ index: paths.indexOf(file.slides[e.i].path), after: e.after, title: file.slides[e.i].title })));
      setMeta(m); setFile(null); setState("Saved");
    } catch (e) { setState(`Couldn't save: ${e.message}`); }
  }
  async function remove() {
    if (!window.confirm("Remove your template? Decks go back to the built-in slides.")) return;
    await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: TEMPLATE_KEY, value: {} }) }).catch(() => {});
    setMeta(null); setState("Removed");
  }
  const sel = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm";
  return (
    <div className="space-y-3 text-sm">
      {meta === undefined ? <p className="text-zinc-500">Loading…</p> : meta ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span><b>Your template is in use</b>: {meta.name} · {Object.keys(meta.slots || {}).length + (meta.extras || []).length} slide{Object.keys(meta.slots || {}).length + (meta.extras || []).length === 1 ? "" : "s"} · {new Date(meta.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {[...FIXED_SLIDES.filter(([k]) => k in (meta.slots || {})).map(([, n]) => n), ...(meta.extras || []).map((e) => `“${e.title.slice(0, 30)}”`)].join(", ")}</span>
          <button onClick={remove} className="ml-auto text-xs text-red-700 hover:underline">Remove</button>
        </div>
      ) : <p className="text-zinc-500">No template uploaded: decks use the built-in slides.</p>}
      <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-center text-zinc-600 hover:border-zinc-400" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        <span>{file ? <><b>{file.name}</b>: {file.slides.length} slides. Now say which slide is which below.</> : <>Drop your .pptx here or click to choose {meta ? "a new version" : "it"}</>}</span>
        <input type="file" accept=".pptx" className="hidden" onChange={(e) => pick(e.target.files[0])} />
      </label>
      {file && (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
          {FIXED_SLIDES.map(([k, name]) => (
            <label key={k} className="flex flex-wrap items-center gap-2"><span className="w-56 font-medium">{name}</span>
              <select value={Number.isInteger(slots[k]) ? slots[k] : ""} onChange={(e) => setSlots((o) => { const n = { ...o }; if (e.target.value === "") delete n[k]; else n[k] = Number(e.target.value); return n; })} className={`${sel} min-w-0 flex-1`}>
                <option value="">Built-in slide</option>
                {file.slides.map((x, i) => <option key={x.path} value={i}>Slide {i + 1}: {x.title}</option>)}
              </select>
            </label>))}
          <div className="mt-2 border-t border-zinc-200 pt-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Extra slides to include</div>
            <p className="mb-1.5 text-xs text-zinc-500">Tick any other slide to add it to every deck, and say where it goes. They can be left out of a single deck in its review step.</p>
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200">{file.slides.map((x, i) => {
              const used = Object.values(slots).includes(i); const on = i in extras; return (
              <li key={x.path} className={`flex flex-wrap items-center gap-2 px-2 py-1 text-xs ${used ? "text-zinc-400" : ""}`}>
                <input type="checkbox" checked={on} disabled={used} onChange={(e) => setExtras((o) => { const n = { ...o }; if (e.target.checked) n[i] = "ideas"; else delete n[i]; return n; })} />
                <span className="min-w-0 flex-1 truncate" title={x.title}>Slide {i + 1}: {x.title}{used ? " (used above)" : ""}</span>
                {on && <select value={extras[i]} onChange={(e) => setExtras((o) => ({ ...o, [i]: e.target.value }))} className={sel}>{ANCHORS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
              </li>); })}
            </ul>
          </div>
          <div className="flex items-center gap-3 pt-1"><button onClick={save} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Save template</button><button onClick={() => { setFile(null); setState(""); }} className="text-zinc-500 hover:underline">Cancel</button></div>
        </div>
      )}
      {state && <p className="text-xs text-zinc-600">{state}</p>}
    </div>
  );
}
