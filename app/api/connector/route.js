// Settings → Lead maintenance: the Claude connector link (signed in only). GET shows it; POST {action: "new"} makes a
// new secret, which stops the old link working everywhere it was added.
import { randomBytes } from "node:crypto";
import { getSetting, setSetting, getResults } from "@/lib/store";

export const dynamic = "force-dynamic";

const linkFor = (request, key) => (key ? `${new URL(request.url).origin}/api/mcp?key=${key}` : "");
export async function GET(request) {
  const key = (await getSetting("mcp-key").catch(() => null))?.key || "";
  const inbox = await getResults("lead-inbox").catch(() => ({}));
  return Response.json({ link: linkFor(request, key), waiting: Object.keys(inbox || {}).length });
}
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  if (b.action !== "new") return Response.json({ error: "unknown action" }, { status: 400 });
  const key = randomBytes(24).toString("base64url");
  await setSetting("mcp-key", { key, at: new Date().toISOString() });
  return Response.json({ link: linkFor(request, key) });
}
