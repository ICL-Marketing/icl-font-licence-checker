import { storeConfigured, setTemplatePart, getTemplatePart } from "@/lib/store";

export const dynamic = "force-dynamic";

// Pieces of the uploaded proposal template: GET ?part=i -> { data }, POST { part, data } saves one.
export async function GET(request) {
  const part = Number(new URL(request.url).searchParams.get("part"));
  if (!Number.isInteger(part) || part < 0) return Response.json({ error: "part required" }, { status: 400 });
  if (!storeConfigured()) return Response.json({ shared: false, data: "" });
  try { return Response.json({ shared: true, data: await getTemplatePart(part) }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  if (!Number.isInteger(b.part) || b.part < 0 || typeof b.data !== "string") return Response.json({ error: "part and data required" }, { status: 400 });
  if (b.data.length > 700000) return Response.json({ error: "piece too large" }, { status: 413 });
  if (!storeConfigured()) return Response.json({ shared: false });
  try { await setTemplatePart(b.part, b.data); return Response.json({ shared: true }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
