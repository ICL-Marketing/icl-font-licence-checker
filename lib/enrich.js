// Contact finders: eight free tiers stacked so there is always a credit left somewhere.
//
// The point of this file is a mobile number. Outreach is by WhatsApp, so a UK mobile (07…)
// is the prize; email addresses are a useful second prize. Each provider is asked in turn
// and the first one that answers wins, so when one runs out of credits the next one covers.
//
// Nothing here has been tested against a live API: the field names come from each vendor's
// docs, so every response is also walked for anything that looks like a phone number or an
// address (phonesIn, emailsIn). A wrong field name usually still finds the number, but check
// each provider with a real key and a real lookup before trusting it. See API_FINDINGS.md.

const month = () => new Date().toISOString().slice(0, 7);
const secondsLeftInMonth = () => {
  const d = new Date();
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Math.max(3600, Math.round((end - d.getTime()) / 1000));
};

// ---- phone numbers ------------------------------------------------------------------
// A UK mobile starts 07 (or +447). Landlines are worth keeping but are not WhatsApp numbers.
export function tidyPhone(v) {
  const s = String(v || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (/^\+44\d{9,10}$/.test(s)) return "0" + s.slice(3);
  if (/^44\d{9,10}$/.test(s)) return "0" + s.slice(2);
  if (/^0\d{9,10}$/.test(s)) return s;
  return s.length >= 9 ? s : "";
}
export const isUkMobile = (v) => /^07[1-9]\d{8}$/.test(tidyPhone(v));
export const waLink = (v) => (isUkMobile(v) ? `https://wa.me/44${tidyPhone(v).slice(1)}` : "");

// Walk any JSON and collect anything that looks like a phone number or an email address.
// Providers rename fields without warning, so this is the safety net under every parser.
function walk(obj, take, out = [], depth = 0) {
  if (!obj || depth > 6) return out;
  if (Array.isArray(obj)) { for (const v of obj) walk(v, take, out, depth + 1); return out; }
  if (typeof obj === "object") { for (const [k, v] of Object.entries(obj)) { if (typeof v === "string" || typeof v === "number") take(k, String(v), out); else walk(v, take, out, depth + 1); } return out; }
  return out;
}
export function phonesIn(obj) {
  const out = walk(obj, (k, v, acc) => { if (!/phone|mobile|cell|tel\b|msisdn|whatsapp/i.test(k)) return; const p = tidyPhone(v); if (p && p.length >= 10) acc.push(p); });
  return [...new Set(out)];
}
export function emailsIn(obj) {
  const out = walk(obj, (k, v, acc) => { const m = String(v).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i); if (m && /mail|address/i.test(k + v)) acc.push(m[0].toLowerCase()); });
  return [...new Set(out)];
}
const firstMobile = (list) => list.find(isUkMobile) || "";

// ---- failure classes ----------------------------------------------------------------
// Out of credits parks a provider until the month turns over; a bad key parks it for four
// hours (long enough to stop hammering it, short enough that a fix takes effect today);
// a rate limit or a plain "no match" never parks it.
function classify(status, body) {
  const t = String(body || "").toLowerCase();
  if (status === 402 || /insufficient|no credits|out of credits|credit limit|quota|not enough|exceeded your|limit reached|upgrade your plan/.test(t)) return "credits";
  if (status === 401 || status === 403 || /invalid api key|invalid key|unauthorized|unauthenticated|forbidden/.test(t)) return "auth";
  if (status === 429 || /rate limit|too many requests/.test(t)) return "rate";
  return "other";
}
class Fault extends Error { constructor(kind, message) { super(message); this.kind = kind; } }
const fault = (kind, message) => new Fault(kind, message);

