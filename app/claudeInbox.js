"use client";
// One place to paste every Claude reply. Each prompt's reply has its own shape, so the inbox works out
// which job it belongs to (lead check, website search, new leads, an email draft, client research)
// and hands it to the part of the app that registered for it.
import { useEffect, useRef, useState } from "react";
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

export const KIND_LABEL = { "lead-check": "Lead check", "find-sites": "Website search", "find-leads": "New leads", draft: "Email draft", "client-research": "Client research" };

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
  if (!Array.isArray(d) && "body" in d && ("subject" in d || "lead_id" in d)) return "draft";
  const list = Array.isArray(d) ? d : Array.isArray(d.leads) ? d.leads : Array.isArray(d.clients) ? d.clients : [d];
  const x = list.find((o) => o && typeof o === "object") || {};
  if ("client_id" in x) return "client-research";
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
export function sentIds(kind) { const s = loadSent()[kind] || {}; const now = Date.now(); return new Set(Object.entries(s).filter(([, t]) => now - t < 2 * 86400000).map(([id]) => id)); }
export const openInbox = () => window.dispatchEvent(new Event("open-claude-inbox"));

// Small reminder for each "copy the prompt" panel.
export function PasteHint({ className = "" }) {
  return <p className={`text-xs text-zinc-600 ${className}`}>Paste Claude’s reply into <button onClick={openInbox} className="font-semibold text-orange-700 underline">Paste from Claude</button> (top right). Any reply, any order: it knows where each one goes.</p>;
}

export function ClaudeInbox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const o = () => setOpen(true); window.addEventListener("open-claude-inbox", o); return () => window.removeEventListener("open-claude-inbox", o); }, []);
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
      <button onClick={() => setOpen(true)} className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-1 text-sm font-medium text-white hover:bg-orange-700">Paste from Claude</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3">
              <h3 className="text-lg font-semibold">Paste from Claude</h3><span className="text-xs text-zinc-500">Any reply from any prompt in the app</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><CloseIcon /></button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData("text"); if (detectReply(t)) { e.preventDefault(); take(t); } }} rows={6}
                placeholder="Paste Claude's reply here. It's added as soon as you paste; paste the next one straight after."
                className="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs" />
              <div className="flex items-center gap-2">
                <button onClick={() => take(text)} disabled={!text.trim() || busy} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{busy ? "Adding…" : "Add"}</button>
                <span className="text-[11px] text-zinc-500">Works for: {Object.values(KIND_LABEL).join(", ")}.</span>
              </div>
              {log.length > 0 && (
                <ul className="space-y-1 border-t border-zinc-100 pt-2">
                  {log.map((x, n) => (
                    <li key={n} className={`flex gap-2 text-xs ${x.ok ? "text-zinc-800" : "text-red-700"}`}>
                      <span className="w-10 shrink-0 text-zinc-400">{x.at}</span>
                      {x.kind && <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">{KIND_LABEL[x.kind]}</span>}
                      <span>{x.ok ? "✓ " : ""}{x.msg}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
