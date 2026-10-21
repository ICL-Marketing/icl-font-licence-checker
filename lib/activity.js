// The activity log: every saved change, with who made it (from their sign-in) and what changed.
import { cookies } from "next/headers";
import { COOKIE, readSession } from "@/lib/auth";
import { pushActivity } from "@/lib/store";

// Bookkeeping fields that change on their own; not edits worth listing.
const NOISE = new Set(["updatedAt", "edits", "checking", "statusAt", "syncedAt", "seenAt", "checkedAt", "vetAt", "at", "scannedAt"]);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const keyed = (v) => Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && (x.key || x.id));

// What changed between two saved versions, in words: "status", "email", "idea “Add a booking form”: status".
export function changes(before, after) {
  if (!before) return ["created"];
  if (!after) return ["deleted"];
  const out = [];
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (NOISE.has(k) || same(before[k], after[k])) continue;
    // Lists of ideas, clients and the like: name the item and the fields that changed in it.
    if (keyed(before[k]) && keyed(after[k])) {
      const idOf = (x) => x.key || x.id, old = new Map(before[k].map((x) => [idOf(x), x]));
      for (const x of after[k]) {
        const o = old.get(idOf(x)), name = x.title || x.name || idOf(x);
        if (!o) { out.push(`added “${name}”`); continue; }
        const f = Object.keys({ ...o, ...x }).filter((f) => !NOISE.has(f) && !same(o[f], x[f]));
        if (f.length) out.push(`“${name}”: ${f.slice(0, 4).join(", ")}`);
        old.delete(idOf(x));
      }
      for (const o of old.values()) out.push(`removed “${o.title || o.name || o.key || o.id}”`);
      continue;
    }
    out.push(k);
  }
  return out;
}

export async function logActivity({ area, item, label = "", before, after, what }) {
  const list = what ? [what] : changes(before, after);
  if (!list.length) return;
  const who = readSession((await cookies()).get(COOKIE)?.value) || "unknown";
  await pushActivity({ at: new Date().toISOString(), who, area, item: String(item || ""), label: String(label || "").slice(0, 120), changes: list.slice(0, 12) });
}