// ---- which providers exist ----------------------------------------------------------
// kinds: person = a named person's mobile or email; domain = who works at a domain;
// company = the company's main number; verify = is this address real.
//
// `free` is what the plan gives a month and `cap` is where this app stops, deliberately a
// little short of it. Nothing here is ever allowed to tip an account into paid usage: the
// app counts every credit it spends and refuses the call that would cross the cap, and it
// counts the most a call could cost (a Prospeo mobile is 10 credits) before making it.
// `cost` is the usual charge per call, `maxCost` the worst case.
export const FINDERS = [
  { id: "prospeo", name: "Prospeo", env: ["PROSPEO_API_KEY"], free: 100, cap: 90, cost: 1, maxCost: 10, kinds: ["person"], unit: "credits", plan: "100 credits a month", mobiles: true,
    signup: "https://prospeo.io/", help: "The best of them for mobile numbers. A match with a mobile costs 10 credits, so 100 free credits is about 10 numbers a month." },
  { id: "lusha", name: "Lusha", env: ["LUSHA_API_KEY"], free: 25, cap: 22, cost: 1, maxCost: 1, kinds: ["person"], unit: "credits", plan: "small free allowance, size depends on the plan", mobiles: true,
    signup: "https://www.lusha.com/", help: "Also returns mobile numbers, with a do-not-call flag. API access depends on the plan, so the cap here is deliberately low." },
  { id: "dropcontact", name: "Dropcontact", env: ["DROPCONTACT_API_KEY"], free: 50, cap: 45, cost: 1, maxCost: 1, kinds: ["person"], unit: "credits", plan: "50 email credits",
    signup: "https://www.dropcontact.com/", help: "French, GDPR-minded, mostly email. Slow: up to 15 seconds a lookup." },
  { id: "apollo", name: "Apollo.io", env: ["APOLLO_API_KEY"], free: 50, cap: 45, cost: 1, maxCost: 1, kinds: ["person", "domain", "company"], unit: "credits", plan: "limited free credits",
    signup: "https://www.apollo.io/", help: "Good for names and job titles, and for a company's switchboard number. Mobiles only arrive later by webhook, so they are not used." },
  { id: "tomba", name: "Tomba", env: ["TOMBA_API_KEY", "TOMBA_API_SECRET"], free: 25, cap: 22, cost: 1, maxCost: 1, kinds: ["domain", "person", "verify"], unit: "searches", plan: "25 searches and 50 verifications a month",
    signup: "https://tomba.io/", help: "Email discovery by domain, plus verification. The free search allowance is the smaller of the two, so that is the cap." },
  { id: "hunter", name: "Hunter.io", env: ["HUNTER_API_KEY"], free: 50, cap: 45, cost: 1, maxCost: 1, kinds: ["domain", "person", "verify"], unit: "searches", plan: "50 searches a month",
    signup: "https://hunter.io/users/sign_up", help: "Named people at a domain with a confidence score. The one this app used first. Its head-count check stays free and is used on every lead." },
  { id: "snov", name: "Snov.io", env: ["SNOV_CLIENT_ID", "SNOV_CLIENT_SECRET"], free: 50, cap: 45, cost: 1, maxCost: 1, kinds: ["domain"], unit: "credits", plan: "free allowance, 1 credit per 10 addresses",
    signup: "https://snov.io/", help: "Email addresses at a domain." },
  { id: "getprospect", name: "GetProspect", env: ["GETPROSPECT_API_KEY"], free: 50, cap: 45, cost: 1, maxCost: 1, kinds: ["domain", "person"], unit: "credits", plan: "about 50 emails a month",
    signup: "https://getprospect.com/", help: "Another email finder by name and company. Email only." },
  { id: "zerobounce", name: "ZeroBounce", env: ["ZEROBOUNCE_API_KEY"], free: 100, cap: 90, cost: 1, maxCost: 1, kinds: ["verify"], unit: "verifications", plan: "100 verifications a month",
    signup: "https://www.zerobounce.net/", help: "Checks an address is real before you send to it. No discovery." },
  { id: "bouncer", name: "Bouncer", env: ["BOUNCER_API_KEY"], free: 100, cap: 90, cost: 1, maxCost: 1, kinds: ["verify"], unit: "verifications", plan: "about 100 verifications a month",
    signup: "https://www.usebouncer.com/", help: "Verification only, with a clear deliverable / risky / undeliverable answer." },
  { id: "abstract", name: "Abstract API", env: ["ABSTRACT_EMAIL_API_KEY"], free: 100, cap: 90, cost: 1, maxCost: 1, kinds: ["verify"], unit: "verifications", plan: "about 100 verifications a month",
    signup: "https://www.abstractapi.com/api/email-verification-validation-api", help: "Verification only. Also flags disposable and role addresses." },
  { id: "mailboxlayer", name: "MailboxLayer", env: ["MAILBOXLAYER_API_KEY"], free: 100, cap: 90, cost: 1, maxCost: 1, kinds: ["verify"], unit: "verifications", plan: "about 100 verifications a month",
    signup: "https://mailboxlayer.com/", help: "Verification only (apilayer). Gives an SMTP check and a quality score." },
];
const byId = Object.fromEntries(FINDERS.map((f) => [f.id, f]));
const keyOf = (id, i = 0) => process.env[byId[id]?.env[i]] || "";
export const finderConfigured = (id) => Boolean(byId[id] && byId[id].env.every((e) => process.env[e]));
export const anyFinder = () => FINDERS.some((f) => finderConfigured(f.id));
// The cap can be raised in Vercel on a paid plan, and only a deliberate "0" means no cap.
// Anything unreadable falls back to the safe default rather than becoming "unlimited".
const capOf = (id) => {
  const raw = process.env[`${id.toUpperCase()}_MONTHLY_CAP`];
  if (raw === undefined || String(raw).trim() === "") return byId[id].cap;
  if (String(raw).trim() === "0") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : byId[id].cap;
};
// The most one lead is ever allowed to cost, across every provider put together.
export const LOOKUP_BUDGET = Number(process.env.FINDER_LOOKUP_BUDGET) > 0 ? Math.floor(Number(process.env.FINDER_LOOKUP_BUDGET)) : 14;

