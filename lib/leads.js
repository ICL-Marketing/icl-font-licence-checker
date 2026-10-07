/**
 * Website leads: local companies whose website is letting them down.
 *
 * Finds active companies through Companies House (free API key), works out
 * their website, checks it for the problems that make a good lead (no site,
 * parked domain, dead site, broken SSL, stale copyright, dated template),
 * reads net assets from their latest filed accounts, scores the likelihood
 * and drafts the outreach email in the house style.
 *
 * Browser-driven in short steps like the other scans:
 *   leadsSearch({ areas, sics, page })   candidates from Companies House
 *   leadsEnrich(company)                 website, problems, accounts, email, draft
 */

import * as cheerio from "cheerio";
import tls from "node:tls";
import dns from "node:dns/promises";
import { detectPlatform } from "@/lib/scanner";

const CH = process.env.CH_API_BASE || "https://api.company-information.service.gov.uk";
const CH_DOCS = process.env.CH_DOCS_BASE || "https://document-api.company-information.service.gov.uk";
const KEY = () => process.env.COMPANIES_HOUSE_API_KEY || process.env.CH_API_KEY || "";
export const leadsConfigured = () => Boolean(KEY());

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 9000;

// ---- presets ----------------------------------------------------------------

// Richmond borough and its neighbours; the Companies House "location" filter
// matches words in the registered office address, so towns work better than postcodes.
export const AREA_PRESETS = {
  richmond: { label: "Richmond borough", places: ["Twickenham", "Hampton", "Hampton Hill", "Hampton Wick", "Teddington", "Richmond", "East Sheen", "Mortlake", "Barnes", "Kew", "St Margarets", "Whitton", "Strawberry Hill", "Ham", "Petersham"] },
  kingston: { label: "Kingston & Surbiton", places: ["Kingston upon Thames", "Surbiton", "New Malden", "Chessington", "Tolworth"] },
  hounslow: { label: "Hounslow & Chiswick", places: ["Hounslow", "Chiswick", "Isleworth", "Brentford", "Feltham"] },
  wandsworth: { label: "Wandsworth & Putney", places: ["Putney", "Wandsworth", "Wimbledon", "Southfields", "Earlsfield"] },
};

// SIC code groups that tend to be local, customer-facing businesses with a budget.
export const SECTOR_PRESETS = {
  retail: { label: "Shops & retail", sics: ["47110", "47190", "47210", "47220", "47230", "47240", "47250", "47260", "47290", "47410", "47510", "47520", "47530", "47540", "47590", "47610", "47620", "47640", "47650", "47710", "47721", "47722", "47730", "47750", "47760", "47770", "47781", "47782", "47789", "47990"] },
  hospitality: { label: "Cafés, pubs & restaurants", sics: ["56101", "56102", "56103", "56210", "56290", "56301", "56302", "55100", "55209"] },
  trades: { label: "Trades & home services", sics: ["41202", "43210", "43220", "43290", "43310", "43320", "43330", "43341", "43342", "43390", "43910", "43990", "81210", "81221", "81222", "81223", "81299", "81300", "95110", "95120", "95210", "95220", "95230", "95240", "95250", "95290", "45200", "45320", "45111", "45112"] },
  professional: { label: "Professional services", sics: ["69101", "69102", "69109", "69201", "69202", "69203", "70221", "70229", "71111", "71112", "71121", "71129", "71200", "66220", "66190", "68310", "68320", "73110", "73120", "74100", "74201", "74202", "74209", "74300", "74909", "78109", "78200", "82990"] },
  health: { label: "Health, beauty & wellbeing", sics: ["86210", "86220", "86230", "86900", "96020", "96040", "96090", "93130", "93110", "93120", "93191", "93199", "75000"] },
  education: { label: "Education, nurseries & leisure", sics: ["85100", "85200", "85310", "85320", "85410", "85421", "85422", "85510", "85520", "85530", "85590", "85600", "88910", "90010", "90020", "90030", "90040", "91020", "93210", "93290"] },
  makers: { label: "Makers, food & drink producers", sics: ["10710", "10720", "11050", "11010", "11020", "10850", "13300", "14190", "16290", "18129", "23410", "25620", "31010", "31020", "31090", "32120", "32990"] },
};

// Companies that are never leads: holding, property, dormant, finance shells.
const SKIP_SIC = /^(64|65|66110|66120|66300|68100|68209|68201|99999|98000|70100|74990)/;

// ---- Companies House ---------------------------------------------------------

async function ch(path, { base = CH, accept = "application/json" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${base}${path}`, { headers: { authorization: "Basic " + Buffer.from(`${KEY()}:`).toString("base64"), accept }, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
    if (r.status === 401) throw new Error("Companies House rejected the API key. Check COMPANIES_HOUSE_API_KEY in Vercel.");
    if (r.status === 429) throw new Error("Companies House rate limit reached (600 requests per 5 minutes). Wait a few minutes and press Find leads again.");
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Companies House error ${r.status}`);
    return accept === "application/json" ? r.json() : r.text();
  } finally { clearTimeout(t); }
}

// One page of candidates for a place + list of SIC codes.
export async function leadsSearch({ place, sics, startIndex = 0, size = 100 }) {
  const q = new URLSearchParams({ company_status: "active", location: place, size: String(size), start_index: String(startIndex) });
  for (const s of (sics || []).slice(0, 50)) q.append("sic_codes", s);
  const j = await ch(`/advanced-search/companies?${q.toString()}`);
  const items = (j?.items || []).map((c) => ({
    companyNumber: c.company_number, name: c.company_name, status: c.company_status, type: c.company_type,
    incorporated: c.date_of_creation || "", sics: c.sic_codes || [],
    address: [c.registered_office_address?.address_line_1, c.registered_office_address?.address_line_2, c.registered_office_address?.locality, c.registered_office_address?.postal_code].filter(Boolean).join(", "),
    postcode: c.registered_office_address?.postal_code || "", locality: c.registered_office_address?.locality || "",
  }));
  return { items, total: j?.hits || j?.total_results || items.length };
}

// Rough first filter: active trading companies old enough to have accounts and not holding/property shells.
export function worthEnriching(c, { minAgeYears = 2 } = {}) {
  if (c.status !== "active") return false;
  if (!["ltd", "private-limited-guarant-nsc", "llp", "plc"].includes(c.type)) return false;
  if ((c.sics || []).every((s) => SKIP_SIC.test(s))) return false;
  const years = c.incorporated ? (Date.now() - new Date(c.incorporated).getTime()) / 31557600000 : 0;
  if (years < minAgeYears) return false;
  if (/\b(holdings?|investments?|properties|property|estates|capital|ventures|nominees?|trustees?)\b/i.test(c.name)) return false;
  return true;
}

