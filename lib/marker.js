// Marker.io via its MCP server (Model Context Protocol over HTTP).
// The app acts as a small MCP client: list the server's tools, then call the
// one that creates an issue. Token and URL come from Vercel env vars.

const URL_ = process.env.MARKER_MCP_URL || "";
const TOKEN = process.env.MARKER_MCP_TOKEN || "";
export const markerConfigured = () => Boolean(URL_ && TOKEN);

let rpcId = 1;
let sessionId = "";

async function rpc(method, params) {
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const r = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }), cache: "no-store" });
  const sid = r.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw new Error("Marker.io rejected the token (expired or revoked). Generate a new one in Marker.io → MCP → Access token and update MARKER_MCP_TOKEN in Vercel.");
  if (!r.ok) throw new Error(`Marker.io MCP error ${r.status}: ${text.slice(0, 200)}`);
  // Streamable HTTP may answer as SSE: take the last JSON data line.
  let json;
  if (/^\s*data:/m.test(text)) {
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    json = JSON.parse(lines[lines.length - 1]);
  } else {
    json = JSON.parse(text);
  }
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function connect() {
  try {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ICL Website Checker", version: "1.0" } });
    await fetch(URL_, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), cache: "no-store" }).catch(() => {});
  } catch (e) {
    // Some servers skip the handshake; carry on and let tools/list decide.
    if (/401|403|token/i.test(String(e.message))) throw e;
  }
}

export async function listTools() {
  await connect();
  const res = await rpc("tools/list", {});
  return res?.tools || [];
}

// Pick the tool that creates an issue, and map our fields onto its schema.
export function pickCreateTool(tools) {
  const score = (t) => {
    const n = (t.name || "").toLowerCase();
    let s = 0;
    if (/create|add|new|report|submit/.test(n)) s += 2;
    if (/issue|feedback|bug|ticket|snag/.test(n)) s += 2;
    if (/comment|project|member|webhook|list|get|search|update|delete/.test(n)) s -= 3;
    return s;
  };
  return [...tools].sort((a, b) => score(b) - score(a)).find((t) => score(t) >= 3) || null;
}
export function buildArgs(tool, { title, description, project }) {
  const props = tool?.inputSchema?.properties || {};
  const keys = Object.keys(props);
  const find = (...res) => keys.find((k) => res.some((re) => re.test(k)));
  const args = {};
  const kTitle = find(/^title$/i, /title|summary|name/i);
  const kDesc = find(/^description$/i, /description|body|details|text|content/i);
  const kProj = find(/^project_?id$/i, /project/i);
  if (kTitle) args[kTitle] = title;
  if (kDesc) args[kDesc] = description;
  else if (kTitle) args[kTitle] = `${title}\n\n${description}`.slice(0, 2000);
  if (kProj && project) args[kProj] = project;
  // Sensible defaults for common optional fields.
  for (const k of keys) {
    if (k in args) continue;
    const p = props[k];
    if (/priority/i.test(k) && p?.enum?.length) args[k] = p.enum.find((v) => /medium|normal/i.test(String(v))) || p.enum[0];
    if (/type|issue_?type/i.test(k) && p?.enum?.length) args[k] = p.enum.find((v) => /bug|issue/i.test(String(v))) || p.enum[0];
  }
  return { args, missing: (tool?.inputSchema?.required || []).filter((k) => !(k in args)) };
}

export async function createIssue({ title, description, project }) {
  const tools = await listTools();
  const tool = pickCreateTool(tools);
  if (!tool) throw new Error(`Marker.io's MCP does not offer a tool that creates issues. Tools available: ${tools.map((t) => t.name).join(", ") || "none"}.`);
  const { args, missing } = buildArgs(tool, { title, description, project });
  if (missing.length) throw new Error(`Marker.io needs more information to create an issue (${missing.join(", ")}). Tool: ${tool.name}.`);
  const res = await rpc("tools/call", { name: tool.name, arguments: args });
  if (res?.isError) throw new Error((res.content || []).map((c) => c.text).join(" ").slice(0, 300) || "Marker.io returned an error.");
  const text = (res?.content || []).map((c) => c.text || "").join("\n");
  const link = /https?:\/\/\S+/.exec(text)?.[0] || "";
  return { tool: tool.name, text: text.slice(0, 500), link };
}

// Marker.io project id from a pasted project link (last path segment that looks like an id).
export function projectIdFromLink(link) {
  try {
    const u = new URL(link);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => /^projects?$/i.test(p));
    return (i >= 0 ? parts[i + 1] : parts[parts.length - 1]) || "";
  } catch {
    return String(link || "").trim();
  }
}