// ---- usage and out-of-credits memory -------------------------------------------------
// Kept in Redis so every instance agrees on what has been spent. Redis can be missing in
// local development, so there is also a memory fallback: a cap is still enforced, it just
// resets when the server restarts. Settings says so plainly, because the shared count is
// the only one that can hold a cap across Vercel's instances.
const outKey = (id) => `finder:out:${id}`;
const countKey = (id) => `finder:${id}:${month()}`;
const local = { counts: new Map(), out: new Map() };
async function store() { return await import("@/lib/store"); }
export async function storeBacked() { const { storeConfigured } = await store(); return Boolean(storeConfigured()); }
async function markOut(id, kind, note) {
  const { cacheSet } = await store();
  const ttl = kind === "credits" ? secondsLeftInMonth() : 4 * 3600;
  const row = { kind, note: String(note || "").slice(0, 200), until: new Date(Date.now() + ttl * 1000).toISOString() };
  local.out.set(id, row);
  await cacheSet(outKey(id), row, ttl);
}
async function isOut(id) {
  const { cacheGet } = await store();
  const shared = await cacheGet(outKey(id));
  if (shared) return shared;
  const mine = local.out.get(id);
  if (mine && Date.parse(mine.until) > Date.now()) return mine;
  if (mine) local.out.delete(id);
  return null;
}
async function spend(id, n = 1) {
  const k = `${countKey(id)}`;
  local.counts.set(k, (local.counts.get(k) || 0) + n);
  const { counterAdd } = await store();
  await counterAdd(countKey(id), n, 40 * 86400);
}
// What has been spent this month: the shared count, or this instance's own if there is no store.
async function spent(id) {
  const { counterGet } = await store();
  const shared = await counterGet(countKey(id));
  return Math.max(Number(shared) || 0, local.counts.get(countKey(id)) || 0);
}

// Can this provider be asked right now, for a call that could cost `cost` credits?
// Returns "" when it can, or the reason it cannot. The headroom check uses the worst case,
// so a 10-credit mobile lookup is refused with 9 credits left rather than going over.
async function blocked(id, cost = 0) {
  if (!finderConfigured(id)) return "no key";
  const out = await isOut(id);
  if (out) return out.kind === "credits" ? "out of credits" : out.kind === "auth" ? "key rejected" : "paused";
  const cap = capOf(id);
  if (cap > 0) {
    const used = await spent(id);
    const need = Math.max(1, cost || byId[id].maxCost || 1);
    if (used >= cap) return `monthly cap reached (${used} of ${cap})`;
    if (used + need > cap) return `only ${cap - used} of ${cap} ${byId[id].unit} left this month, and this would cost ${need}`;
  }
  return "";
}

// One place for every request, so every provider's failures are handled the same way.
async function ask(id, url, opts = {}) {
  let r;
  try { r = await fetch(url, { cache: "no-store", ...opts, headers: { accept: "application/json", ...(opts.headers || {}) } }); }
  catch (e) { throw fault("rate", `${byId[id].name} did not respond (${String(e?.message || e).slice(0, 60)})`); }
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    const kind = classify(r.status, text);
    const msg = j?.message || j?.error?.message || j?.errors?.[0]?.details || j?.error_code || `HTTP ${r.status}`;
    if (kind === "credits" || kind === "auth") await markOut(id, kind, msg);
    throw fault(kind, `${byId[id].name}: ${String(msg).slice(0, 120)}`);
  }
  // Some providers answer 200 with an error flag in the body.
  if (j && j.error === true) {
    const msg = j.message || j.error_code || "error";
    const kind = classify(200, msg);
    if (kind === "credits" || kind === "auth") await markOut(id, kind, msg);
    if (kind !== "other") throw fault(kind, `${byId[id].name}: ${String(msg).slice(0, 120)}`);
  }
  return j || {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Snov.io needs an OAuth token first (one hour, so it is cached) -------------------
async function snovToken() {
  const { cacheGet, cacheSet } = await store();
  const hit = await cacheGet("finder:snov:token");
  if (hit?.token) return hit.token;
  const j = await ask("snov", "https://api.snov.io/v1/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: keyOf("snov", 0), client_secret: keyOf("snov", 1) }),
  });
  if (!j.access_token) throw fault("auth", "Snov.io gave no access token");
  await cacheSet("finder:snov:token", { token: j.access_token }, 3000);
  return j.access_token;
}

