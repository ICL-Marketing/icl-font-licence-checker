"use client";
// One place to paste every Claude reply. Each prompt's reply has its own shape, so the inbox works out
// which job it belongs to (lead check, website search, new leads, an email draft, client research)
// and hands it to the part of the app that registered for it.
import { Component, useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/app/icons";

const handlers = new Map(); // kind -> (text) => summary string (or a promise of one)
export function useClaudeHandler(kind, fn) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    const h = (t) => ref.current(t);
    handlers.set(kind, h);
    return () => { if (handlers.get(kind) === h) handlers.delete(kind); };
  }, [kind]);
}

// Prompt jobs: each part of the app registers the jobs it can write a prompt for, so they all live in one window.
const promptJobs = new Map(); // id -> { label, order, count(), render(opts, close) }
export function useClaudeJob(id, job) {
  const ref = useRef(job);
  useEffect(() => { ref.current = job; window.dispatchEvent(new Event("claude-jobs")); });
  useEffect(() => {
    const j = { get label() { return ref.current.label; }, get order() { return ref.current.order ?? 9; }, count: () => ref.current.count?.(), render: (o, c) => ref.current.render(o, c) };
    promptJobs.set(id, j);
    window.dispatchEvent(new Event("claude-jobs"));
    return () => { if (promptJobs.get(id) === j) promptJobs.delete(id); };
  }, [id]);
}
// Open the Claude window: { tab: "prompt" | "paste", job, preset: [ids], column }.
export const openClaude = (detail = {}) => window.dispatchEvent(new CustomEvent("open-claude-inbox", { detail }));

export const KIND_LABEL = { "all": "All jobs", "vet": "Vet leads", "rank-check": "Search rankings", "lead-check": "Lead check", "find-sites": "Website search", "find-leads": "New leads", draft: "Email draft", "draft-batch": "Email drafts (batch)", "client-research": "Client research", proposal: "Proposal deck" };

function jsonOf(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  body = body.slice(start, Math.max(body.lastIndexOf("]"), body.lastIndexOf("}")) + 1);
  try { return JSON.parse(body); } catch { return null; }
}
export function detectReply(text) {
  const d = jsonOf(text);
  if (!d || typeof d !== "object") return /^subject:/im.test(String(text)) ? "draft" : null;
  if (!Array.isArray(d) && d.proposal && typeof d.proposal === "object") return "proposal";
  if (!Array.isArray(d) && (Array.isArray(d.vet) || Array.isArray(d.check) || Array.isArray(d.rankings))) return "all";
  if (!Array.isArray(d) && Array.isArray(d.emails)) return "draft-batch";
  if (Array.isArray(d) && d[0] && "lead_id" in d[0] && "email_body" in d[0]) return "draft-batch";
  if (!Array.isArray(d) && "body" in d && ("subject" in d || "lead_id" in d)) return "draft";
  const list = Array.isArray(d) ? d : Array.isArray(d.leads) ? d.leads : Array.isArray(d.clients) ? d.clients : [d];
  const x = list.find((o) => o && typeof o === "object") || {};
  if ("client_id" in x) return "client-research";
  if ("lead_id" in x && Array.isArray(x.searches) && ("has_website" in x || "contact" in x)) return "vet";
  if ("lead_id" in x && Array.isArray(x.searches)) return "rank-check";
  if ("lead_id" in x && ("has_website" in x || "other_presence" in x)) return "find-sites";
  if ("lead_id" in x) return "lead-check";
  if ("name" in x) return "find-leads";
  return null;
}

