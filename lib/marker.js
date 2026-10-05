// Marker.io via its MCP server (Model Context Protocol over HTTP).
// The app acts as a small MCP client: list the server's tools, then call the
// one that creates an issue. Token and URL come from Vercel env vars.

const URL_ = process.env.MARKER_MCP_URL || "";
const TOKEN = process.env.MARKER_MCP_TOKEN || process.env.MARKER_API_TOKEN || "";
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

// ---------------------------------------------------------------------------
// Accessibility monitoring (Marker.io "Monitor"). Tool results come back as
// text, usually JSON; parse when possible and keep the raw text otherwise.

async function callTool(name, args) {
  await connect();
  const res = await rpc("tools/call", { name, arguments: args });
  const text = (res?.content || []).map((c) => c.text || "").join("\n");
  if (res?.isError) throw new Error(text.slice(0, 300) || `Marker.io ${name} failed`);
  let data = null;
  try { data = JSON.parse(text); } catch { const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text); if (m) { try { data = JSON.parse(m[0]); } catch {} } }
  return { data, text };
}

// Find the first array of objects anywhere in a response (lists are often wrapped).
function firstList(x, depth = 0) {
  if (Array.isArray(x)) return x.length && typeof x[0] === "object" ? x : null;
  if (x && typeof x === "object" && depth < 4) {
    for (const k of ["checks", "items", "data", "results", "elements", "pages", "scans"]) if (Array.isArray(x[k])) return x[k];
    for (const v of Object.values(x)) { const l = firstList(v, depth + 1); if (l) return l; }
  }
  return null;
}
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);

export async function monitorOverview(projectId) {
  const [sum, checks] = await Promise.all([
    callTool("monitor_summary", { projectId }),
    callTool("monitor_checks_list", { projectId, status: "failing", limit: 50 }).catch((e) => ({ data: null, text: "", error: String(e.message) })),
  ]);
  // Shape (Oct 2026): { accessibilityScore, checks: {failed, needsReview, passed, ignored}, pages: {monitored}, latestScan: {status, completedAt}, activeScan }
  const s = sum.data && typeof sum.data === "object" ? sum.data : {};
  const score = num(s.accessibilityScore) ?? num(pick(s, "score"));
  const failing = num(s.checks?.failed) ?? num(pick(s, "failingChecks"));
  const needsReview = num(s.checks?.needsReview);
  const passed = num(s.checks?.passed);
  const pagesMonitored = num(s.pages?.monitored) ?? num(pick(s, "pagesMonitored"));
  const lastScan = s.latestScan?.completedAt ?? pick(s, "lastScanAt");
  const scanning = !!s.activeScan;
  // { checks: [{checkId, description, category, severity, wcagTags[], failedElements, affectedPages, progress, ignored}], total }
  const list = (firstList(checks.data) || []).filter((c) => !c.ignored);
  const checksOut = list.map((c) => ({
    id: pick(c, "checkId", "id"),
    name: pick(c, "description", "name", "title") || String(pick(c, "checkId", "id") || "Check"),
    impact: pick(c, "severity", "impact"),
    elements: num(pick(c, "failedElements", "elements", "count")),
    pages: num(pick(c, "affectedPages", "pages")),
    category: pick(c, "category"),
    wcag: pick(c, "wcagTags", "wcag"),
    progress: num(c.progress),
    help: pick(c, "helpUrl", "url", "link"),
  })).filter((c) => c.name);
  return {
    ok: true, projectId, score, failing: failing ?? (checksOut.length || undefined), needsReview, passed, pagesMonitored, scanning,
    lastScan: typeof lastScan === "string" || typeof lastScan === "number" ? lastScan : undefined, domain: s.domainUrl,
    checks: checksOut, note: sum.text.replace(/\s+/g, " ").slice(0, 240), raw: { summary: sum.text.slice(0, 4000), checks: (checks.text || checks.error || "").slice(0, 4000) },
  };
}

// Link to a check inside Marker.io's accessibility monitor for the project.
export function monitorCheckLink(projectLink, checkId) {
  try {
    const u = new URL(projectLink);
    const pid = projectIdFromLink(projectLink);
    return `${u.origin}/projects/${pid}/monitor/accessibility/checks/${encodeURIComponent(checkId)}`;
  } catch { return ""; }
}
export function monitorLink(projectLink) {
  try { const u = new URL(projectLink); return `${u.origin}/projects/${projectIdFromLink(projectLink)}/monitor/accessibility`; } catch { return projectLink; }
}

// Failing elements for one check, in plain terms: page + element + suggested fix.
export async function monitorElements(projectId, checkId) {
  const r = await callTool("monitor_elements_list", { projectId, checkId, status: "failing", limit: 50 });
  const list = firstList(r.data) || [];
  return list.map((e) => ({
    page: pick(e, "pageUrl", "page", "url"),
    html: String(pick(e, "html", "sampleHtml", "snippet", "element") || "").slice(0, 160),
    text: String(pick(e, "text", "label", "nodeLabel", "summary") || "").slice(0, 120),
    fix: String(pick(e, "suggestedHtml", "suggestion", "fix", "howToFix") || "").slice(0, 200),
    id: pick(e, "id", "elementId", "fingerprint"),
  }));
}

export async function monitorGuide(projectId, checkId) {
  const r = await callTool("monitor_check_guide", { projectId, checkId });
  return r.text.slice(0, 6000);
}

export async function monitorScanTrigger(projectId) {
  const r = await callTool("monitor_scan_trigger", { projectId });
  const scanId = pick(r.data || {}, "scanId", "id") ?? firstList(r.data)?.[0]?.id;
  return { scanId, text: r.text.slice(0, 500) };
}
export async function monitorScanGet(projectId, scanId) {
  const r = await callTool("monitor_scan_get", { projectId, scanId });
  const d = r.data || {};
  const status = String(pick(d, "status", "state") || "").toLowerCase();
  return { status, done: /complete|finish|done|success/.test(status), failed: /fail|error|cancel/.test(status), text: r.text.slice(0, 500) };
}
