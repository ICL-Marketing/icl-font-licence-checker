import { markerConfigured, listTools, pickCreateTool, createIssue, projectIdFromLink } from "@/lib/marker";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// GET: connection test for the Settings page. POST: create a snag.
export async function GET() {
  if (!markerConfigured()) return Response.json({ configured: false });
  try {
    const tools = await listTools();
    const t = pickCreateTool(tools);
    return Response.json({ configured: true, ok: true, tools: tools.map((x) => ({ name: x.name, description: (x.description || "").slice(0, 160), fields: Object.keys(x.inputSchema?.properties || {}) })), createTool: t?.name || null });
  } catch (e) {
    return Response.json({ configured: true, ok: false, error: String(e?.message || e) });
  }
}

export async function POST(request) {
  if (!markerConfigured()) return Response.json({ error: "Marker.io is not set up. Add MARKER_MCP_URL and MARKER_MCP_TOKEN in Vercel." }, { status: 400 });
  const b = await request.json().catch(() => ({}));
  if (!b.title) return Response.json({ error: "title required" }, { status: 400 });
  try {
    const out = await createIssue({ title: String(b.title).slice(0, 200), description: String(b.description || "").slice(0, 5000), project: projectIdFromLink(b.project || "") });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) });
  }
}
