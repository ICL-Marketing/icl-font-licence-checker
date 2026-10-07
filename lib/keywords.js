/**
 * Monthly search volumes from Google Ads Keyword Planner (free, needs a Google
 * Ads developer token with Basic access plus an OAuth refresh token).
 *
 * Env: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *      GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID (10 digits, no dashes),
 *      optional GOOGLE_ADS_LOGIN_CUSTOMER_ID (the manager account, if any) and
 *      GOOGLE_ADS_API_VERSION (defaults to v21).
 *
 * Volumes are cached for 90 days, so each search is looked up once.
 */

const env = (k) => process.env[k] || "";
export const keywordsConfigured = () => Boolean(env("GOOGLE_ADS_DEVELOPER_TOKEN") && env("GOOGLE_ADS_CLIENT_ID") && env("GOOGLE_ADS_CLIENT_SECRET") && env("GOOGLE_ADS_REFRESH_TOKEN") && env("GOOGLE_ADS_CUSTOMER_ID"));

let tokenCache = { value: "", until: 0 };
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.until) return tokenCache.value;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_ADS_CLIENT_ID"), client_secret: env("GOOGLE_ADS_CLIENT_SECRET"), refresh_token: env("GOOGLE_ADS_REFRESH_TOKEN"), grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed (${j.error_description || j.error || r.status}). Check the Google Ads client ID, secret and refresh token.`);
  tokenCache = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000 };
  return j.access_token;
}

// UK, English. Returns { "plumber teddington": 140, … } for the queries given (lower-case keys).
export async function searchVolumes(queries) {
  const list = [...new Set(queries.map((q) => String(q || "").toLowerCase().trim()).filter(Boolean))].slice(0, 100);
  if (!list.length || !keywordsConfigured()) return {};
  const { cacheGet, cacheSet } = await import("@/lib/store");
  const out = {};
  const todo = [];
  for (const q of list) { const c = await cacheGet(`vol:${q}`); if (c && typeof c.v === "number") out[q] = c.v; else todo.push(q); }
  if (!todo.length) return out;
  const ver = env("GOOGLE_ADS_API_VERSION") || "v21";
  const cid = env("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "");
  const headers = { authorization: `Bearer ${await accessToken()}`, "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN"), "content-type": "application/json" };
  const login = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, "");
  if (login) headers["login-customer-id"] = login;
  const r = await fetch(`https://googleads.googleapis.com/${ver}/customers/${cid}:generateKeywordHistoricalMetrics`, {
    method: "POST", headers, cache: "no-store",
    body: JSON.stringify({ keywords: todo, geoTargetConstants: ["geoTargetConstants/2826"], language: "languageConstants/1000", keywordPlanNetwork: "GOOGLE_SEARCH" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || j.error?.details?.[0]?.errors?.[0]?.message || `Google Ads API error ${r.status}`;
    throw new Error(/developer token/i.test(msg) ? `${msg} (the developer token needs Basic access, not test-account access)` : msg);
  }
  for (const row of j.results || []) {
    const q = String(row.text || "").toLowerCase();
    const v = Number(row.keywordMetrics?.avgMonthlySearches) || 0;
    out[q] = v;
    await cacheSet(`vol:${q}`, { v }, 90 * 86400);
  }
  for (const q of todo) if (!(q in out)) { out[q] = 0; await cacheSet(`vol:${q}`, { v: 0 }, 30 * 86400); }
  return out;
}
