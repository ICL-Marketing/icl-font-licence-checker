import { storeConfigured, getClients, setClients } from "@/lib/store";
import { normaliseClients } from "@/lib/clients";

export const dynamic = "force-dynamic";

// Shared client list (when storage is configured). Otherwise each browser keeps its own.
export async function GET() {
  if (!storeConfigured()) return Response.json({ shared: false });
  try { return Response.json({ shared: true, clients: await getClients() }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!Array.isArray(b.clients)) return Response.json({ error: "clients required" }, { status: 400 });
  try { return Response.json({ shared: true, clients: await setClients(normaliseClients(b.clients).slice(0, 2000)) }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
