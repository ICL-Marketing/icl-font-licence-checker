"use client";
// Proposal deck for one client, step by step: assess the ideas, add your own, Claude writes the copy,
// then review it, add screenshots and download the ICL-branded .pptx.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, CopyIcon, CheckIcon, ExternalIcon, SpinnerIcon, TrashIcon } from "@/app/icons";
import { useClaudeHandler, withTitle } from "@/app/claudeInbox";
import { TEAMS, lineFromIdea, ownLine, range, totals, daysFor, proposalPrompt, parseProposalReply, RETAINER_DEFAULTS, normalisePoints } from "@/lib/proposal";
import Link from "next/link";
import { PACKAGE_GROUPS, pickedPackages, effectivePackages, isPackageLine, packagesOf, SINGLE_TIER } from "@/lib/packages";
import { ideaType } from "@/lib/clientIdeas";
import { VISUALS, isListField } from "@/lib/visuals";

function Grow({ value, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={`resize-none overflow-hidden ${className}`} {...rest} />;
}
const STEPS = ["Assess ideas", "Add your own", "Claude writes it", "Review & download"];
const input = "w-full rounded-md border border-zinc-300 px-2 py-1 text-sm";
const num = "w-14 rounded-md border border-zinc-300 px-1.5 py-0.5 text-right text-sm";

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
function shrink(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onerror = bad;
    r.onload = () => { const img = new Image(); img.onerror = bad; img.onload = () => { const k = Math.min(1, 1800 / img.naturalWidth); const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", 0.86)); }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}

function TeamPicker({ team, onChange }) {
  return <span className="inline-flex flex-wrap gap-1">{TEAMS.map(([k, name]) => { const on = team.includes(k); return <button key={k} type="button" onClick={() => { const next = on ? team.filter((x) => x !== k) : [...team, k]; if (next.length) onChange(next); }} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-100"}`}>{name}</button>; })}</span>;
}
function Hours({ line, onChange, picked = [] }) {
  // SEO, PPC and Videography are sold as packages: no hours to set.
  if (isPackageLine(line)) { const g = packagesOf(line, picked)[0]; const t = g?.tiers.find((x) => g.picked.includes(x.id)); return <span className="whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800" title="Priced by the package, not by the hour. Change the tier in step 2">{g ? `${g.name} package · ${t?.price} ${t?.period}` : "Package"}</span>; }
  return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><input type="number" min={0.5} step={0.5} value={line.max} onChange={(e) => { const h = Number(e.target.value) || 0.5; onChange({ min: h, max: h }); }} className={num} aria-label="Hours" /> hrs</span>;
}
function Summary({ lines: all, picked = [] }) {
  const lines = all.filter((l) => !isPackageLine(l));
  const t = totals(lines), d = daysFor(lines);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white">
      <span><b>{lines.length}</b> improvement{lines.length === 1 ? "" : "s"}</span>
      <span><b>{lines.length ? range(t.min, t.max) : 0}</b> hrs hands-on</span>
      {TEAMS.map(([k, name]) => t[k][1] > 0 && <span key={k} className="text-zinc-300">{name} {range(t[k][0], t[k][1])}</span>)}
      {picked.map((g) => <span key={g.id} className="rounded-full bg-white/15 px-2 py-0.5 text-xs">+ {g.name}: {g.tiers.filter((x) => g.picked.includes(x.id)).map((x) => `${x.price} ${x.period}`).join(" / ")}</span>)}
      <span className="ml-auto rounded-full bg-emerald-400 px-2.5 py-0.5 font-bold text-zinc-900" title="Top of the range plus a quarter for feedback, testing and launch, in 7.5 hour days">{lines.length ? d : 0} day{d === 1 ? "" : "s"}</span>
    </div>
  );
}
function ImageDrop({ value, onChange, label }) {
  const ref = useRef(null);
  const take = async (f) => { if (f && f.type.startsWith("image/")) onChange(await shrink(f)); };
  return (
    <div tabIndex={0} onPaste={(e) => take([...e.clipboardData.files][0])} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }} className="relative flex h-32 w-48 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-center text-[11px] text-zinc-500 outline-none hover:border-zinc-400 focus:border-blue-500" onClick={() => ref.current?.click()} title="Click to choose, drop a file, or click then Ctrl+V to paste a screenshot">
      {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <span className="px-2">{label}<br />click, drop or paste</span>}
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
// The mock-up drawn on the idea slide when there's no screenshot: pick the kind, edit the words.
function VisualEditor({ value, onChange }) {
  const kind = value?.kind || "";
  const spec = VISUALS[kind];
  return (
    <div className="w-48 shrink-0 space-y-1 text-xs">
      <select value={kind} onChange={(e) => onChange(e.target.value ? { kind: e.target.value, caption: "" } : null)} className="w-full rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs" title="Drawn on the slide when there's no screenshot">
        <option value="">No mock-up</option>{Object.entries(VISUALS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {spec && <>
        <input value={value.caption || ""} onChange={(e) => onChange({ ...value, caption: e.target.value })} placeholder={spec.caption || "Caption"} className="w-full rounded border border-zinc-200 px-1.5 py-0.5" />
        {Object.entries(spec.fields).map(([k, label]) => isListField(k)
          ? <textarea key={k} value={(value[k] || []).join("\n")} onChange={(e) => onChange({ ...value, [k]: e.target.value.split("\n") })} rows={2} placeholder={label} title={label} className="w-full rounded border border-zinc-200 px-1.5 py-0.5" />
          : <input key={k} value={value[k] || ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} placeholder={label} title={label} className="w-full rounded border border-zinc-200 px-1.5 py-0.5" />)}
      </>}
    </div>
  );
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

export function ProposalModal({ group, onClose }) {
  const id = group.clientId || group.name;
  const website = (group.recs.find((x) => x.website) || {}).website || "";
  // Ideas worth pitching: not declined or done, not our own internal jobs.
  const pool = group.queue.filter((i) => !["declined", "done"].includes(i.status) && !i.internal);
  const [doc, setDoc] = useState(null); // { step, picked: {key: line}, own: [line], notes, copy }
  const [images, setImages] = useState({});
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", why: "", min: 2, max: 2, team: ["dev"] });
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
  useEffect(() => { fetch("/api/settings?key=retainer-points").then((r) => r.json()).then((j) => { if (j.shared && j.value?.items) setPoints(normalisePoints(j.value)); }).catch(() => {}); }, []);

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
  const lines = (doc ? [...pool.filter((i) => doc.picked[i.key]).map((i) => doc.picked[i.key]), ...Object.values(doc.picked).filter((l) => !pool.some((i) => i.key === l.key) && !l.custom), ...doc.own] : []).map((l) => (l.min === l.max ? l : { ...l, min: l.max })); // one set figure (older drafts had a range)
  const setLine = (key, fields) => change((d) => (d.own.some((l) => l.key === key) ? { ...d, own: d.own.map((l) => (l.key === key ? { ...l, ...fields, max: Math.max(fields.max ?? l.max, fields.min ?? l.min) } : l)) } : { ...d, picked: { ...d.picked, [key]: { ...d.picked[key], ...fields, max: Math.max(fields.max ?? d.picked[key].max, fields.min ?? d.picked[key].min) } } }));
  const chosenIds = doc?.points || points.filter((x) => x.always).map((x) => x.id);
  const chosen = points.filter((x) => chosenIds.includes(x.id));
  const pkgIds = effectivePackages(doc?.packages || [], lines);
  const picked = pickedPackages(pkgIds);
  const prompt = doc && lines.length ? withTitle("Proposal deck", group.name, proposalPrompt({ client: group.name, website, lines, notes: doc.notes, points: chosen, packages: picked })) : "";

  function applyReply(text) {
    const copy = parseProposalReply(text);
    if (!copy.ideas.length) throw new Error("No ideas in that reply. Paste Claude's whole JSON block.");
    change((d) => ({ ...d, copy: { ...copy, hide: d.copy?.hide || {} }, step: 3 }));
    setReply(""); setErr("");
    return `Proposal copy for ${group.name}: ${copy.ideas.length} idea slides`;
  }
  useClaudeHandler("proposal", applyReply);
  async function copyPrompt(open) {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    if (open) window.open("https://claude.ai/new", "_blank", "noopener");
  }
  async function download() {
    setBusy(true); setErr("");
    try { const { buildDeck } = await import("@/app/proposalDeck"); await buildDeck({ client: group.name, website, lines, copy: doc.copy, images, packages: pkgIds }); }
    catch (e) { setErr(`Couldn't build the deck: ${e.message}`); }
    setBusy(false);
  }
  const setCopy = (fields) => change((d) => ({ ...d, copy: { ...d.copy, ...fields } }));
  const hidden = doc?.copy?.hide || {};
  const toggle = (k) => ({ hidden: !!hidden[k], onToggle: () => setCopy({ hide: { ...hidden, [k]: !hidden[k] } }) });
  const setIdeaCopy = (key, fields) => setCopy({ ideas: doc.copy.ideas.map((x) => (x.key === key ? { ...x, ...fields } : x)) });
  const step = doc?.step || 0;
  const canGo = (n) => n === 0 || (n <= 2 ? lines.length > 0 : !!doc?.copy);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3"><h3 className="text-lg font-semibold">Proposal deck: {group.name}</h3>{website && <a href={`https://${website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">{website} <ExternalIcon /></a>}<span className="ml-auto text-xs text-zinc-400">{saved}</span><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button></div>
        {!doc ? <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><SpinnerIcon className="h-4 w-4 animate-spin" /> Loading…</div> : (
          <div className="space-y-4 px-5 py-4">
            <ol className="flex flex-wrap gap-1.5">{STEPS.map((s, n) => (
              <li key={s}><button onClick={() => canGo(n) && change((d) => ({ ...d, step: n }))} disabled={!canGo(n)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${step === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{n < step ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <span className="opacity-60">{n + 1}</span>}{s}</button></li>))}
            </ol>
            <Summary lines={lines} picked={picked} />

            {step === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-600">Tick the ideas to pitch. Starred ideas and the top ones that fit in about 3 days are ticked for you. Adjust the hours (for a person doing it by hand, not AI) and who does it. Aim for about <b>3 days</b>: it&apos;s an easy yes, and the retainer slide pitches the rest.</p>
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {pool.length === 0 && <li className="p-3 text-sm text-zinc-500">No ideas for this client yet. Add your own in step 2.</li>}
                  {pool.map((i) => { const l = doc.picked[i.key]; return (
                    <li key={i.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${l ? "bg-emerald-50/50" : ""}`}>
                      <input type="checkbox" checked={!!l} onChange={() => change((d) => { const p = { ...d.picked }; if (p[i.key]) delete p[i.key]; else p[i.key] = lineFromIdea(i); return { ...d, picked: p }; })} className="h-4 w-4" />
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${i.ai ? "bg-violet-100 text-violet-800" : "bg-zinc-100 text-zinc-700"}`}>{i.ai ? "AI" : "ICL"}</span>
                      {i.starred && <span className="text-amber-500">★</span>}
                      <span className="min-w-[16rem] flex-1 leading-snug" title={i.why}>{i.title}</span>
                      {l && <><Hours picked={picked} line={l} onChange={(f) => setLine(i.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(i.key, { team })} /></>}
                    </li>); })}
                </ul>
                <div className="flex justify-end"><button onClick={() => change((d) => ({ ...d, step: 1 }))} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Next: add your own</button></div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {doc.own.length > 0 && <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{doc.own.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">Yours</span><span className="min-w-[16rem] flex-1 leading-snug" title={l.why}>{l.title}</span><Hours picked={picked} line={l} onChange={(f) => setLine(l.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(l.key, { team })} /><button onClick={() => change((d) => ({ ...d, own: d.own.filter((x) => x.key !== l.key) }))} aria-label="Remove" className="rounded p-1 text-zinc-400 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button></li>))}
                </ul>}
                <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Add an improvement</div>
                  <input value={draft.title} onChange={(e) => setDraft((o) => ({ ...o, title: e.target.value }))} placeholder="e.g. Mobile and final QA" className={input} />
                  <input value={draft.why} onChange={(e) => setDraft((o) => ({ ...o, why: e.target.value }))} placeholder="What it involves, in a line (Claude turns it into the slide)" className={input} />
                  <div className="flex flex-wrap items-center gap-3"><Hours picked={picked} line={draft} onChange={(f) => setDraft((o) => ({ ...o, ...f }))} /><TeamPicker team={draft.team} onChange={(team) => setDraft((o) => ({ ...o, team }))} />
                    <button onClick={() => { if (!draft.title.trim()) return; change((d) => ({ ...d, own: [...d.own, ownLine(draft)] })); setDraft({ title: "", why: "", min: 2, max: 2, team: ["dev"] }); }} disabled={!draft.title.trim()} className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40">+ Add</button></div>
                </div>
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
                  <ImageDrop value={images.cover} onChange={(v) => setImages((o) => ({ ...o, cover: v }))} label="Cover image (e.g. their homepage today)" />
                  <label className="min-w-[14rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Deck title<input value={doc.copy.deckTitle} onChange={(e) => setCopy({ deckTitle: e.target.value.toUpperCase() })} className={`${input} mt-0.5`} /><span className="mt-1 block font-normal normal-case tracking-normal text-zinc-500">Images stay in this browser only (not saved), so add them just before you download.</span></label>
                </div>
                <BlockList label="Background" items={doc.copy.background} onChange={(background) => setCopy({ background })} {...toggle("background")} />
                <BlockList label="Where the biggest wins are" items={doc.copy.wins} onChange={(wins) => setCopy({ wins })} {...toggle("wins")} />
                <div className="space-y-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Idea slides</div>
                  {lines.map((l, n) => { const c = doc.copy.ideas.find((x) => x.key === l.key); return (
                    <div key={l.key} className="flex flex-wrap gap-3 rounded-lg border border-zinc-200 p-3">
                      <div className="min-w-[16rem] flex-1 space-y-1">
                        {!c ? <p className="text-sm text-amber-700">{n + 1}. {l.title}: Claude didn&apos;t write this one, so the slide uses your title and notes.</p> : <>
                          <input value={c.title} onChange={(e) => setIdeaCopy(l.key, { title: e.target.value })} className={`${input} font-semibold`} aria-label="Slide title" />
                          <Grow value={c.intro} onChange={(e) => setIdeaCopy(l.key, { intro: e.target.value })} className={input} aria-label="Intro" />
                          <Bullets items={c.bullets} onChange={(bullets) => setIdeaCopy(l.key, { bullets })} />
                          <input value={c.closing} onChange={(e) => setIdeaCopy(l.key, { closing: e.target.value })} placeholder="Closing benefit (optional)" className={input} />
                        </>}
                        <div className="flex flex-wrap items-center gap-2 pt-1"><Hours picked={picked} line={l} onChange={(f) => setLine(l.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(l.key, { team })} />
                          {c?.max && c.max !== l.max && <button onClick={() => setLine(l.key, { min: c.max, max: c.max })} title={c.hoursNote} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">Claude suggests {c.max} hrs{c.hoursNote ? `: ${c.hoursNote}` : ""} · use</button>}</div>
                      </div>
                      <ImageDrop value={images[l.key]} onChange={(v) => setImages((o) => ({ ...o, [l.key]: v }))} label="Screenshot or mock-up" />
                      {c && !images[l.key] && <VisualEditor value={c.visual} onChange={(visual) => setIdeaCopy(l.key, { visual })} />}
                    </div>); })}
                </div>
                <BlockList label="Retainer pitch" items={doc.copy.retainer} onChange={(retainer) => setCopy({ retainer })} {...toggle("retainer")} />
                <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Standard slides</div>
                  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{[["effort", "Estimated effort table"], ["costs", "Monthly / one-off costs table"], ["services", "Our service retainer offering"], ["packages", picked.length ? `Package slides (${picked.map((g) => g.name).join(", ")})` : "Support packages (Bronze, Silver, Gold)"]].map(([k, name]) => (
                    <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-sm"><span className={hidden[k] ? "text-zinc-400 line-through" : ""}>{name}</span><span className="ml-auto"><SlideToggle {...toggle(k)} /></span></li>))}
                  </ul>
                </div>
                {err && <p className="text-sm text-red-700">{err}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3">
                  <button onClick={() => change((d) => ({ ...d, step: 2 }))} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Back: ask Claude again</button>
                  <button onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy && <SpinnerIcon className="h-4 w-4 animate-spin" />} Download deck (.pptx)</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