// Net assets and retained-earnings movement from the latest iXBRL accounts.
async function accountsFacts(companyNumber) {
  const out = { netAssets: null, netAssetsPrev: null, reChange: null, accountsDate: "", accountsType: "", employees: null, caveat: "" };
  const profile = await ch(`/company/${companyNumber}`);
  out.accountsDate = profile?.accounts?.last_accounts?.made_up_to || "";
  out.accountsType = profile?.accounts?.last_accounts?.type || "";
  if (profile?.accounts?.last_accounts?.type === "dormant") { out.caveat = "Filed as dormant"; return out; }
  const fh = await ch(`/company/${companyNumber}/filing-history?category=accounts&items_per_page=5`);
  const acc = (fh?.items || []).find((f) => f.links?.document_metadata && /^AA$/.test(f.type || ""));
  if (!acc) return out;
  const docId = acc.links.document_metadata.split("/").pop();
  let xhtml = "";
  try { xhtml = await ch(`/document/${docId}/content`, { base: CH_DOCS, accept: "application/xhtml+xml" }); } catch { return out; }
  if (!xhtml || typeof xhtml !== "string" || !/ix:nonFraction/i.test(xhtml)) { out.caveat = "Accounts not machine-readable (PDF)"; return out; }
  const $ = cheerio.load(xhtml, { xmlMode: true });
  // Contexts: id -> instant date, so "current" is the latest instant.
  const ctxDate = {};
  $("xbrli\\:context, context").each((_, el) => {
    const id = $(el).attr("id");
    const d = $(el).find("xbrli\\:instant, instant").first().text().trim() || $(el).find("xbrli\\:endDate, endDate").first().text().trim();
    if (id && d) ctxDate[id] = d;
  });
  const num = (el) => {
    const t = $(el).text().replace(/[^\d.\-]/g, "");
    let v = Number(t); if (!Number.isFinite(v)) return null;
    const scale = Number($(el).attr("scale") || 0); if (scale) v *= 10 ** scale;
    if ($(el).attr("sign") === "-") v = -v;
    return Math.round(v);
  };
  const byName = (re) => {
    const rows = [];
    $("ix\\:nonFraction, nonFraction").each((_, el) => { const n = $(el).attr("name") || ""; if (re.test(n)) { const d = ctxDate[$(el).attr("contextRef")] || ""; const v = num(el); if (v !== null && d) rows.push({ d, v }); } });
    rows.sort((a, b) => b.d.localeCompare(a.d));
    return rows;
  };
  const na = byName(/NetAssetsLiabilities(IncludingPensionAssetLiability)?$|^(uk-core|core):Equity$/i);
  if (na.length) { out.netAssets = na[0].v; const prev = na.find((r) => r.d < na[0].d); if (prev) out.netAssetsPrev = prev.v; }
  const re = byName(/RetainedEarningsAccumulatedLosses$/i);
  if (re.length >= 2) { const prev = re.find((r) => r.d < re[0].d); if (prev) out.reChange = re[0].v - prev.v; }
  else if (out.netAssets !== null && out.netAssetsPrev !== null) out.reChange = out.netAssets - out.netAssetsPrev;
  const emp = byName(/AverageNumberEmployeesDuringPeriod$/i);
  if (emp.length) out.employees = emp[0].v;
  return out;
}

// ---- website ----------------------------------------------------------------

async function get(url, { maxBytes = 1_500_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" }, redirect: "follow", signal: ctrl.signal, cache: "no-store" });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, url: r.url || url, type: r.headers.get("content-type") || "", html: buf.subarray(0, maxBytes).toString("utf8"), ms: Date.now() - started };
  } catch (e) {
    return { status: 0, url, error: e?.cause?.code || e?.name || String(e?.message || e), html: "", ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

const STOP = new Set(["ltd", "limited", "llp", "plc", "the", "and", "of", "co", "company", "uk", "london", "group", "services", "service"]);
const words = (name) => String(name).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

// Candidate domains from the company name: "Twickenham Fine Ales Ltd" ->
// twickenhamfineales, twickenham-fine-ales, tfa… across .co.uk and .com.
function candidateDomains(name, locality) {
  const w = words(name);
  if (!w.length) return [];
  const bases = new Set([w.join(""), w.join("-")]);
  if (w.length > 2) { bases.add(w.slice(0, 2).join("")); bases.add(w.slice(0, 2).join("-")); bases.add(w.map((x) => x[0]).join("")); }
  if (w.length === 2) bases.add(w[0]);
  const loc = words(locality || "").join("");
  if (loc && !w.join("").includes(loc)) { bases.add(w.join("") + loc); bases.add(w.join("-") + "-" + loc); }
  const out = [];
  for (const b of bases) if (b.length >= 4) for (const tld of [".co.uk", ".com", ".uk", ".org.uk", ".london"]) out.push(b + tld);
  return out.slice(0, 18);
}

// Does this page belong to the company? Name words in the title/body, or its postcode.
function looksLikeTheirs(html, name, postcode, locality) {
  const low = html.toLowerCase().replace(/\s+/g, " ");
  if (postcode && low.includes(postcode.toLowerCase().replace(/\s+/g, " "))) return true;
  const w = words(name).filter((x) => x.length > 2);
  if (!w.length) return false;
  const hits = w.filter((x) => low.includes(x)).length;
  const title = (low.match(/<title[^>]*>([^<]*)/) || [])[1] || "";
  // One- or two-word names ("Stein's", "Acme Ltd") match far too easily, so they need the
  // name in the <title> or the town on the page as well.
  if (w.length <= 2) return hits === w.length && (w.every((x) => title.includes(x)) || (locality && low.includes(String(locality).toLowerCase())));
  return hits >= Math.ceil(w.length * 0.6);
}

const PARKED_RE = /domain (is|name is|may be) for sale|buy this domain|this domain (is|has been) (parked|registered)|parked (free|domain)|sedoparking|parkingcrew|hugedomains|dan\.com|afternic|godaddy\.com\/domainsearch|domain parking|website coming soon|under construction|this site is (currently )?under|is coming soon|namecheap parking|dnparking|bodis\.com|parklogic|ionos\.co\.uk\/.*parking|default web site page|welcome to nginx|apache2 (debian|ubuntu) default|index of \//i;
const MAINT_RE = /maintenance mode|briefly unavailable for scheduled maintenance|we('|’)ll be back (soon|shortly)|site is (temporarily )?(down|unavailable)|be right back/i;
const FREE_TEMPLATES = [
  ["Free Square Online template", /squareup\.com\/|square-online|cdn\.weebly\.com|weeblycloud/i],
  ["Free Wix site (wixsite.com)", /\.wixsite\.com/i],
  ["it'seeze subscription template", /itseeze|it'seeze/i],
  ["GoDaddy Website Builder", /godaddy.*websitebuilder|img1\.wsimg\.com|secureserver\.net/i],
  ["Yell / hibu template", /yell\.com\/|hibu|yellbusiness/i],
  ["1&1 IONOS MyWebsite", /mywebsite-editor|ionos.*(my ?website|sitebuilder)/i],
  ["Free Google Sites page", /sites\.google\.com/i],
  ["Facebook page instead of a site", /facebook\.com\/[^"'\s]+$/i],
  ["Weebly template", /weebly\.com/i],
  ["Jimdo template", /jimdo/i],
  ["Webnode template", /webnode/i],
  ["Strikingly template", /strikingly/i],
];

async function tlsCheck(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = s.getPeerCertificate();
      const valid = s.authorized;
      const exp = cert?.valid_to ? new Date(cert.valid_to) : null;
      s.end();
      resolve({ ok: valid, error: s.authorizationError ? String(s.authorizationError) : "", expires: exp ? exp.toISOString().slice(0, 10) : "", expired: exp ? exp < new Date() : false, hostMismatch: /ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(String(s.authorizationError || "")) });
    });
    s.on("error", (e) => resolve({ ok: false, error: e?.code || String(e?.message || e) }));
    s.on("timeout", () => { s.destroy(); resolve({ ok: false, error: "timeout" }); });
  });
}

// Check one website. Returns { problem, detail, platform, year, pages, title, siteOk }.
export async function checkWebsite(domain) {
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const https = await get(`https://${host}/`);
  let r = https;
  const t = await tlsCheck(host);
  if (https.status === 0 && /CERT|SSL|TLS|altname|self.signed|certificate/i.test(https.error || "")) {
    const http = await get(`http://${host}/`);
    r = http;
    if (http.status > 0 && http.status < 400) return { problem: "Broken SSL", detail: `HTTPS fails (${t.error || https.error}); the site only works over http://. Browsers show "Not secure".`, ...facts(http), siteUrl: `http://${host}/`, siteOk: false };
  }
  if (r.status === 0) {
    const http = await get(`http://${host}/`);
    if (http.status === 0) return { problem: "Dead/broken site", detail: `No response from the site (${http.error || r.error}). Domain may have lapsed.`, siteOk: false };
    r = http;
  }
  const f = facts(r);
  if (r.status >= 500) return { problem: "Dead/broken site", detail: `Server error ${r.status} on the homepage.`, ...f, siteOk: false };
  if (r.status === 404 || r.status === 410) return { problem: "Dead/broken site", detail: `Homepage returns ${r.status}.`, ...f, siteOk: false };
  if (r.status === 401 || r.status === 403) return { problem: "Dead/broken site", detail: `Homepage blocked (${r.status}); visitors may see an error.`, ...f, siteOk: false, caveat: "Check by hand; may be a bot block rather than a real fault" };
  const html = r.html || "";
  if (!html.trim() || html.length < 300) return { problem: "Dead/broken site", detail: "Homepage is empty.", ...f, siteOk: false };
  if (MAINT_RE.test(html)) return { problem: "Dead/broken site", detail: "Stuck in maintenance mode.", ...f, siteOk: false };
  if (PARKED_RE.test(html) || PARKED_RE.test(f.title || "")) return { problem: "Parked domain", detail: "Domain shows a parking or placeholder page; there is no site.", ...f, siteOk: false };
  const finalHost = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return host; } })();
  if (finalHost !== host.replace(/^www\./, "") && !finalHost.endsWith(host.replace(/^www\./, ""))) {
    if (/facebook\.com|instagram\.com|linkedin\.com/.test(finalHost)) return { problem: "No website", detail: `Domain just redirects to ${finalHost}.`, ...f, siteOk: false };
    return { problem: "", detail: `Redirects to ${finalHost}.`, ...f, siteOk: true, redirectsTo: finalHost };
  }
  if (t.ok === false && t.expired) return { problem: "Broken SSL", detail: `SSL certificate expired on ${t.expires}.`, ...f, siteOk: false };
  if (t.ok === false && t.error && https.status > 0) return { problem: "Broken SSL", detail: `Certificate problem (${t.error}).`, ...f, siteOk: false, caveat: "Browser may still load it; verify" };
  for (const [label, re] of FREE_TEMPLATES) if (re.test(html)) return { problem: "Dated template", detail: label + (f.year ? `, © ${f.year}` : ""), ...f, siteOk: false };
  const thisYear = new Date().getFullYear();
  if (f.year && f.year <= thisYear - 3) return { problem: "Stale copyright", detail: `© ${f.year} — ${thisYear - f.year} yrs old${f.platform ? ` (${f.platform})` : ""}`, ...f, siteOk: false };
  if (!f.viewport) return { problem: "Dated template", detail: "Not mobile-friendly (no viewport tag)" + (f.platform ? `, ${f.platform}` : "") + (f.tables ? ", table-based layout" : ""), ...f, siteOk: false };
  if (f.tables && !f.platform) return { problem: "Dated template", detail: "Hand-coded, table-based layout from the 2000s", ...f, siteOk: false };
  if (f.flash) return { problem: "Dated template", detail: "Still references Flash", ...f, siteOk: false };
  return { problem: "", detail: "Site is current", ...f, siteOk: true };
}

