import { storeConfigured, getSignoffs, setSignoff } from "@/lib/store";

export const dynamic = "force-dynamic";

// Shared sign-offs and their log for one site. { shared: false } when no store is set up.
export async function GET(request) {
  const site = new URL(request.url).searchParams.get("site") || "";
  if (!storeConfigured()) return Response.json({ shared: false });
  if (!site) return Response.json({ error: "site required" }, { status: 400 });
  try { return Response.json({ shared: true, ...(await getSignoffs(site)) }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!b.site || !b.checkId) return Response.json({ error: "site and checkId required" }, { status: 400 });
  try {
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : null;
    return Response.json({ shared: true, ...(await setSignoff(b.site, { checkId: String(b.checkId).slice(0, 60), check: String(b.check || "").slice(0, 200), name })) });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