// ---- per provider: one person -------------------------------------------------------
// Each returns { mobile, phone, email, title, cost } or null when there is no match.
const PERSON = {
  async prospeo({ first, last, host, company, linkedin, email }) {
    const data = { first_name: first, last_name: last };
    if (host) data.company_website = host;
    else if (company) data.company_name = company;
    if (linkedin) data.linkedin_url = linkedin;
    if (email) data.email = email;
    const j = await ask("prospeo", "https://api.prospeo.io/enrich-person", {
      method: "POST", headers: { "content-type": "application/json", "X-KEY": keyOf("prospeo") },
      body: JSON.stringify({ only_verified_email: false, enrich_mobile: true, data }),
    });
    const p = j.response || j.data || j.person || j;
    const mobile = tidyPhone(p?.mobile?.mobile || p?.mobile?.mobile_national || p?.mobile) || firstMobile(phonesIn(j));
    const mail = String(p?.email?.email || p?.email || emailsIn(j)[0] || "").toLowerCase();
    if (!mobile && !mail) return null;
    // Prospeo charges 10 credits for a mobile, 1 for an email only.
    return { mobile, phone: mobile || phonesIn(j)[0] || "", email: /@/.test(mail) ? mail : "", title: p?.current_job_title || p?.job_title || "", cost: mobile ? 10 : 1 };
  },
  async lusha({ first, last, host, company, email }) {
    const q = new URLSearchParams({ firstName: first, lastName: last });
    if (host) { q.set("companyDomain", host); q.set("companyDomains", host); }
    if (company) q.set("companyName", company);
    if (email) q.set("email", email);
    const j = await ask("lusha", `https://api.lusha.com/v2/person?${q}`, { headers: { api_key: keyOf("lusha") } });
    const d = j.data || j.contact?.data || j.contact || j;
    const nums = (d?.phoneNumbers || d?.phones || []).filter((p) => !p.doNotCall);
    const list = nums.map((p) => tidyPhone(p.number || p.internationalNumber || p)).filter(Boolean);
    const all = list.length ? list : phonesIn(j);
    const mobile = firstMobile(all);
    const mail = String((d?.emailAddresses || d?.emails || [])[0]?.email || emailsIn(j)[0] || "").toLowerCase();
    if (!mobile && !all.length && !mail) return null;
    return { mobile, phone: mobile || all[0] || "", email: /@/.test(mail) ? mail : "", title: d?.jobTitle || d?.title || "", cost: 1 };
  },
  async dropcontact({ first, last, host, company, email }) {
    const row = { first_name: first, last_name: last };
    if (host) row.website = host;
    if (company) row.company = company;
    if (email) row.email = email;
    const start = await ask("dropcontact", "https://api.dropcontact.com/v1/enrich/all", {
      method: "POST", headers: { "content-type": "application/json", "X-Access-Token": keyOf("dropcontact") },
      body: JSON.stringify({ data: [row], siren: false, language: "en" }),
    });
    const rid = start.request_id || start.requestId;
    if (!rid) return null;
    // Asynchronous: it is usually ready inside 15 seconds, which is all a page request can spare.
    for (const wait of [1500, 3000, 3000, 4000, 4000]) {
      await sleep(wait);
      const j = await ask("dropcontact", `https://api.dropcontact.com/v1/enrich/all/${encodeURIComponent(rid)}?forceResults=true`, { headers: { "X-Access-Token": keyOf("dropcontact") } });
      if (j.success === false || !j.data) continue;
      const d = Array.isArray(j.data) ? j.data[0] : j.data;
      const all = phonesIn(d || {});
      const mobile = tidyPhone(d?.mobile_phone || d?.mobile) || firstMobile(all);
      const mail = String(d?.email?.[0]?.email || d?.email || emailsIn(d || {})[0] || "").toLowerCase();
      if (!mobile && !all.length && !/@/.test(mail)) return null;
      return { mobile, phone: mobile || all[0] || "", email: /@/.test(mail) ? mail : "", title: d?.job || "", cost: 1 };
    }
    throw fault("rate", "Dropcontact is still working on it; try again in a minute");
  },
  async apollo({ first, last, host, company, linkedin, email }) {
    const body = { first_name: first, last_name: last };
    if (host) body.domain = host;
    if (company) body.organization_name = company;
    if (linkedin) body.linkedin_url = linkedin;
    if (email) body.email = email;
    const j = await ask("apollo", "https://api.apollo.io/api/v1/people/match", {
      method: "POST", headers: { "content-type": "application/json", "X-Api-Key": keyOf("apollo") },
      body: JSON.stringify(body),
    });
    const p = j.person || j.people?.[0];
    if (!p) return null;
    // Apollo only sends mobiles to a webhook, minutes later, so any number here is a switchboard.
    const all = [tidyPhone(p.organization?.primary_phone?.number), tidyPhone(p.organization?.phone), ...phonesIn(p)].filter(Boolean);
    const mail = String(p.email || emailsIn(p)[0] || "").toLowerCase();
    if (!all.length && !/@/.test(mail)) return null;
    return { mobile: firstMobile(all), phone: all[0] || "", email: /@/.test(mail) && !/email_not_unlocked/.test(mail) ? mail : "", title: p.title || "", cost: 1 };
  },
  async tomba({ first, last, host }) {
    if (!host) return null;
    const q = new URLSearchParams({ domain: host, first_name: first, last_name: last });
    const j = await ask("tomba", `https://api.tomba.io/v1/email-finder?${q}`, { headers: { "X-Tomba-Key": keyOf("tomba", 0), "X-Tomba-Secret": keyOf("tomba", 1) } });
    const d = j.data || j;
    const mail = String(d?.email || emailsIn(j)[0] || "").toLowerCase();
    const all = phonesIn(j);
    if (!/@/.test(mail) && !all.length) return null;
    return { mobile: firstMobile(all), phone: all[0] || "", email: /@/.test(mail) ? mail : "", title: d?.position || "", score: Number(d?.score) || 0, cost: 1 };
  },
  async getprospect({ first, last, host, company }) {
    const q = new URLSearchParams({ apiKey: keyOf("getprospect"), name: `${first} ${last}` });
    if (host) q.set("companyDomain", host); else if (company) q.set("company", company);
    const j = await ask("getprospect", `https://api.getprospect.com/public/v1/email/find?${q}`);
    const mail = String(j.email || j.data?.email || emailsIn(j)[0] || "").toLowerCase();
    if (!/@/.test(mail)) return null;
    return { mobile: "", phone: "", email: mail, title: j.position || "", score: /valid/i.test(j.emailStatus || j.status || "") ? 90 : 0, cost: 1 };
  },
  async hunter({ first, last, host }) {
    if (!host) return null;
    const q = new URLSearchParams({ domain: host, first_name: first, last_name: last, api_key: keyOf("hunter") });
    const j = await ask("hunter", `https://api.hunter.io/v2/email-finder?${q}`);
    const d = j.data || {};
    const all = phonesIn(j);
    if (!d.email && !all.length) return null;
    return { mobile: firstMobile(all), phone: all[0] || "", email: String(d.email || "").toLowerCase(), title: d.position || "", score: Number(d.score) || 0, cost: 1 };
  },
};

