// Two copies of the same record (this browser and the shared store, or two tabs): keep the newest
// value of every field. Each save stamps the fields it changed in `edits`, so an older copy pushed
// from another tab can never wipe out something typed more recently here.
export function mergeDoc(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = String(b.updatedAt || "") >= String(a.updatedAt || "") ? b : a;
  const older = newer === a ? b : a;
  const out = { ...older, ...newer };
  const ea = a.edits || {}, eb = b.edits || {};
  const edits = { ...ea };
  for (const [k, t] of Object.entries(eb)) if (!edits[k] || t > edits[k]) edits[k] = t;
  for (const k of Object.keys(edits)) {
    const src = String(ea[k] || "") >= String(eb[k] || "") ? (k in ea ? a : newer) : b;
    if (k in src) out[k] = src[k];
  }
  if (Object.keys(edits).length) out.edits = edits;
  out.updatedAt = newer.updatedAt;
  return out;
}
