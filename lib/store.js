// Shared storage for sign-offs, the sign-off log and team names.
// Uses Upstash Redis over its REST API (free tier, added from the Vercel
// Marketplace). Without it the app falls back to each browser's own storage.

// Vercel's marketplace names the variables differently depending on the
// integration and any prefix chosen when connecting, so accept any
// *REST_API_URL / *REST_URL pair (read-only tokens are skipped).
function findVar(re, skip) {
  const names = Object.keys(process.env).filter((k) => re.test(k) && !(skip && skip.test(k))).sort((a, b) => a.length - b.length);
  for (const k of names) if (process.env[k]) return process.env[k];
  return "";
}
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || findVar(/(REST_API_URL|REDIS_REST_URL)$/i);
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || findVar(/(REST_API_TOKEN|REDIS_REST_TOKEN)$/i, /READ_ONLY/i);

// Redis Cloud (the "Redis" store on the Vercel Marketplace) gives a plain
// redis:// connection string instead of a REST pair; any *REDIS_URL works.
const TCP_URL = process.env.REDIS_URL || findVar(/REDIS_URL$/i);

export const storeConfigured = () => Boolean((URL_ && TOKEN) || TCP_URL);
// Names (never values) of storage-looking variables, to show in Settings when not connected.
export const storeVarsSeen = () => Object.keys(process.env).filter((k) => /(KV_|REDIS|UPSTASH)/i.test(k)).sort();

let tcp = null;
async function tcpClient() {
  if (!tcp) {
    const { default: Redis } = await import("ioredis");
    tcp = new Redis(TCP_URL, { lazyConnect: true, maxRetriesPerRequest: 2, connectTimeout: 8000, enableOfflineQueue: true });
    tcp.on("error", () => {}); // reported per command instead
  }
  return tcp;
}

async function redis(...command) {
  if (!(URL_ && TOKEN)) {
    // ioredis .call() returns raw replies, so HGETALL is a flat list like Upstash's REST API.
    const c = await tcpClient();
    return c.call(...command.map((x) => (typeof x === "number" ? String(x) : x)));
  }
  const r = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Storage error ${r.status}`);
  return j.result;
}

const siteKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9.:-]/g, "").slice(0, 200);
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

export async function getSignoffs(site) {
  const k = siteKey(site);
  const [flat, log] = await Promise.all([redis("HGETALL", `launch:signoffs:${k}`), redis("LRANGE", `launch:log:${k}`, 0, -1)]);
  const signoffs = {};
  for (let i = 0; i < (flat || []).length; i += 2) { const v = parse(flat[i + 1]); if (v) signoffs[flat[i]] = v; }
  return { signoffs, log: (log || []).map(parse).filter(Boolean) };
}

// Sign off (name) or remove a sign-off (name = null). Every change is appended to the log.
export async function setSignoff(site, { checkId, check, name, notRequired = false }) {
  const k = siteKey(site);
  const at = new Date().toISOString();
  const prevRaw = await redis("HGET", `launch:signoffs:${k}`, checkId);
  const prev = parse(prevRaw);
  let entry;
  if (name) {
    await redis("HSET", `launch:signoffs:${k}`, checkId, JSON.stringify({ name, at, ...(notRequired ? { notRequired: true } : {}) }));
    entry = { at, checkId, check, action: notRequired ? "Marked not required" : prev ? `Changed from ${prev.name}` : "Signed off", name };
  } else {
    await redis("HDEL", `launch:signoffs:${k}`, checkId);
    entry = { at, checkId, check, action: "Sign-off removed", name: prev?.name || "" };
  }
  await redis("RPUSH", `launch:log:${k}`, JSON.stringify(entry));
  return getSignoffs(site);
}

export async function getTeam() {
  const v = parse(await redis("GET", "settings:team"));
  return Array.isArray(v) ? v : null;
}
export async function setTeam(list) {
  await redis("SET", "settings:team", JSON.stringify(list));
  return list;
}

export async function getClients() {
  const v = parse(await redis("GET", "settings:clients"));
  return Array.isArray(v) ? v : null;
}
export async function setClients(list) {
  await redis("SET", "settings:clients", JSON.stringify(list));
  return list;
}

// ---- Scan results shared across the team, one hash per kind (fonts, images,
// launch, post), one field per site. Values are gzip+base64 so a 500-page
// launch check fits Upstash's request limit.
import { gzipSync, gunzipSync } from "node:zlib";
const pack = (v) => gzipSync(Buffer.from(JSON.stringify(v))).toString("base64");
const unpack = (s) => { try { return JSON.parse(gunzipSync(Buffer.from(s, "base64")).toString("utf8")); } catch { return null; } };

export async function getResults(kind) {
  const flat = await redis("HGETALL", `results:${kind}`);
  const out = {};
  for (let i = 0; i < (flat || []).length; i += 2) { const v = unpack(flat[i + 1]); if (v) out[flat[i]] = v; }
  return out;
}
export async function setResult(kind, site, data) {
  await redis("HSET", `results:${kind}`, siteKey(site), pack(data));
}
export async function deleteResult(kind, site) {
  await redis("HDEL", `results:${kind}`, siteKey(site));
}
export async function clearResults(kind) {
  await redis("DEL", `results:${kind}`);
}

// ---- Small shared settings (Marker.io project links per site, email edits).
const SETTING_KEYS = new Set(["marker", "email-edits", "lead-links"]);
export const settingKeyOk = (k) => SETTING_KEYS.has(k);
export async function getSetting(key) {
  return parse(await redis("GET", `settings:${key}`));
}
export async function setSetting(key, value) {
  await redis("SET", `settings:${key}`, JSON.stringify(value));
  return value;
}

// Is the shared store reachable right now?
export async function pingStore() {
  if (!storeConfigured()) return { configured: false, ok: false };
  try { await redis("PING"); return { configured: true, ok: true }; }
  catch (e) { return { configured: true, ok: false, error: String(e?.message || e) }; }
}