// ---- per provider: everyone at a domain ---------------------------------------------
// Each returns an array of { name, role, email, phone, mobile, score }.
const GENERIC_LOCAL = /^(info|information|hello|hi|enquiries|enquiry|contact|contactus|sales|office|mail|email|admin|shop|bookings|reception|support|accounts|team|help|general|service|orders|noreply|no-reply|webmaster|post|hr|jobs|careers)$/i;
const namedOnly = (list) => list.filter((p) => !GENERIC_LOCAL.test(String(p.email || "").split("@")[0]));
const DOMAIN = {
  async tomba({ host }) {
    const j = await ask("tomba", `https://api.tomba.io/v1/domain-search?${new URLSearchParams({ domain: host, limit: "10" })}`, { headers: { "X-Tomba-Key": keyOf("tomba", 0), "X-Tomba-Secret": keyOf("tomba", 1) } });
    const rows = j.data?.emails || j.emails || j.data || [];
    return namedOnly((Array.isArray(rows) ? rows : []).map((e) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(" ") || String(e.email || "").split("@")[0],
      role: e.position || e.department || "Staff", email: String(e.email || e.value || "").toLowerCase(),
      phone: tidyPhone(e.phone_number), mobile: isUkMobile(e.phone_number) ? tidyPhone(e.phone_number) : "",
      linkedin: e.linkedin || "", score: Number(e.score ?? e.confidence) || 0,
    })).filter((p) => p.email));
  },
  async hunter({ host }) {
    const j = await ask("hunter", `https://api.hunter.io/v2/domain-search?${new URLSearchParams({ domain: host, limit: "10", type: "personal", api_key: keyOf("hunter") })}`);
    return namedOnly((j.data?.emails || []).map((e) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(" ") || String(e.value || "").split("@")[0],
      role: e.position || e.department || "Staff", email: String(e.value || "").toLowerCase(),
      phone: tidyPhone(e.phone_number), mobile: isUkMobile(e.phone_number) ? tidyPhone(e.phone_number) : "",
      linkedin: e.linkedin || "", score: Number(e.confidence) || 0, organization: j.data?.organization || "",
    })).filter((p) => p.email));
  },
  async snov({ host }) {
    const token = await snovToken();
    const j = await ask("snov", `https://api.snov.io/v2/domain-emails-with-info?${new URLSearchParams({ domain: host, type: "personal", limit: "10" })}`, { headers: { Authorization: `Bearer ${token}` } });
    const rows = j.emails || j.data?.emails || j.data || [];
    return namedOnly((Array.isArray(rows) ? rows : []).map((e) => ({
      name: [e.firstName || e.first_name, e.lastName || e.last_name].filter(Boolean).join(" ") || String(e.email || "").split("@")[0],
      role: e.position || "Staff", email: String(e.email || "").toLowerCase(),
      phone: "", mobile: "", linkedin: e.sourcePage || "", score: /valid/i.test(e.status || e.smtpStatus || "") ? 90 : 0,
    })).filter((p) => p.email));
  },
  async getprospect({ host }) {
    const j = await ask("getprospect", `https://api.getprospect.com/public/v1/email/search?${new URLSearchParams({ apiKey: keyOf("getprospect"), companyDomain: host, limit: "10" })}`);
    const rows = j.emails || j.data || j.results || [];
    return namedOnly((Array.isArray(rows) ? rows : []).map((e) => ({
      name: [e.firstName || e.first_name, e.lastName || e.last_name].filter(Boolean).join(" ") || String(e.email || "").split("@")[0],
      role: e.position || "Staff", email: String(e.email || "").toLowerCase(),
      phone: "", mobile: "", linkedin: e.linkedinUrl || "", score: /valid/i.test(e.emailStatus || e.status || "") ? 90 : 0,
    })).filter((p) => p.email));
  },
  async apollo({ host }) {
    const j = await ask("apollo", "https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST", headers: { "content-type": "application/json", "X-Api-Key": keyOf("apollo") },
      body: JSON.stringify({ q_organization_domains: host, page: 1, per_page: 10, person_seniorities: ["owner", "founder", "c_suite", "partner", "director", "head"] }),
    });
    return (j.people || []).map((p) => ({
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "), role: p.title || "Staff",
      email: /@/.test(p.email || "") && !/not_unlocked/.test(p.email) ? String(p.email).toLowerCase() : "",
      phone: "", mobile: "", linkedin: p.linkedin_url || "", score: 0, first: p.first_name || "", last: p.last_name || "",
    })).filter((p) => p.name);
  },
};

