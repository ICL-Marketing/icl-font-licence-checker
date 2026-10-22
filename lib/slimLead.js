// Not-pursuing leads keep only what stops them being found again: the company name and
// Companies House number (the lead finder skips any company number it already holds).
// Everything else (emails, drafts, contacts, scan results) is dropped to save storage.
// Opt-outs are kept so we never contact someone who asked us not to.
const KEEP = ["id", "business", "companyNumber", "status", "statusAt", "statusBy", "addedAt", "updatedAt", "optedOut"];

export const isSlimmable = (l) => !!l && l.status === "not-pursuing";

export function slimLead(l) {
  if (!isSlimmable(l)) return l;
  const out = { slim: true };
  for (const k of KEEP) if (l[k] !== undefined && l[k] !== null && l[k] !== "") out[k] = l[k];
  return out;
}

// True when slimming would actually remove something.
export const needsSlim = (l) => isSlimmable(l) && Object.keys(l).some((k) => k !== "slim" && !KEEP.includes(k));
