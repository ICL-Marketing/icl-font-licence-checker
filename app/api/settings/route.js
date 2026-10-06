import { storeConfigured, settingKeyOk, getSetting, setSetting } from "@/lib/store";

export const dynamic = "force-dynamic";

// Shared key/value settings: ?key=marker (site → Marker.io project link) or
// ?key=email-edits (edited email wording). { shared: false } without a store.
export async function GET(request) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!settingKeyOk(key)) return Response.json({ error: "unknown key" }, { status: 400 });
  if (!storeConfigured()) return Response.json({ shared: false });
  try { return Response.json({ shared: true, value: (await getSetting(key)) ?? {} }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  if (!settingKeyOk(b.key)) return Response.json({ error: "unknown key" }, { status: 400 });
  if (!storeConfigured()) return Response.json({ shared: false });
  if (!b.value || typeof b.value !== "object" || Array.isArray(b.value)) return Response.json({ error: "value must be an object" }, { status: 400 });
  if (JSON.stringify(b.value).length > 900_000) return Response.json({ error: "too large" }, { status: 413 });
  try { return Response.json({ shared: true, value: await setSetting(b.key, b.value) }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