// ---- no website on file: look the company up by name, which can also turn up the domain --
const BY_NAME = {
  async hunter({ company }) {
    const j = await ask("hunter", `https://api.hunter.io/v2/domain-search?${new URLSearchParams({ company: String(company).replace(/\s+(ltd|limited|llp|plc)\.?$/i, ""), limit: "10", type: "personal", api_key: keyOf("hunter") })}`);
    const d = j.data || {};
    const people = namedOnly((d.emails || []).map((e) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(" ") || String(e.value || "").split("@")[0],
      role: e.position || e.department || "Staff", email: String(e.value || "").toLowerCase(),
      phone: tidyPhone(e.phone_number), mobile: isUkMobile(e.phone_number) ? tidyPhone(e.phone_number) : "",
      linkedin: e.linkedin || "", score: Number(e.confidence) || 0, organization: d.organization || "",
    })).filter((p) => p.email));
    const domain = String(d.domain || "").toLowerCase().replace(/^www\./, "");
    return domain || people.length ? { domain, people, organization: d.organization || "" } : null;
  },
};

// ---- the company's main number, as a last resort ------------------------------------
const COMPANY = {
  async apollo({ host }) {
    const j = await ask("apollo", `https://api.apollo.io/api/v1/organizations/enrich?${new URLSearchParams({ domain: host })}`, { headers: { "X-Api-Key": keyOf("apollo") } });
    const o = j.organization || j;
    const all = [tidyPhone(o?.primary_phone?.number), tidyPhone(o?.phone), ...phonesIn(o || {})].filter(Boolean);
    return all.length ? { phone: all[0], mobile: firstMobile(all) } : null;
  },
};

// ---- is this address real -----------------------------------------------------------
const VERIFY = {
  async zerobounce({ email }) {
    const j = await ask("zerobounce", `https://api.zerobounce.net/v2/validate?${new URLSearchParams({ api_key: keyOf("zerobounce"), email })}`);
    return j.status ? { status: String(j.status).toLowerCase(), detail: j.sub_status || "" } : null;
  },
  async hunter({ email }) {
    const j = await ask("hunter", `https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email, api_key: keyOf("hunter") })}`);
    const d = j.data || {};
    return d.status ? { status: String(d.status).toLowerCase(), detail: `${d.score ?? ""}` } : null;
  },
  async bouncer({ email }) {
    const j = await ask("bouncer", `https://api.usebouncer.com/v1.1/email/verify?${new URLSearchParams({ email })}`, { headers: { "x-api-key": keyOf("bouncer") } });
    return j.status ? { status: String(j.status).toLowerCase(), detail: j.reason || "" } : null;
  },
  async abstract({ email }) {
    const j = await ask("abstract", `https://emailvalidation.abstractapi.com/v1/?${new URLSearchParams({ api_key: keyOf("abstract"), email })}`);
    const d = String(j.deliverability || "").toLowerCase();
    if (!d) return null;
    // Abstract says DELIVERABLE / UNDELIVERABLE / RISKY / UNKNOWN; say it the same way as the rest.
    return { status: d === "deliverable" ? "valid" : d === "undeliverable" ? "invalid" : d, detail: `quality ${j.quality_score ?? ""}` };
  },
  async mailboxlayer({ email }) {
    const j = await ask("mailboxlayer", `https://apilayer.net/api/check?${new URLSearchParams({ access_key: keyOf("mailboxlayer"), email, smtp: "1", format: "1" })}`);
    if (j.format_valid === undefined) return null;
    const ok = j.format_valid && j.smtp_check && !j.disposable;
    return { status: !j.format_valid ? "invalid" : j.smtp_check ? "valid" : j.smtp_check === false ? "invalid" : "unknown", detail: `score ${j.score ?? ""}${j.disposable ? ", disposable" : ""}${ok ? "" : ""}` };
  },
  async tomba({ email }) {
    const j = await ask("tomba", `https://api.tomba.io/v1/email-verifier/${encodeURIComponent(email)}`, { headers: { "X-Tomba-Key": keyOf("tomba", 0), "X-Tomba-Secret": keyOf("tomba", 1) } });
    const d = j.data?.email || j.data || {};
    return d.status || d.result ? { status: String(d.status || d.result).toLowerCase(), detail: `${d.score ?? ""}` } : null;
  },
};

// ---- the order they are tried in ----------------------------------------------------
// Mobiles first: Prospeo and Lusha are the only two that return one in a single request.
const ORDER = {
  person: ["prospeo", "lusha", "dropcontact", "apollo", "tomba", "hunter", "getprospect"],
  domain: ["tomba", "hunter", "snov", "getprospect", "apollo"],
  company: ["apollo"],
  byName: ["hunter"],
  verify: ["zerobounce", "bouncer", "abstract", "mailboxlayer", "hunter", "tomba"],
};

// Walk the list until one answers. `trail` is the plain-English record of what happened,
// which ends up on the lead card so Chris can see which finder found what.
// Answers are cached, so asking twice about the same person, domain or address costs nothing
// the second time. Pressing "Find the mobile" again on a lead you looked up last week is free.
const CACHE_DAYS = { person: 60, domain: 60, byName: 60, company: 90, verify: 90 };
const cacheKeyFor = (kind, args) => `finder:${kind}:${JSON.stringify(Object.fromEntries(Object.entries(args).filter(([, v]) => v).sort()))}`.toLowerCase().slice(0, 300);

