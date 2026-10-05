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
  const ROLES = ["Development", "Senior Developer", "Designer", "Account Manager", "Content"];
  const seen = new Map();
  for (const x of b.team) {
    const name = String(typeof x === "string" ? x : x?.name || "").trim().slice(0, 60);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, role: ROLES.includes(x?.role) ? x.role : "" });
  }
  const team = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name, "en", { sensitivity: "base" })).slice(0, 200);
  try { return Response.json({ shared: true, team: await setTeam(team) }); }
  catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
}
