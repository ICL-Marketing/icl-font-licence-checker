// The Claude connector (MCP over HTTP, JSON-RPC 2.0): lets a Claude assistant run Check leads in a loop,
// get_next_leads → research → save_lead_checks → get_next_leads, until it says all done (lib/leadQueue.js).
// The link carries a secret key (?key=…, made in Settings → Lead maintenance); the proxy lets this route through.
import { timingSafeEqual } from "node:crypto";
import { getSetting } from "@/lib/store";
import { nextLeadsBatch, saveLeadChecks } from "@/lib/leadQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTIONS = "ICL Sales lead checks. Loop: call get_next_leads, research every lead in the batch as its text says, call save_lead_checks with the JSON, then call get_next_leads again. Repeat until it says all done. Never stop to ask whether to continue.";
const TOOLS = [
  { name: "get_next_leads", description: "The next batch of Website Leads waiting in To assess (up to 10), with the rules for checking each one and the JSON shape to fill in. Says 'All done' when there are none left.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "save_lead_checks", description: "Save the checks for one batch: {batch, leads: [one object per lead in the shape get_next_leads gave]}. Saving a lead again replaces it.", inputSchema: { type: "object", properties: { batch: { type: "string" }, leads: { type: "array", items: { type: "object" } } }, required: ["leads"] } },
];

async function keyOk(k) {
  const saved = (await getSetting("mcp-key").catch(() => null))?.key || "";
  if (!saved || !k) return false;
  const a = Buffer.from(String(k)), b = Buffer.from(saved);
  return a.length === b.length && timingSafeEqual(a, b);
}
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(m) {
  const { id = null, method, params = {} } = m || {};
  if (method === "initialize") return ok(id, { protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ICL Sales leads", version: "1.0.0" }, instructions: INSTRUCTIONS });
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      if (params.name === "get_next_leads") return ok(id, { content: [{ type: "text", text: (await nextLeadsBatch()).text }] });
      if (params.name === "save_lead_checks") return ok(id, { content: [{ type: "text", text: await saveLeadChecks(params.arguments || {}) }] });
      return ok(id, { content: [{ type: "text", text: `Unknown tool: ${params.name}` }], isError: true });
    } catch (e) { return ok(id, { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true }); }
  }
  if (id === null || id === undefined) return null; // a notification (e.g. notifications/initialized): no reply
  return fail(id, -32601, `Method not found: ${method}`);
}

export async function POST(request) {
  if (!(await keyOk(new URL(request.url).searchParams.get("key")))) return Response.json({ error: "Wrong or missing key" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body) return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  if (Array.isArray(body)) { const out = (await Promise.all(body.map(handle))).filter(Boolean); return out.length ? Response.json(out) : new Response(null, { status: 202 }); }
  const out = await handle(body);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}
export async function GET() { return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } }); }
export async function DELETE() { return new Response(null, { status: 405 }); }