async function failover(kind, table, args, { stopAt, deadline = 0, budget = null } = {}) {
  const trail = [];
  let best = null, from = "";
  const { cacheGet, cacheSet } = await store();
  const ck = cacheKeyFor(kind, args);
  const hit = await cacheGet(ck);
  if (hit) return { result: hit.result, from: hit.from, trail: [`${hit.from || "Looked up"} ${new Date(hit.at).toLocaleDateString("en-GB")}: from the cache, no credit spent`] };
  // Verification is the one step where every provider gives the same answer, so the order
  // is by credits left: the fullest account goes first and no single free tier drains.
  const list = kind === "verify" ? await byHeadroom(ORDER[kind]) : ORDER[kind];
  for (const id of list) {
    // A page request only has about 50 seconds. Stop asking once the budget is gone.
    if (deadline && Date.now() > deadline) { trail.push("Stopped: the lookup was taking too long"); break; }
    const need = byId[id].maxCost || 1;
    // One lead is never allowed to burn a month's credits, however many finders are connected.
    if (budget && budget.left < need) { trail.push(`Stopped: this lead has used its ${budget.cap} credits`); break; }
    const why = await blocked(id, need);
    if (why) { if (why !== "no key") trail.push(`${byId[id].name}: ${why}`); continue; }
    try {
      const r = await table[id](args);
      const cost = Array.isArray(r) ? 1 : r?.cost || 1;
      if (!r || (Array.isArray(r) && !r.length)) { trail.push(`${byId[id].name}: nothing on file`); await spend(id, 1); if (budget) { budget.left -= 1; budget.spent += 1; } continue; }
      await spend(id, cost);
      if (budget) { budget.left -= cost; budget.spent += cost; }
      if (!best) { best = r; from = byId[id].name; }
      else if (stopAt && !stopAt(best) && stopAt(r)) { best = r; from = byId[id].name; }
      if (stopAt ? stopAt(r) : true) { trail.push(`${byId[id].name}: ${stopAt && stopAt(r) ? "mobile found" : "found"}`); break; }
      trail.push(`${byId[id].name}: found, but no mobile`);
    } catch (e) {
      trail.push(String(e?.message || e));
      // A provider that charges for a failed match is assumed to have charged.
      if (e?.kind === "other") { await spend(id, 1); if (budget) { budget.left -= 1; budget.spent += 1; } }
      if (e?.kind === "rate") break; // a timeout now means the whole lookup is running long
    }
  }
  // Only a real answer is worth remembering. "Nobody had anything" is worth asking again later,
  // once the databases have moved on.
  if (best) await cacheSet(ck, { result: best, from, at: new Date().toISOString() }, (CACHE_DAYS[kind] || 60) * 86400);
  return { result: best, from, trail };
}

// Most credits left first. A provider with no cap counts as the fullest of all.
async function byHeadroom(ids) {
  const rows = [];
  for (const id of ids) {
    if (!finderConfigured(id)) continue;
    const cap = capOf(id);
    rows.push({ id, left: cap === 0 ? Number.MAX_SAFE_INTEGER : cap - (await spent(id)) });
  }
  rows.sort((a, b) => b.left - a.left);
  return rows.map((r) => r.id);
}

// One lead's credit allowance, shared by every lookup made for it.
export const newBudget = (n = LOOKUP_BUDGET) => ({ left: n, spent: 0, cap: n });

// ---- what the rest of the app calls -------------------------------------------------

// One named person: their mobile first, then a landline, then an email address.
export async function enrichPerson({ name, first, last, host, company, linkedin, email, deadline = 0, budget = null }) {
  const parts = String(name || "").replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/i, "").trim().split(/\s+/);
  const f = first || parts[0] || "", l = last || (parts.length > 1 ? parts[parts.length - 1] : "");
  if (!f || !l || (!host && !company && !linkedin && !email)) return { trail: [], people: [] };
  const { result, from, trail } = await failover("person", PERSON, { first: f, last: l, host, company, linkedin, email }, { stopAt: (r) => Boolean(r.mobile), deadline, budget });
  if (!result) return { trail, found: null };
  return { trail, found: { ...result, name: name || `${f} ${l}`, from } };
}

// Everyone a finder knows at this domain, named people only (info@ is on their site for free).
export async function searchDomain({ host, company, deadline = 0, budget = null }) {
  if (!host) return { trail: [], people: [] };
  const { result, from, trail } = await failover("domain", DOMAIN, { host, company }, { stopAt: (r) => Array.isArray(r) && r.length > 0, deadline, budget });
  return { trail, people: result || [], from };
}

// No website on file: ask by company name. The domain that comes back needs checking by hand.
export async function searchByName({ company, deadline = 0, budget = null }) {
  if (!company) return { trail: [] };
  const { result, from, trail } = await failover("byName", BY_NAME, { company }, { deadline, budget });
  return { trail, found: result ? { ...result, from } : null };
}

// The switchboard number, only when nothing better exists.
export async function companyPhone({ host, deadline = 0, budget = null }) {
  if (!host) return { trail: [] };
  const { result, from, trail } = await failover("company", COMPANY, { host }, { deadline, budget });
  return { trail, found: result ? { ...result, from } : null };
}

