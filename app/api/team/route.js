import { storeConfigured, getTeam, setTeam } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!storeConfigured()) return Response.json({ shared: false });
  try { return Response.json({ shared: true, team: await getTeam() }); }
  catch (e) { return Response.json({ shared: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!storeConfigured()) return Response.json({ shared: false });
  const b = await request.json().catch(() => ({}));
  if (!Array.isArray(b.team)) return Response.json({ error: "team required" }, { status: 400 });
  const team = [...new Set(b.team.filter((n) => typeof n === "string").map((n) => n.trim().slice(0, 60)).filter(Boolean))]
    .sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" })).slice(0, 200);
  try { return Response.json({ shared: true, team: await setTeam(team) }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
