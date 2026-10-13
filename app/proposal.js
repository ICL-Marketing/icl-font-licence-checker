"use client";
// Proposal deck for one client, step by step: assess the ideas, add your own, Claude writes the copy,
// then review it, add screenshots and download the ICL-branded .pptx.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, CopyIcon, CheckIcon, ExternalIcon, SpinnerIcon, TrashIcon } from "@/app/icons";
import { useClaudeHandler, withTitle } from "@/app/claudeInbox";
import { TEAMS, lineFromIdea, ownLine, range, totals, daysFor, proposalPrompt, parseProposalReply } from "@/lib/proposal";
import { ideaType } from "@/lib/clientIdeas";

function Grow({ value, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={`resize-none overflow-hidden ${className}`} {...rest} />;
}
const STEPS = ["Assess ideas", "Add your own", "Claude writes it", "Review & download"];
const input = "w-full rounded-md border border-zinc-300 px-2 py-1 text-sm";
const num = "w-14 rounded-md border border-zinc-300 px-1.5 py-0.5 text-right text-sm";

async function loadAll() {
  const j = await fetch("/api/settings?key=proposals").then((r) => r.json()).catch(() => ({}));
  return j.shared ? j.value?.byClient || {} : null;
}
async function saveOne(id, doc) {
  const all = (await loadAll()) || {};
  all[id] = doc;
  // Keep the newest 60 so the shared store stays small.
  const byClient = Object.fromEntries(Object.entries(all).sort((a, b) => String(b[1].updatedAt || "").localeCompare(String(a[1].updatedAt || ""))).slice(0, 60));
  await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "proposals", value: { byClient } }) }).catch(() => {});
}
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
  return <span className="inline-flex gap-1">{TEAMS.map(([k, name]) => { const on = team.includes(k); return <button key={k} type="button" onClick={() => { const next = on ? team.filter((x) => x !== k) : [...team, k]; if (next.length) onChange(next); }} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-100"}`}>{name}</button>; })}</span>;
}
function Hours({ line, onChange }) {
  return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><input type="number" min={0.5} step={0.5} value={line.min} onChange={(e) => onChange({ min: Number(e.target.value) || 0.5 })} className={num} aria-label="Hours from" />–<input type="number" min={0.5} step={0.5} value={line.max} onChange={(e) => onChange({ max: Number(e.target.value) || 0.5 })} className={num} aria-label="Hours to" /> hrs</span>;
}
function Summary({ lines }) {
  const t = totals(lines), d = daysFor(lines);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white">
      <span><b>{lines.length}</b> improvement{lines.length === 1 ? "" : "s"}</span>
      <span><b>{lines.length ? range(t.min, t.max) : 0}</b> hrs hands-on</span>
      {TEAMS.map(([k, name]) => t[k][1] > 0 && <span key={k} className="text-zinc-300">{name} {range(t[k][0], t[k][1])}</span>)}
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
function BlockList({ label, items, onChange }) {
  if (!items?.length) return null;
  return (
    <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="grid gap-2 sm:grid-cols-2">{items.map((b, i) => (
        <div key={i} className="space-y-1 rounded-md border border-zinc-200 p-2">
          <input value={b.title} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={`${input} font-semibold`} />
          <Grow value={b.text} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className={input} />
        </div>))}
      </div>
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
  const [draft, setDraft] = useState({ title: "", why: "", min: 2, max: 3, team: ["dev"] });
  const saveT = useRef(null);

  useEffect(() => {
    let live = true;
    loadAll().then((all) => {
      if (!live) return;
      const saved = all?.[id];
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
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => saveOne(id, next), 800);
    return next;
  });
  const lines = doc ? [...pool.filter((i) => doc.picked[i.key]).map((i) => doc.picked[i.key]), ...Object.values(doc.picked).filter((l) => !pool.some((i) => i.key === l.key) && !l.custom), ...doc.own] : [];
  const setLine = (key, fields) => change((d) => (d.own.some((l) => l.key === key) ? { ...d, own: d.own.map((l) => (l.key === key ? { ...l, ...fields, max: Math.max(fields.max ?? l.max, fields.min ?? l.min) } : l)) } : { ...d, picked: { ...d.picked, [key]: { ...d.picked[key], ...fields, max: Math.max(fields.max ?? d.picked[key].max, fields.min ?? d.picked[key].min) } } }));
  const prompt = doc && lines.length ? withTitle("Proposal deck", group.name, proposalPrompt({ client: group.name, website, lines, notes: doc.notes })) : "";

  function applyReply(text) {
    const copy = parseProposalReply(text);
    if (!copy.ideas.length) throw new Error("No ideas in that reply. Paste Claude's whole JSON block.");
    change((d) => ({ ...d, copy, step: 3 }));
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
    try { const { buildDeck } = await import("@/app/proposalDeck"); await buildDeck({ client: group.name, website, lines, copy: doc.copy, images }); }
    catch (e) { setErr(`Couldn't build the deck: ${e.message}`); }
    setBusy(false);
  }
  const setCopy = (fields) => change((d) => ({ ...d, copy: { ...d.copy, ...fields } }));
  const setIdeaCopy = (key, fields) => setCopy({ ideas: doc.copy.ideas.map((x) => (x.key === key ? { ...x, ...fields } : x)) });
  const step = doc?.step || 0;
  const canGo = (n) => n === 0 || (n <= 2 ? lines.length > 0 : !!doc?.copy);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3"><h3 className="text-lg font-semibold">Proposal deck: {group.name}</h3>{website && <a href={`https://${website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">{website} <ExternalIcon /></a>}<button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button></div>
        {!doc ? <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><SpinnerIcon className="h-4 w-4 animate-spin" /> Loading…</div> : (
          <div className="space-y-4 px-5 py-4">
            <ol className="flex flex-wrap gap-1.5">{STEPS.map((s, n) => (
              <li key={s}><button onClick={() => canGo(n) && change((d) => ({ ...d, step: n }))} disabled={!canGo(n)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${step === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{n < step ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <span className="opacity-60">{n + 1}</span>}{s}</button></li>))}
            </ol>
            <Summary lines={lines} />

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
                      <span className="min-w-0 flex-1" title={i.why}>{i.title}</span>
                      {l && <><Hours line={l} onChange={(f) => setLine(i.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(i.key, { team })} /></>}
                    </li>); })}
                </ul>
                <div className="flex justify-end"><button onClick={() => change((d) => ({ ...d, step: 1 }))} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Next: add your own</button></div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {doc.own.length > 0 && <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{doc.own.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">Yours</span><span className="min-w-0 flex-1" title={l.why}>{l.title}</span><Hours line={l} onChange={(f) => setLine(l.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(l.key, { team })} /><button onClick={() => change((d) => ({ ...d, own: d.own.filter((x) => x.key !== l.key) }))} aria-label="Remove" className="rounded p-1 text-zinc-400 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button></li>))}
                </ul>}
                <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Add an improvement</div>
                  <input value={draft.title} onChange={(e) => setDraft((o) => ({ ...o, title: e.target.value }))} placeholder="e.g. Mobile and final QA" className={input} />
                  <input value={draft.why} onChange={(e) => setDraft((o) => ({ ...o, why: e.target.value }))} placeholder="What it involves, in a line (Claude turns it into the slide)" className={input} />
                  <div className="flex flex-wrap items-center gap-3"><Hours line={draft} onChange={(f) => setDraft((o) => ({ ...o, ...f }))} /><TeamPicker team={draft.team} onChange={(team) => setDraft((o) => ({ ...o, team }))} />
                    <button onClick={() => { if (!draft.title.trim()) return; change((d) => ({ ...d, own: [...d.own, ownLine(draft)] })); setDraft({ title: "", why: "", min: 2, max: 3, team: ["dev"] }); }} disabled={!draft.title.trim()} className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40">+ Add</button></div>
                </div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes for Claude (optional)<textarea value={doc.notes} onChange={(e) => change((d) => ({ ...d, notes: e.target.value }))} rows={2} placeholder="e.g. They're launching a new service in spring; keep it to a refresh, not a rebuild" className={`${input} mt-0.5 font-normal normal-case tracking-normal`} /></label>
                <div className="flex justify-between"><button onClick={() => change((d) => ({ ...d, step: 0 }))} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Back</button><button onClick={() => change((d) => ({ ...d, step: 2 }))} disabled={!lines.length} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Next: Claude writes it</button></div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-600">Claude checks {website || "their website"} and writes the deck copy: background, biggest wins, a slide per idea, the {daysFor(lines)}-day plan and the retainer pitch. It also flags any hour estimate that looks wrong. Use a new chat with web search on.</p>
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
                <BlockList label="Background" items={doc.copy.background} onChange={(background) => setCopy({ background })} />
                <BlockList label="Where the biggest wins are" items={doc.copy.wins} onChange={(wins) => setCopy({ wins })} />
                <div className="space-y-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Idea slides</div>
                  {lines.map((l, n) => { const c = doc.copy.ideas.find((x) => x.key === l.key); return (
                    <div key={l.key} className="flex flex-wrap gap-3 rounded-lg border border-zinc-200 p-3">
                      <div className="min-w-[16rem] flex-1 space-y-1">
                        {!c ? <p className="text-sm text-amber-700">{n + 1}. {l.title}: Claude didn&apos;t write this one, so the slide uses your title and notes.</p> : <>
                          <input value={c.title} onChange={(e) => setIdeaCopy(l.key, { title: e.target.value })} className={`${input} font-semibold`} aria-label="Slide title" />
                          <Grow value={c.intro} onChange={(e) => setIdeaCopy(l.key, { intro: e.target.value })} className={input} aria-label="Intro" />
                          <Grow value={c.bullets.join("\n")} onChange={(e) => setIdeaCopy(l.key, { bullets: e.target.value.split("\n") })} className={input} aria-label="Bullet points, one per line" />
                          <input value={c.closing} onChange={(e) => setIdeaCopy(l.key, { closing: e.target.value })} placeholder="Closing benefit (optional)" className={input} />
                        </>}
                        <div className="flex flex-wrap items-center gap-2 pt-1"><Hours line={l} onChange={(f) => setLine(l.key, f)} /><TeamPicker team={l.team} onChange={(team) => setLine(l.key, { team })} />
                          {c?.min && (c.min !== l.min || c.max !== l.max) && <button onClick={() => setLine(l.key, { min: c.min, max: Math.max(c.max || c.min, c.min) })} title={c.hoursNote} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">Claude suggests {range(c.min, c.max || c.min)} hrs{c.hoursNote ? `: ${c.hoursNote}` : ""} · use</button>}</div>
                      </div>
                      <ImageDrop value={images[l.key]} onChange={(v) => setImages((o) => ({ ...o, [l.key]: v }))} label="Screenshot or mock-up" />
                    </div>); })}
                </div>
                <BlockList label={`${daysFor(lines)}-day plan`} items={doc.copy.plan} onChange={(plan) => setCopy({ plan })} />
                <BlockList label="Retainer pitch" items={doc.copy.retainer} onChange={(retainer) => setCopy({ retainer })} />
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