// Leads/clients whose prompt has been copied but not answered yet, so "next batch" moves on past them.
const SENT_KEY = "flc-claude-sent";
const loadSent = () => { try { return JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {}; } catch { return {}; } };
export function markSent(kind, ids) {
  const s = loadSent(); const now = Date.now();
  s[kind] = Object.fromEntries(Object.entries(s[kind] || {}).filter(([, t]) => now - t < 2 * 86400000));
  for (const id of ids) s[kind][id] = now;
  try { localStorage.setItem(SENT_KEY, JSON.stringify(s)); } catch {}
}
// Forget that a lead was already sent, so "Check again" puts it back in the next prompt.
export function unmarkSent(ids) { const s = loadSent(); for (const k of Object.keys(s)) for (const id of ids) delete s[k][id]; try { localStorage.setItem(SENT_KEY, JSON.stringify(s)); } catch {} }
export function sentIds(kind) { const s = loadSent()[kind] || {}; const now = Date.now(); return new Set(Object.entries(s).filter(([, t]) => now - t < 2 * 86400000).map(([id]) => id)); }
export const openInbox = () => openClaude({ tab: "paste" });
// A title line at the top of every prompt, so Claude names the chat after the job ("ICL · Find websites · 33 leads · 12 Oct 14:05").
export function withTitle(job, detail, prompt) {
  if (!prompt) return "";
  const at = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `ICL · ${job}${detail ? ` · ${detail}` : ""} · ${at}\n\n${prompt}`;
}
// A problem inside one prompt panel shows its message here instead of taking the whole app down.
class PanelGuard extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const detail = `${e.message}\n${String(e.stack || "").split("\n").slice(0, 6).join("\n")}`;
    return (
      <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        <p className="font-semibold">This panel hit a problem: {e.message}</p>
        <p>Copy the details and send them over, then try again.</p>
        <div className="flex gap-2">
          <button onClick={() => navigator.clipboard?.writeText(detail).catch(() => {})} className="rounded-md border border-red-300 bg-white px-2 py-1 hover:bg-red-100">Copy details</button>
          <button onClick={() => this.setState({ error: null })} className="rounded-md border border-red-300 bg-white px-2 py-1 hover:bg-red-100">Try again</button>
        </div>
      </div>
    );
  }
}
// Background work after a paste reports here; the Claude window shows a bar per job.
export const reportProgress = (id, label, done, total) => window.dispatchEvent(new CustomEvent("claude-progress", { detail: { id, label, done, total } }));

// Small reminder for each "copy the prompt" panel.
export function PasteHint({ className = "" }) {
  return <p className={`text-xs text-zinc-600 ${className}`}>When Claude answers, paste its reply in <button onClick={openInbox} className="font-semibold text-orange-700 underline">Paste a reply</button>. Any reply, any order: it knows where each one goes. Copying moves on to the next batch, so you can run several chats at once.</p>;
}

