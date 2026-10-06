// Shared storage for sign-offs, the sign-off log and team names.
// Uses Upstash Redis over its REST API (free tier, added from the Vercel
// Marketplace). Without it the app falls back to each browser's own storage.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const storeConfigured = () => Boolean(URL_ && TOKEN);

async function redis(...command) {
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
