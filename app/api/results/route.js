import { storeConfigured, getResults, getResult, setResult, deleteResult, clearResults } from "@/lib/store";
import { mergeDoc } from "@/lib/merge";
import { logActivity } from "@/lib/activity";
import { slimLead, needsSlim } from "@/lib/slimLead";

// A name for the activity log: the business, the client, or the site.
const labelOf = (d) => d?.business || d?.name || d?.client || d?.site || "";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KINDS = ["fonts", "images", "launch", "post", "design", "leads", "ideas", "proposals", "consent", "lead-inbox"]; // lead-inbox: checks saved by the Claude connector

// Shared scan results. GET ?kind=… returns {site: data}. POST {kind, site, data} saves one site;
// DELETE {kind, site} removes one, DELETE {kind} clears the kind.
export async function GET(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const kind = new URL(request.url).searchParams.get("kind");
  if (!KINDS.includes(kind)) return Response.json({ error: "kind required" }, { status: 400 });
  try {
    const results = await getResults(kind);
    // One-off tidy as leads are read: shrink any not-pursuing lead still holding full data.
    if (kind === "leads") for (const [id, l] of Object.entries(results)) if (needsSlim(l)) { results[id] = slimLead(l); await setResult(kind, id, results[id]).catch(() => {}); }
    return Response.json({ shared: true, results });
  }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!KINDS.includes(b.kind) || !b.site || !b.data) return Response.json({ error: "kind, site and data required" }, { status: 400 });
  // Leads and ideas are edited by hand: merge field by field so an older copy never overwrites newer typing.
  try {
    let data = b.data;
    const cur = await getResult(b.kind, b.site).catch(() => null);
    if ((b.kind === "leads" || b.kind === "ideas") && cur) data = mergeDoc(cur, data);
    if (b.kind === "leads") data = slimLead(data);
    await setResult(b.kind, b.site, data);
    await logActivity({ area: b.kind, item: b.site, label: labelOf(data), before: cur, after: data });
    return Response.json({ shared: true });
  }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}

export async function DELETE(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!KINDS.includes(b.kind)) return Response.json({ error: "kind required" }, { status: 400 });
  try {
    if (b.site) { const cur = await getResult(b.kind, b.site).catch(() => null); await deleteResult(b.kind, b.site); await logActivity({ area: b.kind, item: b.site, label: labelOf(cur), what: "deleted" }); }
    else { await clearResults(b.kind); await logActivity({ area: b.kind, item: "all", what: "cleared everything" }); }
    return Response.json({ shared: true });
  }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