// Is this address worth sending to? Only run on an address no one has verified yet.
export async function verifyEmail(email, deadline = 0, budget = null) {
  if (!/@/.test(String(email || ""))) return { trail: [] };
  const { result, from, trail } = await failover("verify", VERIFY, { email: String(email).toLowerCase() }, { deadline, budget });
  return { trail, status: result?.status || "", from };
}

// ---- Settings: what is connected, what has been spent, what is parked ----------------
export async function finderStatus() {
  const out = [];
  for (const f of FINDERS) {
    const configured = finderConfigured(f.id);
    const o = configured ? await isOut(f.id) : null;
    out.push({ id: f.id, name: f.name, kinds: f.kinds, unit: f.unit, plan: f.plan, free: f.free, cost: f.cost, maxCost: f.maxCost, help: f.help, signup: f.signup, env: f.env, mobiles: !!f.mobiles,
      configured, used: configured ? await spent(f.id) : 0, cap: capOf(f.id), out: o ? { kind: o.kind, note: o.note, until: o.until } : null });
  }
  return out;
}
// One line for the lead board: how many finders are live and how much is left in the pot.
export async function finderSummary() {
  const rows = (await finderStatus()).filter((r) => r.configured);
  const live = rows.filter((r) => !r.out && (r.cap === 0 || r.used < r.cap));
  const left = rows.reduce((n, r) => n + (r.cap > 0 ? Math.max(0, r.cap - r.used) : 0), 0);
  return { connected: rows.length, live: live.length, left, unlimited: rows.some((r) => r.cap === 0), mobiles: live.some((r) => r.mobiles), budget: LOOKUP_BUDGET, shared: await storeBacked(), rows };
}

// Settings "Test" button: a free account endpoint where the provider has one.
export async function testFinder(id) {
  if (!byId[id]) return { ok: false, detail: "Unknown finder." };
  if (!finderConfigured(id)) return { ok: false, detail: `Set ${byId[id].env.join(" and ")} in Vercel, then redeploy.` };
  try {
    if (id === "hunter") { const j = await ask(id, `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(keyOf(id))}`); const d = j.data || {}; return { ok: true, detail: `${d.email || "connected"}${d.requests?.searches ? ` · ${d.requests.searches.used} of ${d.requests.searches.available} searches used` : ""}` }; }
    if (id === "tomba") { const j = await ask(id, "https://api.tomba.io/v1/me", { headers: { "X-Tomba-Key": keyOf(id, 0), "X-Tomba-Secret": keyOf(id, 1) } }); const d = j.data || {}; return { ok: true, detail: d.user?.email || d.email || "connected" }; }
    if (id === "zerobounce") { const j = await ask(id, `https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(keyOf(id))}`); const c = Number(j.Credits ?? j.credits); if (c === -1) { await markOut(id, "auth", "key rejected"); return { ok: false, detail: "ZeroBounce says the key is invalid." } } return { ok: true, detail: `${c} verification credits left` }; }
    if (id === "prospeo") { const j = await ask(id, "https://api.prospeo.io/account-information", { method: "POST", headers: { "content-type": "application/json", "X-KEY": keyOf(id) }, body: "{}" }); const n = j.response?.remaining_credits ?? j.remaining_credits; return { ok: true, detail: n === undefined ? "connected" : `${n} credits left` }; }
    if (id === "apollo") { await ask(id, "https://api.apollo.io/api/v1/auth/health", { headers: { "X-Api-Key": keyOf(id) } }); return { ok: true, detail: "connected" }; }
    if (id === "snov") { await snovToken(); return { ok: true, detail: "connected (token issued)" }; }
    if (id === "bouncer") { const j = await ask(id, "https://api.usebouncer.com/v1.1/credits", { headers: { "x-api-key": keyOf(id) } }); const n = j.credits ?? j.available; return { ok: true, detail: n === undefined ? "connected" : `${n} verifications left` }; }
    if (id === "mailboxlayer") { const j = await ask(id, `https://apilayer.net/api/check?${new URLSearchParams({ access_key: keyOf(id), email: "support@apilayer.com" })}`); return { ok: j.format_valid !== undefined, detail: j.format_valid !== undefined ? "connected (test address checked, 1 credit)" : "MailboxLayer gave an answer this app did not understand" }; }
    if (id === "abstract") { const j = await ask(id, `https://emailvalidation.abstractapi.com/v1/?${new URLSearchParams({ api_key: keyOf(id), email: "support@abstractapi.com" })}`); return { ok: Boolean(j.deliverability), detail: j.deliverability ? "connected (test address checked, 1 credit)" : "Abstract gave an answer this app did not understand" }; }
    if (id === "lusha") { try { const j = await ask(id, "https://api.lusha.com/account/usage", { headers: { api_key: keyOf(id) } }); return { ok: true, detail: j?.credits ? `${j.credits} credits` : "connected" }; } catch (e) { if (e?.kind === "auth") throw e; return { ok: true, detail: "key is set; Lusha has no free check, so it proves itself on the first lookup" }; } }
    return { ok: true, detail: "key is set; this one has no free check, so it proves itself on the first lookup" };
  } catch (e) { return { ok: false, detail: String(e?.message || e) }; }
}
// Settings: clear the "out of credits" mark by hand (after topping up a plan).
export async function resetFinder(id) {
  if (!byId[id]) return false;
  const { cacheSet } = await store();
  await cacheSet(outKey(id), null, 1);
  return true;
}