function facts(r) {
  const html = r.html || "";
  let $; try { $ = cheerio.load(html); } catch { $ = null; }
  const title = $ ? $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const text = $ ? $("body").text().replace(/\s+/g, " ") : html;
  const years = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})\b/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= 2100);
  const generator = $ ? ($('meta[name="generator"]').attr("content") || "") : "";
  return {
    title, year: years.length ? Math.max(...years) : 0, platform: detectPlatform(html) || generator.replace(/\s[\d.]+.*$/, "").slice(0, 40),
    viewport: $ ? !!$('meta[name="viewport"]').length : /name="viewport"/i.test(html),
    tables: $ ? $("table").length > 3 && $("div").length < 20 : false,
    flash: /\.swf\b|shockwave-flash/i.test(html),
    finalUrl: r.url, status: r.status, siteUrl: r.url,
  };
}

// Find the website: likely domains from the name, DNS first (fast), then fetch
// the ones that exist in parallel and keep the best match.
export async function findWebsite(company) {
  const cands = candidateDomains(company.name, company.locality);
  const live = (await Promise.all(cands.map(async (d) => { try { await dns.lookup(d); return d; } catch { return ""; } }))).filter(Boolean);
  const checked = await Promise.all(live.slice(0, 8).map(async (d) => {
    const r = await get(`https://${d}/`);
    let html = r.html;
    if (r.status === 0 && /CERT|SSL|TLS|certificate|altname/i.test(r.error || "")) { const h = await get(`http://${d}/`); html = h.html; if (h.status === 0) return null; }
    else if (r.status === 0 || r.status >= 500) return null;
    if (PARKED_RE.test(html)) return { domain: d, parked: true, score: 1 };
    const w = words(company.name).filter((x) => x.length > 2);
    const low = html.toLowerCase();
    const hits = w.filter((x) => low.includes(x)).length;
    return looksLikeTheirs(html, company.name, company.postcode, company.locality) ? { domain: d, score: 10 + hits } : null;
  }));
  const best = checked.filter(Boolean).sort((a, b) => b.score - a.score)[0];
  return best ? { ...best, tried: cands } : { domain: "", tried: cands };
}

// Contact email on the site: mailto links first, then addresses on the same domain.
export async function findEmail(domain, homeHtml) {
  const host = domain.replace(/^www\./, "");
  const pick = (html) => {
    const found = new Set();
    for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
    for (const m of html.matchAll(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi)) found.add(m[1].toLowerCase());
    const list = [...found].filter((e) => !/\.(png|jpg|gif|svg|webp)$|sentry|wixpress|example\.com|yourdomain|email@|name@|user@/i.test(e));
    const own = list.filter((e) => e.endsWith("@" + host) || e.endsWith("." + host));
    const pref = (arr) => arr.find((e) => /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception)@/.test(e)) || arr[0] || "";
    return pref(own) || pref(list);
  };
  let e = pick(homeHtml || "");
  if (e) return e;
  for (const path of ["/contact", "/contact-us", "/contact/", "/contact-us/", "/about", "/about-us/"]) {
    const r = await get(`https://${host}${path}`);
    if (r.status === 200 && r.html) { e = pick(r.html); if (e) return e; }
  }
  return "";
}

// ---- decision-maker contacts -------------------------------------------------------
//
// Who actually decides: directors and owners from Companies House (always
// available, always the decision makers in a small company), named people with
// roles from the website's about/team/contact pages, plus the emails and phone
// numbers those pages give. Every contact is labelled with where it came from
// and what it is for, and guessed emails are marked as unverified.