export function ClaudeInbox() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("prompt");
  const [job, setJob] = useState({ id: "", opts: {}, n: 0 });
  const [, setTick] = useState(0);
  useEffect(() => { const t = () => setTick((n) => n + 1); window.addEventListener("claude-jobs", t); return () => window.removeEventListener("claude-jobs", t); }, []);
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState({});
  useEffect(() => {
    const on = (e) => {
      const { id, label, done, total } = e.detail || {};
      setJobs((j) => ({ ...j, [id]: { label, done, total } }));
      if (total && done >= total && /finished/.test(label)) setTimeout(() => setJobs((j) => { const n = { ...j }; delete n[id]; return n; }), 4000);
    };
    window.addEventListener("claude-progress", on);
    return () => window.removeEventListener("claude-progress", on);
  }, []);
  const active = Object.entries(jobs);
  useEffect(() => {
    const o = (e) => {
      const d = e.detail || {};
      setOpen(true);
      setTab(d.tab || (d.job ? "prompt" : "prompt"));
      if (d.job) setJob((j) => ({ id: d.job, opts: { preset: d.preset || [], column: d.column }, n: j.n + 1 }));
    };
    window.addEventListener("open-claude-inbox", o);
    return () => window.removeEventListener("open-claude-inbox", o);
  }, []);
  const list = [...promptJobs.entries()].sort((a, b) => a[1].order - b[1].order);
  const currentId = promptJobs.has(job.id) ? job.id : list[0]?.[0] || "";
  const current = promptJobs.get(currentId);
  const close = () => setOpen(false);
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);
  async function take(t) {
    const kind = detectReply(t);
    const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (!kind) { setLog((l) => [{ at, kind: "", ok: false, msg: "Couldn't tell what this reply is for. Paste the whole reply, including the JSON block." }, ...l]); return; }
    const h = handlers.get(kind);
    if (!h) { setLog((l) => [{ at, kind, ok: false, msg: kind === "client-research" ? "Open the Client Ideas tab once, then paste again." : "Open the Website Leads tab once, then paste again." }, ...l]); return; }
    setBusy(true);
    try { const msg = await h(t); setLog((l) => [{ at, kind, ok: true, msg }, ...l]); setText(""); }
    catch (e) { setLog((l) => [{ at, kind, ok: false, msg: e.message }, ...l]); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button onClick={() => setOpen(true)} title="Get a prompt for Claude, or paste a reply" className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-1 text-sm font-medium text-white hover:bg-orange-700">Claude{active.some(([, j]) => j.done < j.total) && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3">
              <h3 className="text-lg font-semibold">Claude</h3><span className="text-xs text-zinc-500">Free on your Claude plan</span>
              <div className="ml-4 inline-flex rounded-md border border-zinc-300 p-0.5 text-sm">
                {[["prompt", "1. Get a prompt"], ["paste", "2. Paste a reply"]].map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 ${tab === k ? "bg-orange-600 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>{label}</button>)}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
            </div>
            {tab === "prompt" && (
              <div className="space-y-4 px-5 py-4 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  {list.map(([id, j]) => { const n = j.count(); return <button key={id} onClick={() => setJob((x) => ({ id, opts: {}, n: x.n + 1 }))} className={`rounded-full border px-3 py-1 text-xs font-medium ${currentId === id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>{j.label}{n ? ` (${n})` : ""}</button>; })}
                </div>
                {current ? <PanelGuard key={`${currentId}:${job.n}`}>{current.render(currentId === job.id ? job.opts : {}, close)}</PanelGuard> : <p className="text-xs text-zinc-500">Open Website Leads or Client Ideas once to load their prompts.</p>}
              </div>
            )}
            {tab === "paste" && <div className="space-y-3 px-5 py-4 text-sm">
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData("text"); if (detectReply(t)) { e.preventDefault(); take(t); } }} rows={6}
                placeholder="Paste Claude's reply here. It's added as soon as you paste; paste the next one straight after."
                className="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs" />
              <div className="flex items-center gap-2">
                <button onClick={() => take(text)} disabled={!text.trim() || busy} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{busy ? "Adding…" : "Add"}</button>
                <span className="text-[11px] text-zinc-500">Works for: {Object.values(KIND_LABEL).join(", ")}.</span>
              </div>
              {active.length > 0 && (
                <div className="space-y-2 rounded-md bg-zinc-50 p-2">
                  {active.map(([id, j]) => (
                    <div key={id} className="text-xs">
                      <div className="flex justify-between text-zinc-700"><span>{j.label}</span>{j.total > 1 && <span className="text-zinc-500">{j.done} of {j.total}</span>}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200"><div className={`h-full ${j.done >= j.total ? "bg-emerald-500" : "bg-blue-500"} transition-all`} style={{ width: `${j.total ? Math.max(4, Math.round((j.done / j.total) * 100)) : 4}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
              {log.length > 0 && (
                <ul className="space-y-1 border-t border-zinc-100 pt-2">
                  {log.map((x, n) => (
                    <li key={n} className={`flex gap-2 text-xs ${x.ok ? "text-zinc-800" : "text-red-700"}`}>
                      <span className="w-10 shrink-0 text-zinc-400">{x.at}</span>
                      {x.kind && <span className="h-fit shrink-0 self-start whitespace-nowrap rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">{KIND_LABEL[x.kind]}</span>}
                      <span>{x.ok ? "✓ " : ""}{x.msg}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>}
          </div>
        </div>
      )}
    </>
  );
}
