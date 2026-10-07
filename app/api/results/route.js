import { storeConfigured, getResults, setResult, deleteResult, clearResults } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KINDS = ["fonts", "images", "launch", "post", "design", "leads"];

// Shared scan results. GET ?kind=… returns {site: data}. POST {kind, site, data} saves one site;
// DELETE {kind, site} removes one, DELETE {kind} clears the kind.
export async function GET(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const kind = new URL(request.url).searchParams.get("kind");
  if (!KINDS.includes(kind)) return Response.json({ error: "kind required" }, { status: 400 });
  try { return Response.json({ shared: true, results: await getResults(kind) }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!KINDS.includes(b.kind) || !b.site || !b.data) return Response.json({ error: "kind, site and data required" }, { status: 400 });
  try { await setResult(b.kind, b.site, b.data); return Response.json({ shared: true }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}

export async function DELETE(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!KINDS.includes(b.kind)) return Response.json({ error: "kind required" }, { status: 400 });
  try { if (b.site) await deleteResult(b.kind, b.site); else await clearResults(b.kind); return Response.json({ shared: true }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