const ROLE_RE = /\b(managing director|marketing (manager|director|lead|head)|head of marketing|operations? (manager|director)|general manager|practice manager|office manager|business (owner|manager)|sales (manager|director)|commercial director|creative director|brand manager|digital (manager|lead)|co-?founder|founder|owner|proprietor|director|partner|principal|ceo|coo|cmo|md|chairman|chairwoman|chair|manager)\b/i;
const NAME_RE = /^(?:(?:Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s)?[A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+){1,2}$/;
const TITLE_RE = /^(mr|mrs|ms|miss|dr|prof|sir|dame|lady|lord)\.?\s+/i;
// "SMITH, Jane Louise" or "Mrs Jane Louise Smith" -> "Jane Smith" (first name + surname, titles and middle names dropped).
const chName = (n) => {
  const raw = String(n || "").trim();
  if (raw.includes(",")) { const [sur, fore] = raw.split(","); const f = (fore || "").trim().replace(TITLE_RE, "").split(/\s+/).filter(Boolean); return `${cap(f[0] || "")} ${cap(sur.trim())}`.trim(); }
  const parts = raw.replace(TITLE_RE, "").split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${cap(parts[0])} ${cap(parts[parts.length - 1])}` : cap(raw);
};
const cap = (w) => String(w).toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, p, c) => p + c.toUpperCase());

async function companyPeople(companyNumber) {
  const out = [];
  const [off, psc] = await Promise.all([ch(`/company/${companyNumber}/officers?items_per_page=25`).catch(() => null), ch(`/company/${companyNumber}/persons-with-significant-control?items_per_page=10`).catch(() => null)]);
  for (const o of off?.items || []) {
    if (o.resigned_on || !/director|member|llp-designated-member|llp-member/i.test(o.officer_role || "")) continue;
    if (/corporate/i.test(o.officer_role || "")) continue;
    out.push({ name: chName(o.name), role: o.officer_role === "director" ? "Director" : cap(String(o.officer_role).replace(/-/g, " ")), source: "Companies House", why: `Active ${o.officer_role.replace(/-/g, " ")}${o.appointed_on ? ` since ${o.appointed_on.slice(0, 4)}` : ""}; signs off spending`, occupation: o.occupation || "", appointed: o.appointed_on || "" });
  }
  for (const p of psc?.items || []) {
    if (p.ceased_on || !p.name || /corporate|legal-person/i.test(p.kind || "")) continue;
    const name = chName(p.name);
    const share = (p.natures_of_control || []).find((n) => /ownership-of-shares/.test(n)) || "";
    const pct = share.replace(/ownership-of-shares-/, "").replace(/-percent/, "%").replace(/-to-/, "–").replace(/-or-more/, "+");
    const existing = out.find((c) => c.name.toLowerCase().split(" ").pop() === name.toLowerCase().split(" ").pop() && c.name[0] === name[0]);
    if (existing) { existing.role = `${existing.role} & owner`; existing.why += `; owns ${pct || "a controlling"} share`; }
    else out.push({ name, role: "Owner", source: "Companies House", why: `Person with significant control${pct ? ` (${pct} of shares)` : ""}` });
  }
  return out.slice(0, 8);
}

// Named people with roles on about/team/contact pages, plus the page's emails and phone numbers.
async function sitePeople(domain, homeHtml) {
  const host = domain.replace(/^www\./, "");
  const people = [], emails = new Set(), phones = new Set(), links = new Set();
  const pages = [["/", homeHtml || ""]];
  const paths = ["/about", "/about-us", "/about-us/", "/team", "/our-team", "/our-team/", "/meet-the-team", "/meet-the-team/", "/people", "/contact", "/contact-us", "/contact-us/", "/who-we-are"];
  const fetched = await Promise.all(paths.map(async (pth) => { const r = await get(`https://${host}${pth}`); return r.status === 200 && /html/i.test(r.type || "") ? [pth, r.html] : null; }));
  for (const f of fetched) if (f) pages.push(f);
  const seenHtml = new Set();
  for (const [pth, html] of pages) {
    if (!html || seenHtml.has(html.length)) continue; // same page served under two paths
    seenHtml.add(html.length);
    for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(decodeURIComponent(m[1]).toLowerCase());
    for (const m of html.matchAll(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi)) emails.add(m[1].toLowerCase());
    for (const m of html.matchAll(/(?:href="tel:|\b)((?:\+44\s?|0)(?:\d\s?){9,10})\b/g)) phones.add(m[1].replace(/\s+/g, " ").trim());
    for (const m of html.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_%-]+/g)) links.add(m[0]);
    let $; try { $ = cheerio.load(html); } catch { continue; }
    $("script, style, noscript, nav, footer").remove();
    // A role mention next to a name-shaped heading or bold line.
    $("h1, h2, h3, h4, h5, h6, strong, b, p, span, div, li, td, figcaption").each((_, el) => {
      const t = $(el).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
      if (!t || t.length > 70 || !ROLE_RE.test(t)) return;
      // Name in the same line ("Jane Smith – Managing Director") or in the previous block.
      let name = "";
      const parts = t.split(/\s[-–—|,:]\s|\s[-–—|]\s?|\s?[-–—|]\s/);
      for (const p of parts) if (NAME_RE.test(p.trim()) && !ROLE_RE.test(p)) name = p.trim();
      if (!name) {
        const prev = $(el).prev(); const pt = prev.text().replace(/\s+/g, " ").trim();
        if (NAME_RE.test(pt)) name = pt;
        else { const pp = $(el).parent().prev(); const ppt = pp.text().replace(/\s+/g, " ").trim(); if (NAME_RE.test(ppt)) name = ppt; }
        if (!name) { const h = $(el).parent().find("h1,h2,h3,h4,h5,strong").first().text().replace(/\s+/g, " ").trim(); if (NAME_RE.test(h) && h !== t) name = h; }
      }
      if (!name) return;
      const role = (t.match(ROLE_RE) || [""])[0];
      const roleFull = t.replace(name, "").replace(/^[\s\-–—|,:]+|[\s\-–—|,:]+$/g, "").slice(0, 60) || role;
      if (!people.some((p) => p.name.toLowerCase() === name.toLowerCase())) people.push({ name, role: cap(roleFull), source: `Website (${pth === "/" ? "homepage" : pth.replace(/\//g, "") + " page"})`, why: "Named with a role on their own site" });
    });
  }
  const own = [...emails].filter((e) => (e.endsWith("@" + host) || e.endsWith("." + host)) && !/\.(png|jpg|gif|svg|webp)$/.test(e));
  const other = [...emails].filter((e) => !own.includes(e) && !/\.(png|jpg|gif|svg|webp)$|sentry|wixpress|example\.com|yourdomain|email@|name@|user@|wordpress|@2x/i.test(e));
  return { people: people.slice(0, 8), emails: [...own, ...other].slice(0, 10), phones: [...phones].slice(0, 4), linkedin: [...links].slice(0, 6) };
}

// Pair people with emails. Personal addresses on the domain match by first name or surname;
// otherwise guess the pattern from any personal address found, and label it unverified.
function pairEmails(people, emails, host) {
  const generic = /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception|support|accounts|hr|jobs|careers|team|studio|help|post)@/;
  const personal = emails.filter((e) => !generic.test(e) && e.endsWith("@" + host));
  let pattern = "";
  for (const p of people) {
    const [first, ...rest] = p.name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").toLowerCase().split(" ");
    const last = (rest.pop() || "").replace(/[^a-z]/g, "");
    const f = first.replace(/[^a-z]/g, "");
    const hit = personal.find((e) => { const local = e.split("@")[0]; return local === f || local === `${f}.${last}` || local === `${f}${last}` || local === `${f[0]}${last}` || local === `${f[0]}.${last}` || (last.length > 3 && local === last) || (f.length > 3 && local.startsWith(f) && last && local.includes(last)); });
    if (hit) { p.email = hit; p.emailStatus = "Found on their site"; const local = hit.split("@")[0]; pattern = local === f ? "first" : local === `${f}.${last}` ? "first.last" : local === `${f}${last}` ? "firstlast" : local === `${f[0]}${last}` ? "flast" : local === `${f[0]}.${last}` ? "f.last" : pattern; }
  }
  if (!pattern && personal.length) { const local = personal[0].split("@")[0]; pattern = local.includes(".") ? "first.last" : "first"; }
  for (const p of people) {
    if (p.email) continue;
    const [first, ...rest] = p.name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").toLowerCase().split(" ");
    const last = (rest.pop() || "").replace(/[^a-z]/g, ""); const f = first.replace(/[^a-z]/g, "");
    if (!f || !host) continue;
    const guess = { first: `${f}@${host}`, "first.last": last ? `${f}.${last}@${host}` : `${f}@${host}`, firstlast: last ? `${f}${last}@${host}` : `${f}@${host}`, flast: last ? `${f[0]}${last}@${host}` : `${f}@${host}`, "f.last": last ? `${f[0]}.${last}@${host}` : `${f}@${host}` }[pattern || "first.last"];
    p.emailGuess = guess; p.emailStatus = pattern ? `Guess from the ${pattern} pattern used on their site; unverified` : "Guess, unverified (no personal addresses found on the site)";
  }
  return people;
}

export async function findContacts({ companyNumber, website, business }) {
  const host = String(website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const [chPeople, site] = await Promise.all([companyNumber ? companyPeople(companyNumber).catch(() => []) : [], host ? sitePeople(host, "").catch(() => ({ people: [], emails: [], phones: [], linkedin: [] })) : { people: [], emails: [], phones: [], linkedin: [] }]);
  // Merge: a director who also appears on the site keeps both labels.
  const people = [...site.people];
  for (const c of chPeople) {
    const surname = c.name.split(" ").pop().toLowerCase();
    const hit = people.find((p) => p.name.split(" ").pop().toLowerCase() === surname && p.name[0].toLowerCase() === c.name[0].toLowerCase());
    if (hit) { hit.role = `${hit.role} · ${c.role}`; hit.source += " + Companies House"; hit.why = `${hit.why}; ${c.why}`; }
    else people.push(c);
  }
  pairEmails(people, site.emails, host);
  const q = (p) => encodeURIComponent(`${p.name} ${String(business || "").replace(/\s+(ltd|limited|llp|plc)\.?$/i, "")}`);
  for (const p of people) { p.linkedinSearch = `https://www.linkedin.com/search/results/people/?keywords=${q(p)}`; p.googleSearch = `https://www.google.com/search?q=${q(p)}`; }
  // Rank: marketing and managing roles first, then owners/directors, then the rest.
  const rank = (p) => (/marketing|digital|brand/i.test(p.role) ? 0 : /managing|ceo|founder|owner|proprietor/i.test(p.role) ? 1 : /director|partner|principal|general manager/i.test(p.role) ? 2 : 3);
  people.sort((a, b) => rank(a) - rank(b));
  const generic = site.emails.filter((e) => /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception)@/.test(e));
  const channels = [
    ...generic.map((e) => ({ kind: "email", value: e, label: "General inbox (from their site)" })),
    ...site.phones.map((v) => ({ kind: "phone", value: v, label: "Phone (from their site)" })),
    ...site.linkedin.map((v) => ({ kind: "linkedin", value: v, label: /\/company\//.test(v) ? "LinkedIn company page" : "LinkedIn profile linked from their site" })),
  ];
  return { people: people.slice(0, 10), channels, contactsAt: new Date().toISOString() };
}

// ---- search visibility (SEO) ---------------------------------------------------------
//
// Two searches a customer would actually type: the business name + town, and
// what it does + town ("plumber Teddington"). Where does their site come up?
// Uses Google's Programmable Search JSON API when GOOGLE_CSE_KEY and
// GOOGLE_CSE_CX are set (100 searches a day free), otherwise DuckDuckGo's HTML
// results, which need no key.

const SIC_TERMS = {
  "47110": "convenience store", "47190": "department store", "47210": "greengrocer", "47220": "butcher", "47230": "fishmonger", "47240": "bakery", "47250": "off licence", "47260": "tobacconist", "47290": "food shop", "47410": "computer shop", "47510": "fabric shop", "47520": "hardware shop", "47530": "carpet shop", "47540": "electrical shop", "47590": "furniture shop", "47610": "bookshop", "47620": "newsagent", "47640": "sports shop", "47650": "toy shop", "47710": "clothes shop", "47721": "shoe shop", "47722": "leather goods shop", "47730": "pharmacy", "47750": "beauty shop", "47760": "garden centre", "47770": "jeweller", "47781": "optician", "47782": "photography shop", "47789": "gift shop", "47990": "shop",
  "56101": "restaurant", "56102": "cafe", "56103": "takeaway", "56210": "caterer", "56290": "catering", "56301": "bar", "56302": "pub", "55100": "hotel", "55209": "bed and breakfast",
  "41202": "builder", "43210": "electrician", "43220": "plumber", "43290": "heating engineer", "43310": "plasterer", "43320": "joiner", "43330": "flooring", "43341": "painter and decorator", "43342": "glazier", "43390": "building services", "43910": "roofer", "43990": "builder", "81210": "cleaning company", "81221": "cleaners", "81222": "cleaning", "81223": "window cleaner", "81299": "cleaning", "81300": "landscape gardener", "95110": "computer repair", "95120": "phone repair", "95210": "tv repair", "95220": "appliance repair", "95230": "shoe repair", "95240": "furniture restorer", "95250": "watch repair", "95290": "repair shop", "45200": "garage", "45320": "car parts", "45111": "car dealer", "45112": "car dealer",
  "69101": "solicitor", "69102": "solicitor", "69109": "legal services", "69201": "accountant", "69202": "bookkeeper", "69203": "tax adviser", "70221": "financial adviser", "70229": "business consultant", "71111": "architect", "71112": "architect", "71121": "structural engineer", "71129": "engineering consultant", "71200": "surveyor", "66220": "insurance broker", "66190": "financial adviser", "68310": "estate agent", "68320": "property management", "73110": "advertising agency", "73120": "media agency", "74100": "design studio", "74201": "photographer", "74202": "photographer", "74209": "photographer", "74300": "translator", "74909": "consultant", "78109": "recruitment agency", "78200": "recruitment agency", "82990": "business services",
  "86210": "GP", "86220": "private clinic", "86230": "dentist", "86900": "clinic", "96020": "hairdresser", "96040": "spa", "96090": "beauty salon", "93130": "gym", "93110": "sports club", "93120": "sports club", "93191": "sports club", "93199": "sports club", "75000": "vet",
  "85100": "nursery", "85200": "primary school", "85310": "school", "85320": "college", "85410": "college", "85421": "university", "85422": "university", "85510": "sports coaching", "85520": "music lessons", "85530": "driving school", "85590": "tuition", "85600": "tutor", "88910": "nursery", "90010": "theatre", "90020": "events company", "90030": "artist", "90040": "venue", "91020": "museum", "93210": "activity centre", "93290": "leisure",
  "10710": "bakery", "10720": "bakery", "11050": "brewery", "11010": "distillery", "11020": "winery", "10850": "food producer", "13300": "textile printer", "14190": "clothing maker", "16290": "woodworker", "18129": "printer", "23410": "pottery", "25620": "engineering workshop", "31010": "office furniture", "31020": "kitchen maker", "31090": "furniture maker", "32120": "jewellery maker", "32990": "manufacturer",
};
export const tradeTerm = (sics, name) => { for (const c of sics || []) if (SIC_TERMS[c]) return SIC_TERMS[c]; const w = words(name || ""); return w.length > 1 ? w[w.length - 1] : ""; };

async function searchResults(query) {
  const key = process.env.GOOGLE_CSE_KEY, cx = process.env.GOOGLE_CSE_CX;
  if (key && cx) {
    const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&gl=uk&num=10&q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (r.status === 429) throw new Error("Google search quota used up for today (100 free searches a day).");
    if (!r.ok) throw new Error(`Google search error ${r.status}`);
    const j = await r.json();
    return { engine: "Google", results: (j.items || []).map((i) => ({ url: i.link, title: i.title })) };
  }
  const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=uk-en`);
  if (r.status !== 200) throw new Error(`Search unavailable (${r.status || r.error}). Add GOOGLE_CSE_KEY and GOOGLE_CSE_CX for reliable results.`);
  const $ = cheerio.load(r.html || "");
  const results = [];
  $("a.result__a").each((_, a) => {
    let href = $(a).attr("href") || "";
    try { const u = new URL(href, "https://duckduckgo.com"); const real = u.searchParams.get("uddg"); if (real) href = real; } catch {}
    if (/^https?:/.test(href) && !/duckduckgo\.com/.test(href)) results.push({ url: href, title: $(a).text().trim() });
  });
  if (!results.length && /anomaly|bot|captcha/i.test(r.html || "")) throw new Error("DuckDuckGo blocked the search. Add GOOGLE_CSE_KEY and GOOGLE_CSE_CX for reliable results.");
  return { engine: "DuckDuckGo", results: results.slice(0, 10) };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const DIRECTORY_RE = /yell\.com|checkatrade|trustatrader|facebook\.com|instagram\.com|linkedin\.com|yelp|tripadvisor|google\.|bing\.|companieshouse|find-and-update|endole|companycheck|opencorporates|192\.com|thomsonlocal|cylex|scoot|hotfrog|freeindex|bark\.com|rated ?people|mybuilder|nextdoor|wikipedia/i;

// Rank of the business for the two searches, with who beats them.
export async function seoCheck({ business, website, area, sics }) {
  const host = String(website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const name = String(business || "").replace(/\s+(ltd|limited|llp|plc)\.?$/i, "");
  const town = String(area || "").split(/[\/(+]/)[0].trim();
  const trade = tradeTerm(sics, name);
  const queries = [{ kind: "name", query: `${name} ${town}`.trim() }, ...(trade ? [{ kind: "trade", query: `${trade} ${town}`.trim() }] : [])];
  const out = { checkedAt: new Date().toISOString(), engine: "", searches: [] };
  for (const q of queries) {
    try {
      const { engine, results } = await searchResults(q.query);
      out.engine = engine;
      const idx = host ? results.findIndex((r) => hostOf(r.url) === host || hostOf(r.url).endsWith("." + host)) : -1;
      const ahead = results.slice(0, idx === -1 ? 3 : idx).map((r) => hostOf(r.url)).filter((h) => h && !DIRECTORY_RE.test(h));
      const directoriesOnly = idx === -1 && results.length > 0 && results.slice(0, 3).every((r) => DIRECTORY_RE.test(hostOf(r.url)));
      out.searches.push({ ...q, position: idx === -1 ? null : idx + 1, top: results.slice(0, 5).map((r) => hostOf(r.url)), ahead: [...new Set(ahead)].slice(0, 3), directoriesOnly });
    } catch (e) { out.searches.push({ ...q, error: String(e?.message || e) }); }
  }
  const nameS = out.searches.find((x) => x.kind === "name"), tradeS = out.searches.find((x) => x.kind === "trade");
  out.weak = Boolean((nameS && !nameS.error && nameS.position !== 1) || (tradeS && !tradeS.error && (tradeS.position === null || tradeS.position > 3)));
  out.summary = out.searches.filter((x) => !x.error).map((x) => `"${x.query}": ${x.position ? `#${x.position}` : "not on page 1"}${x.ahead.length ? ` (behind ${x.ahead.join(", ")})` : ""}`).join(" · ") || out.searches.map((x) => x.error).join("; ");
  return out;
}

// ---- licence risks we are sure about ------------------------------------------------
//
// Only the things a court would agree with: demo/trial fonts installed on a live
// site, fonts loaded from a redistribution site, and stock images whose file
// names are the library's own watermarked previews. "Probably" is not enough
// to put in a cold email.
export async function licenceRisks(domain) {
  const { scanSite } = await import("@/lib/scanner");
  const { issueLabel, stockLicenceSignal } = await import("@/lib/fontlink");
  const host = String(domain || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const rec = await scanSite(host, { pages: 3, mode: "both" });
  const fonts = [];
  for (const f of rec.fonts || []) {
    const label = issueLabel(f);
    if (label === "Demo Font") fonts.push({ family: f.family, label, detail: "a demo copy installed on the server; demo fonts are for testing only, not live sites", source: f.source || "" });
    else if (label === "Unlicensed Font Source") fonts.push({ family: f.family, label, detail: "loaded from a site that redistributes fonts without a licence", source: f.source || "" });
  }
  const images = [];
  for (const i of rec.images || []) {
    if (!i.flag || /free/i.test(i.flag)) continue;
    const sig = stockLicenceSignal(i);
    if (sig.status === "Possible preview" && /preview file name/i.test(sig.reason)) images.push({ url: i.url, page: i.page || i.pages?.[0] || "", library: i.flag, detail: "the library's watermarked preview file, not a licensed download" });
  }
  return { fonts: fonts.slice(0, 5), images: images.slice(0, 10), pagesChecked: rec.pagesScanned || rec.pages?.length || 0, checkedAt: new Date().toISOString(), error: rec.status === "UNREACHABLE" ? rec.error || "could not reach the site" : "" };
}

// ---- scoring and copy ----------------------------------------------------------

export function scoreLead(l) {
  // Likelihood: how badly the site lets them down × signs they can and will pay.
  let pts = 0;
  const reasons = [];
  const sev = { "Dead/broken site": 3, "Parked domain": 3, "No website": 2, "Broken SSL": 3, "Dated template": 2, "Stale copyright": 1 }[l.problem] || 0;
  pts += sev;
  if (sev >= 3) reasons.push("site is broken or missing right now, an immediate need");
  else if (l.problem === "Dated template") reasons.push("paying for or stuck on a template is an easy switch pitch");
  else if (l.problem === "Stale copyright") reasons.push(`site untouched for years${l.year ? ` (© ${l.year})` : ""}`);
  if (l.netAssets !== null && l.netAssets !== undefined) {
    if (l.netAssets >= 250000) { pts += 2; reasons.push(`£${Math.round(l.netAssets / 1000)}k net assets, budget is not the issue`); }
    else if (l.netAssets >= 50000) { pts += 1; reasons.push(`£${Math.round(l.netAssets / 1000)}k net assets`); }
    else if (l.netAssets < 10000) { pts -= 1; reasons.push("thin balance sheet"); }
  }
  if (l.reChange !== null && l.reChange !== undefined) {
    if (l.reChange > 15000) { pts += 1; reasons.push(`+£${Math.round(l.reChange / 1000)}k implied profit last year`); }
    else if (l.reChange < -15000) { pts -= 1; reasons.push("retained earnings fell last year"); }
  }
  if (l.problem === "Stale copyright" && l.year && new Date().getFullYear() - l.year >= 10) { pts -= 1; reasons.push("10+ years without touching the site suggests web is not valued"); }
  if (l.emailAddress) pts += 0.5;
  if (l.brandLed) { pts += 1; reasons.push("brand-led sector where the site is the shop window"); }
  if (l.seo?.weak) { pts += 1; reasons.push("not at the top of search for their own name or trade; SEO is a second service to sell"); }
  if (l.licence?.images?.length || l.licence?.fonts?.length) { pts += 1; reasons.push("unlicensed stock images or demo fonts on the site, a money-saving reason to talk"); }
  const likelihood = pts >= 5 ? "High" : pts >= 3 ? "Medium" : "Low";
  return { likelihood, likelihoodWhy: reasons.join("; ").replace(/^./, (c) => c.toUpperCase()) };
}

const BRAND_LED = /^(47(2|5|6|7)|56|9602|7410|7111|9001|1105|1071)/;
export const isBrandLed = (sics) => (sics || []).some((s) => BRAND_LED.test(s));

// Bump when the email wording changes, so existing leads get redrafted automatically
// (unless someone has edited that lead's email by hand).
export const DRAFT_VERSION = 8;

// Pitch angle and a first-draft email: written as the agency's designer, with
// two or three concrete suggestions, in the house style from the matrix.
// Pages on icldigital.com the emails link to. Editable in Settings → Connections → Email links.
export const DEFAULT_LINKS = { site: "https://icldigital.com/", websites: "https://icldigital.com/services/websites/", videography: "https://icldigital.com/services/videography/", contact: "https://icldigital.com/get-in-touch/" };

export function draftOutreach(l) {
  const L = { ...DEFAULT_LINKS, ...(l.links || {}) };
  const first = l.contactName ? l.contactName.split(" ")[0] : "";
  const name = l.business.replace(/\s+(ltd|limited|llp|plc)\.?$/i, "");
  const hi = first ? `Hi ${first},` : "Hi there,";
  const hasSite = l.website && l.problem !== "No website" && l.problem !== "Parked domain";
  const old = l.year ? `${new Date().getFullYear() - l.year} years` : "a while";
  const host = String(l.website || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const httpsUrl = host ? `https://${host}/` : "";
  const siteUrl = l.siteUrl || httpsUrl;
  const town = String(l.area || "").split(/[\/(+]/)[0].trim();
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const place = /caf|pub|restaurant|bakery|brew|bar\b|hotel|salon|shop|store/i.test(name + " " + (l.sics || []).join(" "));

  // The one thing wrong with the site, then two more ideas. Three in total, always.
  const P = {
    "Parked domain": { subject: `Your website isn't showing up (quick fix)`, pitch: "'Customers Googling you find a parking page' — simple site + local SEO", main:
      `${l.website || "Your domain"} lands on a parking page (${siteUrl || "try it"}), so anyone who finds you online gets nothing. Even a one-page site fixes that straight away.`,
      more: ["A single page with what you do, where you are and how to get in touch is enough to start bringing people in from local searches.", "Your Google listing and the site should match, so reviews and the map pin all point to the same place."] },
    "Dead/broken site": { subject: `Your website is down right now`, pitch: "Rescue the dead site first, then a proper rebuild", main:
      `The site isn't loading (${siteUrl}), so customers are landing on an error. Getting it back up is quick and I'd sort that first.`,
      more: ["Once it's back, the layout and photos need a refresh so it reflects the business as it is now.", "Put the phone number and a contact button at the top of the homepage so nobody has to hunt for them."] },
    "Broken SSL": { subject: `Your website is showing a security warning`, pitch: "Quick SSL rescue as the door-opener, redesign as the upsell", main:
      `Your site shows a security warning in the browser (try ${httpsUrl}). It puts people off before they've seen anything, and it's a quick fix I'm happy to sort as a one-off.`,
      more: ["The design could be cleaner and easier to read on a phone, which is where most of your visitors are.", "A 'get in touch' button that follows you down the page turns more visits into enquiries."] },
    "Stale copyright": { subject: `A few things holding the ${name} website back`, pitch: "Image-led refresh; the site should sell the way the business does", main:
      `The site (${siteUrl}) hasn't changed in ${old}${l.year ? ` (the footer still says ${l.year})` : ""} and it looks it. A refresh would bring the layout, type and colours up to date.`,
      more: ["Bigger, better photos of the work and the people would do most of the selling for you.", "It needs to work properly on phones: larger text, buttons you can tap, the important details at the top."] },
    "Dated template": { subject: `Your website could be doing a lot more for ${name}`, pitch: "Own the site instead of renting a template; better local SEO", main:
      `The site (${siteUrl}) runs on ${l.problemDetail ? l.problemDetail.replace(/,.*$/, "").toLowerCase() : "a template builder"}, which limits how it looks and how well it shows up in search.`,
      more: ["A design built around your brand and photos would set you apart from the other local businesses on the same template.", "Owning your site also means no monthly subscription for something that stays generic."] },
    "Licence risk": { subject: `Something on your website that could cost you money`, pitch: "Licence rescue (watermarked images / demo fonts) as the door-opener", main: "", more: ["The design could be cleaner and easier to read on a phone, which is where most of your visitors are.", "A 'get in touch' button that follows you down the page turns more visits into enquiries."] },
    "No website": { subject: `Customers can't find ${name} online`, pitch: "First proper site: location, services, reviews, enquiries", main:
      `I couldn't find a website for ${name} (here's what comes up: ${g(`${name} ${town}`.trim())}), so people searching locally are landing on a directory or a competitor instead.`,
      more: ["A simple, well-designed site with what you do, where you are and how to get in touch tends to pay for itself quickly.", "It also gives your Google reviews and social posts somewhere to point to."] },
  }[l.problem] || { subject: `Spotted a few things on the ${name} website`, pitch: "", main: `I had a look at the website and the design could be working much harder for you.`, more: ["It needs to work properly on phones: larger text, buttons you can tap, the important details at the top.", "A 'get in touch' button that follows you down the page turns more visits into enquiries."] };

  // Search visibility, in the customer's words: "when I searched for you…".
  let seo = "";
  const sn = l.seo?.searches?.find((x) => x.kind === "name" && !x.error), st = l.seo?.searches?.find((x) => x.kind === "trade" && !x.error);
  if (st && (st.position === null || st.position > 3)) seo = `When I searched "${st.query}" (${g(st.query)}) you ${st.position ? `came up at number ${st.position}` : "weren't on the first page"}${st.ahead.length ? `, behind ${st.ahead.slice(0, 2).join(" and ")}` : ""}. That's the search most new customers make. Some local SEO work, which we also do, would move you up it.`;
  else if (sn && sn.position !== 1) seo = `When I searched "${sn.query}" (${g(sn.query)}) your own site ${sn.position ? `came up at number ${sn.position}` : "wasn't on the first page"}${sn.directoriesOnly ? ", with directories taking the top spots" : ""}. People searching for you by name should land on you first; some local SEO work, which we also do, would fix that.`;

  // Licence risks are a money-saving point, so they come straight after the main problem.
  let licence = "";
  const li = l.licence?.images || [], lf = l.licence?.fonts || [];
  if (li.length) {
    const libs = [...new Set(li.map((x) => x.library))].join(" and ");
    const eg = li[0].page || li[0].url;
    licence = `${li.length === 1 ? "One of the images" : `${li.length} of the images`} on the site ${li.length === 1 ? "is" : "are"} ${libs}'s watermarked preview file${li.length === 1 ? "" : "s"} rather than licensed download${li.length === 1 ? "" : "s"} (for example ${eg}). Stock libraries do chase businesses for that, and the fees are steep. Licensing or replacing them is cheap by comparison, and I'd happily point out which ones.`;
  } else if (lf.length) {
    const f = lf[0];
    licence = `The site is using ${lf.length === 1 ? `a ${f.label === "Demo Font" ? "demo copy of the font" : "copy of the font"} "${f.family}"` : `${lf.length} fonts`} that ${lf.length === 1 ? "isn't" : "aren't"} licensed for a live website (${f.detail}). Type foundries do send invoices for this, so licensing it properly or switching to a free equivalent would remove that risk.`;
  }
  const video = l.noVideoPitch ? "" : `A short hero video at the top of the homepage, a few seconds of ${place ? "the place and the people" : "the team at work"}, is the single biggest upgrade a local site can make. We film and edit those ourselves: ${L.videography}`;

  // Exactly three: the problem, then SEO and video if they apply, then the template's other ideas.
  const ideas = [P.main, licence, seo, video, ...P.more].filter(Boolean).slice(0, 3);
  const opener = hasSite
    ? `I'm the designer at a small web agency nearby and came across your website this week. Here are three things that I think would make a real difference:`
    : `I'm the designer at a small web agency nearby and came across ${name} this week. Here are three things that I think would make a real difference:`;
  const list = ideas.map((x, i) => `${i + 1}. ${x}`).join("\n\n");
  const close = `Happy to mock up what that could look like, no charge and no pressure either way.\n\nWe're ICL Digital in Richmond (${L.site}). We design and build websites (${L.websites})${l.noVideoPitch ? "" : ` and film videography for them (${L.videography})`}, and we also look after SEO, paid ads, hosting and ongoing support, so everything can sit with one team.`;
  return { subject: P.subject, pitch: `${P.pitch}${seo ? " + local SEO" : ""}${P.pitch && !l.noVideoPitch ? " + hero video" : ""}`, email: `${hi}\n\n${opener}\n\n${list}\n\n${close}`, draftVersion: DRAFT_VERSION };
}

// Full enrichment of one Companies House candidate. Budgeted so one call stays inside a serverless request.
export async function leadsEnrich(c, { knownSites = new Set() } = {}) {
  const lead = {
    id: c.companyNumber, business: titleCase(c.name), area: c.locality || "", address: c.address || "", postcode: c.postcode || "",
    companyNumber: c.companyNumber, sics: c.sics || [], incorporated: c.incorporated || "",
    website: "", problem: "", problemDetail: "", platform: "", year: 0, title: "",
    netAssets: null, reChange: null, employees: null, accountsDate: "", caveats: "", background: "",
    emailAddress: "", emailNote: "", contactName: "", status: "new", source: "Companies House", addedAt: new Date().toISOString(),
  };
  const [site, acc] = await Promise.all([findWebsite(c), accountsFacts(c.companyNumber).catch((e) => ({ caveat: String(e?.message || e) }))]);
  Object.assign(lead, { netAssets: acc.netAssets ?? null, reChange: acc.reChange ?? null, employees: acc.employees ?? null, accountsDate: acc.accountsDate || "" });
  const caveats = [];
  if (acc.caveat) caveats.push(acc.caveat);
  if (acc.netAssetsPrev !== null && acc.netAssetsPrev !== undefined && acc.netAssets !== null && Math.abs(acc.netAssets - acc.netAssetsPrev) > Math.abs(acc.netAssets) * 0.5) caveats.push("Big year-on-year swing in net assets; check the accounts");
  if (site.domain) {
    lead.website = site.domain;
    if (knownSites.has(site.domain.replace(/^www\./, ""))) { lead.status = "not-pursuing"; caveats.push("Already a client"); }
    const w = site.parked ? { problem: "Parked domain", detail: "Domain shows a parking page; there is no site.", siteOk: false } : await checkWebsite(site.domain);
    Object.assign(lead, { problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "", siteUrl: w.siteUrl || "" });
    if (w.caveat) caveats.push(w.caveat);
    if (!site.parked && w.status) lead.emailAddress = await findEmail(site.domain, "").catch(() => "");
  } else {
    lead.problem = "No website";
    lead.problemDetail = `No site found under the obvious domain names (tried ${site.tried.length}). Verify by searching.`;
    caveats.push("Website guessed from the company name; may trade under another name");
  }
  if (!lead.emailAddress) lead.emailNote = lead.website ? "Not found on the site" : "No site to take it from";
  try { lead.seo = await seoCheck({ business: lead.business, website: lead.website, area: lead.area, sics: c.sics }); } catch {}
  try {
    const ct = await findContacts({ companyNumber: c.companyNumber, website: lead.website, business: lead.business });
    lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt;
    const best = ct.people.find((p) => p.email) || null;
    if (best) { lead.emailAddress = best.email; lead.contactName = best.name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").split(" ")[0]; lead.emailNote = ""; }
  } catch {}
  lead.caveats = caveats.join("; ");
  lead.brandLed = isBrandLed(c.sics);
  if (lead.employees) lead.background = `${plural(lead.employees, "staff")}, est. ${(c.incorporated || "").slice(0, 4)}`;
  else if (c.incorporated) lead.background = `Est. ${c.incorporated.slice(0, 4)}`;
  if (lead.problem) {
    Object.assign(lead, scoreLead(lead));
    const d = draftOutreach({ ...lead, links: c.links });
    lead.subject = d.subject; lead.pitch = d.pitch; lead.email = d.email; lead.draftVersion = d.draftVersion;
    lead.status = lead.status === "not-pursuing" ? "not-pursuing" : lead.likelihood === "Low" ? "new" : lead.emailAddress ? "qualified" : "no-contact";
  } else {
    lead.likelihood = "Low"; lead.likelihoodWhy = "Site is current; no outreach planned"; lead.status = "not-pursuing";
  }
  return lead;
}

// Re-run every automated part of an existing lead with the current rules,
// keeping what a person wrote: status, notes, contact name, a hand-typed address.
export async function leadsRefresh(l, { knownSites = new Set() } = {}) {
  const keep = { status: l.status, notes: l.notes, notesLog: l.notesLog, contactName: l.contactName, noVideoPitch: l.noVideoPitch, addedAt: l.addedAt, source: l.source, background: l.background, manualEmail: l.manualEmail };
  const fromCH = !!l.companyNumber && l.source !== "Client Matrix v4.1";
  const company = { companyNumber: l.companyNumber, name: l.business, status: "active", type: "ltd", incorporated: l.incorporated || "", sics: l.sics || [], locality: l.area || "", postcode: l.postcode || "", address: l.address || "", links: l.links };
  let lead;
  if (fromCH) {
    lead = await leadsEnrich(company, { knownSites });
    // A website the person typed or confirmed wins over a fresh guess.
    if (l.website && l.websiteConfirmed) { const w = await checkWebsite(l.website); Object.assign(lead, { website: l.website, problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "", siteUrl: w.siteUrl || "" }); }
  } else {
    lead = { ...l };
    if (l.website) { const w = await checkWebsite(l.website); Object.assign(lead, { problem: w.problem || l.problem, problemDetail: w.problem ? w.detail : l.problemDetail, platform: w.platform || "", year: w.year || l.year || 0, title: w.title || "", siteUrl: w.siteUrl || "" }); }
    try { lead.seo = await seoCheck({ business: l.business, website: l.website, area: l.area, sics: l.sics }); } catch {}
    try { const ct = await findContacts({ companyNumber: l.companyNumber, website: l.website, business: l.business }); lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; const best = ct.people.find((p) => p.email); if (best && !l.emailAddress) { lead.emailAddress = best.email; lead.contactName = l.contactName || best.name.split(" ")[0]; } } catch {}
    if (lead.problem) { Object.assign(lead, scoreLead(lead)); const d = draftOutreach({ ...lead, contactName: keep.contactName || lead.contactName, links: l.links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, draftVersion: d.draftVersion }); }
  }
  if (!lead.emailAddress && l.emailAddress) lead.emailAddress = l.emailAddress;
  Object.assign(lead, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined && v !== "")));
  if (["qualified", "no-contact"].includes(lead.status) && lead.problem) lead.status = lead.emailAddress ? "qualified" : "no-contact";
  if (keep.contactName && lead.email) lead.email = lead.email.replace(/^Hi( there| [A-Z][a-z'’-]+)?,/, `Hi ${keep.contactName.split(" ")[0]},`);
  lead.refreshedAt = new Date().toISOString();
  delete lead.links;
  return lead;
}

const plural = (n, w) => `${n} ${w}`;
function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, pre, c) => pre + c.toUpperCase()).replace(/\bO'([a-z])/g, (m, c) => "O'" + c.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => "Mc" + c.toUpperCase()).replace(/\b(Ltd|Llp|Plc)\b/g, (m) => ({ Ltd: "Ltd", Llp: "LLP", Plc: "PLC" }[m])).replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of");
}

export { LEAD_STATUSES, PROBLEMS } from "@/lib/leadsShared";
