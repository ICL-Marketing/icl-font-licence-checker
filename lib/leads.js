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
// Companies House matches the place name anywhere in the address ("Richmond Road,
// Birmingham"), so every preset also lists its postcode districts and results outside
// them are dropped.
export const AREA_PRESETS = {
  richmond: { label: "Richmond borough", places: ["Twickenham", "Hampton", "Hampton Hill", "Hampton Wick", "Teddington", "Richmond", "East Sheen", "Mortlake", "Barnes", "Kew", "St Margarets", "Whitton", "Strawberry Hill", "Ham", "Petersham"], postcodes: ["TW1", "TW2", "TW9", "TW10", "TW11", "TW12", "SW13", "SW14", "KT2"] },
  kingston: { label: "Kingston & Surbiton", places: ["Kingston upon Thames", "Surbiton", "New Malden", "Chessington", "Tolworth"], postcodes: ["KT1", "KT2", "KT3", "KT4", "KT5", "KT6", "KT9"] },
  hounslow: { label: "Hounslow & Chiswick", places: ["Hounslow", "Chiswick", "Isleworth", "Brentford", "Feltham"], postcodes: ["TW3", "TW4", "TW5", "TW7", "TW8", "TW13", "TW14", "W4"] },
  wandsworth: { label: "Wandsworth & Putney", places: ["Putney", "Wandsworth", "Wimbledon", "Southfields", "Earlsfield"], postcodes: ["SW15", "SW17", "SW18", "SW19", "SW11", "SW12"] },
  spelthorne: { label: "Sunbury, Staines & Walton", places: ["Sunbury-on-Thames", "Sunbury", "Shepperton", "Staines-upon-Thames", "Staines", "Ashford", "Walton-on-Thames", "Hersham", "East Molesey", "West Molesey", "Weybridge", "Hanworth"], postcodes: ["TW15", "TW16", "TW17", "TW18", "TW19", "KT8", "KT12", "KT13", "TW13", "TW14"] },
};
const ALL_AREA_POSTCODES = new Set([...Object.values(AREA_PRESETS).flatMap((a) => a.postcodes), "TW13", "TW14", "TW15", "TW16", "TW17", "TW18", "TW19", "KT8", "KT12", "KT13", "SL3"]);
export const inOurPatch = (pc) => ALL_AREA_POSTCODES.has(String(pc || "").toUpperCase().trim().split(/\s+/)[0]);
export const outward = (pc) => String(pc || "").toUpperCase().trim().split(/\s+/)[0] || "";
// Is the registered office really in the area? Postcode district first; for a typed town,
// the locality itself must be that town (not a street named after it somewhere else).
export function inArea(c, { postcodes = [], town = "" } = {}) {
  const o = outward(c.postcode);
  if (postcodes.length) return postcodes.includes(o);
  if (town) { const t = town.toLowerCase(); return String(c.locality || "").toLowerCase() === t || String(c.address || "").toLowerCase().split(",").some((part) => part.trim() === t) || /^(TW|SW|KT|W4)/.test(o); }
  return true;
}

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
  const out = { netAssets: null, netAssetsPrev: null, reChange: null, accountsDate: "", accountsType: "", accountsNextDue: "", accountsOverdue: false, employees: null, caveat: "" };
  const profile = await ch(`/company/${companyNumber}`);
  out.accountsDate = profile?.accounts?.last_accounts?.made_up_to || "";
  // The next set: when it is due and whether it is already late (so the figure we show is from an older year).
  out.accountsNextDue = profile?.accounts?.next_accounts?.due_on || profile?.accounts?.next_due || "";
  out.accountsOverdue = Boolean(profile?.accounts?.next_accounts?.overdue || profile?.accounts?.overdue);
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
  if (na.length) { out.netAssets = na[0].v; if (/^\d{4}-\d{2}-\d{2}$/.test(na[0].d)) out.accountsDate = na[0].d; const prev = na.find((r) => r.d < na[0].d); if (prev) out.netAssetsPrev = prev.v; }
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
// Trade words that are in thousands of company names: "Carpets Limited" matching carpets.co.uk proves nothing.
const GENERIC_WORDS = new Set("carpets carpet flooring floors plumbing plumbers plumber heating gas electrical electricians electrician builders builder building construction contractors roofing roofers cleaning cleaners decorators painting painters landscapes landscaping gardens garden gardening removals storage motors cars autos garage tyres bathrooms kitchens interiors design designs digital media creative marketing consulting consultants solutions services service systems trading group holdings developments properties property estates lettings homes windows glazing doors fencing paving security locksmiths cafe coffee restaurant bakery kitchen catering foods bar pub inn hotel salon hair beauty nails barbers clinic dental dentists pharmacy physio fitness gym yoga pilates studio school nursery tuition academy sports club travel taxis cabs couriers logistics print printing photography photo video films events florist flowers pets vets shop store supplies wholesale direct online express london richmond twickenham teddington hampton kingston surbiton sunbury".split(" "));
// Company registration numbers printed on a page (footer, terms): "Company No. 01234567", "Registered in England and Wales 1234567", "SC123456".
export function companyNumbersIn(html) {
  const low = String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const out = new Set();
  const re = /(?:company|companies house|registered|registration|reg\.?|registered in england(?: and wales| & wales)?)[^0-9a-z]{0,12}(?:no\.?|number|#)?[^0-9a-z]{0,12}((?:sc|ni|oc|so|nc)?\d{6,8})\b/gi;
  let m; while ((m = re.exec(low))) { const n = m[1].toUpperCase(); out.add(/^\d+$/.test(n) ? n.padStart(8, "0") : n); }
  return [...out];
}
const sameCompanyNumber = (a, b) => String(a || "").toUpperCase().replace(/^0+/, "") === String(b || "").toUpperCase().replace(/^0+/, "");

const directorNamed = (low, officers = []) => officers.some((o) => { const parts = String(o.name || o).toLowerCase().replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s/, "").split(/\s+/).filter(Boolean); return parts.length >= 2 && low.includes(`${parts[0]} ${parts[parts.length - 1]}`); });

function looksLikeTheirs(html, name, postcode, locality, companyNumber = "", officers = []) {
  const low = html.toLowerCase().replace(/\s+/g, " ");
  // The surest signal either way: the registration number printed on the site.
  if (companyNumber) {
    const nums = companyNumbersIn(html);
    if (nums.some((n) => sameCompanyNumber(n, companyNumber))) return "company number on the site";
    if (nums.length) return "";
  }
  const hasTown = locality && low.includes(String(locality).toLowerCase());
  if (postcode && low.includes(postcode.toLowerCase().replace(/\s+/g, " "))) return "registered postcode on the site";
  if (directorNamed(low, officers)) return "a director named on the site";
  // A UK business site says so somewhere: a postcode, a UK phone number, pounds, .co.uk, the town.
  // Without any of that (properfood.com in Chicago for "Proper Food Collective Ltd") it is not theirs.
  const ukSignal = !!hasTown || /\b[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}\b/.test(low) || /\+44|\(?0\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/.test(low) || /£|\.co\.uk|united kingdom|\buk\b|england|london|surrey|middlesex/.test(low);
  if (!ukSignal) return "";
  const w = words(name).filter((x) => x.length > 2);
  if (!w.length) return "";
  const hits = w.filter((x) => low.includes(x)).length;
  const title = (low.match(/<title[^>]*>([^<]*)/) || [])[1] || "";
  const distinctive = w.filter((x) => !GENERIC_WORDS.has(x));
  // A name made only of trade words can only be confirmed by the town or postcode on the page.
  if (!distinctive.length) return hits === w.length && !!hasTown ? "trade name and town on the site" : "";
  // One- or two-word names ("Stein's", "Acme Ltd") match far too easily, so they need the
  // name in the <title> or the town on the page as well.
  if (w.length <= 2) return hits === w.length && (w.every((x) => title.includes(x)) || !!hasTown) ? (hasTown ? "name and town on the site" : "name in the page title") : "";
  return hits >= Math.ceil(w.length * 0.6) ? (hasTown ? "name and town on the site" : "name on the site") : "";
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
  const description = $ ? ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").replace(/\s+/g, " ").trim().slice(0, 220) : "";
  const text = $ ? $("body").text().replace(/\s+/g, " ") : html;
  const years = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})\b/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= 2100);
  const generator = $ ? ($('meta[name="generator"]').attr("content") || "") : "";
  const headings = $ ? $("h1, h2").slice(0, 12).map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter((x) => x && x.length < 90).join(" · ").slice(0, 600) : "";
  return {
    title, description, headings, year: years.length ? Math.max(...years) : 0, platform: detectPlatform(html) || generator.replace(/\s[\d.]+.*$/, "").slice(0, 40),
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
    if ((company.rejectedSites || []).includes(d.replace(/^www\./, ""))) return null;
    const ev = looksLikeTheirs(html, company.name, company.postcode, company.locality, company.companyNumber, company.officers || []);
    return ev ? { domain: d, score: 10 + hits + (HARD_EVIDENCE.includes(ev) ? 100 : 0), evidence: ev, html } : null;
  }));
  const best = checked.filter(Boolean).sort((a, b) => b.score - a.score)[0];
  return best ? { ...best, tried: cands } : { domain: "", tried: cands };
}

// Does this website belong to this company? Settled for free against Companies House facts, in order of
// strength: the company number printed on the site, the exact legal name (with Ltd/Limited), the registered
// postcode, the registered street line, a director or owner named on the site or in an email address on it,
// and finally the registered postcode area. A different company number on the site is a conflict.
const legalNameForms = (name) => {
  const base = String(name || "").toLowerCase().replace(/&amp;|&/g, " and ").replace(/[.,]/g, "").replace(/\s+/g, " ").trim().replace(/\s+(ltd|limited|llp|plc)$/i, "");
  return base ? [`${base} ltd`, `${base} limited`, `${base} llp`, `${base} plc`] : [];
};
const pageText = (html) => String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, " and ").replace(/&nbsp;|&#160;/g, " ").replace(/&/g, " and ").toLowerCase().replace(/\s+/g, " ");
const nameParts = (o) => String(o?.name || o || "").toLowerCase().replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s/, "").replace(/[^a-z\s'-]/g, "").split(/\s+/).filter(Boolean);
const directorEmail = (html, host, officers = []) => {
  const emails = String(html || "").toLowerCase().match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];
  const h = String(host || "").replace(/^www\./, "");
  for (const e of emails) {
    const [local, dom] = e.split("@");
    if (!h || !(dom === h || dom.endsWith("." + h))) continue;
    for (const o of officers) {
      const parts = nameParts(o); if (parts.length < 2) continue;
      const first = parts[0], last = parts[parts.length - 1];
      if ((last.length >= 4 && local.includes(last)) || (first.length >= 4 && (local === first || local.startsWith(first + ".") || local.startsWith(first + "_"))) || local === first[0] + last) return true;
    }
  }
  return false;
};
export async function verifyWebsite({ website, companyNumber, postcode, addressLine = "", legalName = "", officers = null, homeHtml = "" }) {
  const host = String(website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  if (!host) return { evidence: "" };
  if (!officers) officers = companyNumber ? await companyPeople(companyNumber).catch(() => []) : [];
  let home = homeHtml;
  if (!home) { const r = await get(`https://${host}/`); home = r.status === 0 ? (await get(`http://${host}/`)).html || "" : r.html || ""; }
  // Pages worth reading: the site's own contact/about/team/legal links, then the usual paths if those are few.
  const found = new Set();
  for (const m of String(home || "").matchAll(/href=["']([^"'#?]+)[^"']*["']/gi)) {
    const href = m[1];
    if (!/contact|about|team|people|who-we-are|our-story|meet|terms|privacy|legal|cookie|imprint|company/i.test(href)) continue;
    if (/^https?:/i.test(href) && !new RegExp(`^https?://(www\\.)?${host.replace(/\./g, "\\.")}(/|$)`, "i").test(href)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip)$/i.test(href)) continue;
    found.add(/^https?:/i.test(href) ? href.replace(/^https?:\/\/[^/]+/, "") || "/" : href.startsWith("/") ? href : "/" + href);
    if (found.size >= 8) break;
  }
  for (const pth of ["/contact", "/contact-us", "/about", "/about-us", "/terms", "/privacy-policy", "/privacy"]) if (found.size < 5) found.add(pth);
  const others = await Promise.all([...found].filter((pth) => pth !== "/").slice(0, 8).map(async (pth) => { const r = await get(`https://${host}${pth}`); return r.status === 200 && /html/i.test(r.type || "") ? r.html || "" : ""; }));
  const pages = [home, ...others].filter(Boolean);
  if (!pages.length) return { evidence: "" };
  // The company number settles it either way, so look for it across every page first.
  if (companyNumber) {
    const nums = pages.flatMap((h) => companyNumbersIn(h));
    if (nums.some((n) => sameCompanyNumber(n, companyNumber))) return { evidence: "company number on the site" };
    if (nums.length) return { evidence: "", conflict: `the site gives company number ${nums[0]}` };
  }
  const texts = pages.map(pageText);
  const forms = legalNameForms(legalName);
  if (forms.length && texts.some((t) => forms.some((f) => t.includes(f)))) return { evidence: "exact legal name on the site" };
  const pc = String(postcode || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (pc && texts.some((t) => t.includes(pc) || t.includes(pc.replace(/\s/g, "")))) return { evidence: "registered postcode on the site" };
  const street = String(addressLine || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  if (street.length >= 8 && /\d|\b(unit|suite|house|studio)\b/.test(street) && texts.some((t) => t.includes(street))) return { evidence: "registered street address on the site" };
  if (texts.some((t) => directorNamed(t, officers))) return { evidence: "a director named on the site" };
  if (pages.some((h) => directorEmail(h, host, officers))) return { evidence: "a director's email address on the site" };
  const out = outward(postcode).toLowerCase();
  if (out && texts.some((t) => [...t.matchAll(/\b([a-z]{1,2}\d[a-z\d]?)\s?\d[a-z]{2}\b/g)].some((m) => m[1] === out))) return { evidence: "name and the registered postcode area on the site" };
  return { evidence: "", soft: "name on the site" };
}

// Contact email on the site: mailto links first, then addresses on the same domain.
// Every email address a page gives away, including the ones sites try to hide:
// Cloudflare's email protection (data-cfemail), "name [at] domain", and JSON-LD.
export function emailsIn(html) {
  const found = new Set();
  const add = (e) => { e = String(e || "").trim().toLowerCase().replace(/^mailto:/, "").split("?")[0]; if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) found.add(e); };
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) { try { add(decodeURIComponent(m[1])); } catch { add(m[1]); } }
  for (const m of html.matchAll(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi)) add(m[1]);
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const hex = m[1] || m[2]; if (!hex || hex.length < 4) continue;
    const key = parseInt(hex.slice(0, 2), 16); let out = "";
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    add(out);
  }
  for (const m of html.matchAll(/([a-z0-9._%+-]+)\s*[\[({]\s*at\s*[\])}]\s*([a-z0-9.-]+)\s*[\[({]\s*dot\s*[\])}]\s*([a-z]{2,})/gi)) add(`${m[1]}@${m[2]}.${m[3]}`);
  for (const m of html.matchAll(/([a-z0-9._%+-]+)\s*[\[({]\s*at\s*[\])}]\s*([a-z0-9.-]+\.[a-z]{2,})/gi)) add(`${m[1]}@${m[2]}`);
  for (const m of html.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) add(m[1]);
  return [...found].filter((e) => !/\.(png|jpe?g|gif|svg|webp)$|sentry|wixpress|example\.com|yourdomain|email@|name@|user@|@2x|domain\.com|@email\.com/i.test(e));
}

export async function findEmail(domain, homeHtml) {
  const host = domain.replace(/^www\./, "");
  const pick = (html) => {
    const list = emailsIn(html);
    const own = list.filter((e) => e.endsWith("@" + host) || e.endsWith("." + host));
    const pref = (arr) => arr.find((e) => /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception)@/.test(e)) || arr[0] || "";
    return pref(own) || pref(list);
  };
  let e = pick(homeHtml || "");
  if (e) return e;
  const paths = ["/contact", "/contact-us", "/contact/", "/contact-us/", "/get-in-touch", "/get-in-touch/", "/about", "/about-us/", "/enquiries", "/find-us"];
  const pages = await Promise.all(paths.map((path) => get(`https://${host}${path}`)));
  for (const r of pages) if (r.status === 200 && r.html) { e = pick(r.html); if (e) return e; }
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

// UK phone numbers: tel: links first, then properly formatted numbers in the visible text only
// (scripts, styles and attribute soup produce digit strings that are not phone numbers).
function findPhones(html) {
  const out = new Set();
  const norm = (v) => { const d = v.replace(/\(0\)/, "").replace(/[^\d+]/g, ""); return d.replace(/^\+44/, "0").replace(/^0044/, "0"); };
  const ok = (digits) => /^0[1-9]\d{8,9}$/.test(digits) && !/(\d)\1{4,}/.test(digits) && !/^0(1234567|123456|000)/.test(digits);
  const pretty = (digits) => digits.startsWith("020") ? `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}` : digits.startsWith("07") ? `${digits.slice(0, 5)} ${digits.slice(5)}` : `${digits.slice(0, 5)} ${digits.slice(5)}`;
  for (const m of html.matchAll(/href="tel:([^"]+)"/gi)) { const d = norm(decodeURIComponent(m[1])); if (ok(d)) out.add(pretty(d)); }
  let text = "";
  try { const $ = cheerio.load(html); $("script, style, noscript, template, svg").remove(); text = $("body").text().replace(/\s+/g, " "); } catch { text = ""; }
  for (const m of text.matchAll(/(?<![\d.])(\+44\s?\(?0?\)?\s?\d{2,4}|\(?0\d{2,4}\)?)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/g)) { const d = norm(m[0]); if (ok(d)) out.add(pretty(d)); }
  return [...out].slice(0, 4);
}

// Named people with roles on about/team/contact pages, plus the page's emails and phone numbers.
// Trading address: the UK postcode that appears most across the pages, with the lines before it.
function addressFromPages(pages) {
  const pcCount = new Map(), pcLines = new Map();
  for (const [, html] of pages) {
    if (!html) continue;
    let text = "";
    try { const $ = cheerio.load(html); $("script, style, noscript, template, svg").remove(); text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n"); } catch { continue; }
    for (const m of text.matchAll(/\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/g)) {
      const pc = `${m[1]} ${m[2]}`;
      pcCount.set(pc, (pcCount.get(pc) || 0) + 1);
      if (!pcLines.has(pc)) { const before = text.slice(Math.max(0, m.index - 160), m.index).split(/\n|,/).map((x) => x.trim()).filter((x) => x && x.length < 50 && !/@|http|tel|phone|email|address:?$/i.test(x)); pcLines.set(pc, before.slice(-4)); }
    }
  }
  const topPc = [...pcCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return topPc ? { postcode: topPc, lines: pcLines.get(topPc) || [] } : null;
}
// The trading address alone, for leads scanned before addresses were recorded.
export async function siteAddress(host) {
  const h = String(host || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!h) return null;
  const pages = await Promise.all(["/", "/contact", "/contact-us", "/contact-us/", "/about", "/about-us"].map(async (pth) => { const r = await get(`https://${h}${pth}`); const html = r.status === 0 && pth === "/" ? (await get(`http://${h}/`)).html : r.status === 200 ? r.html : ""; return [pth, html || ""]; }));
  return addressFromPages(pages);
}

async function sitePeople(domain, homeHtml) {
  const host = domain.replace(/^www\./, "");
  const people = [], emails = new Set(), phones = new Set(), links = new Set();
  const home = homeHtml || (await get(`https://${host}/`)).html || "";
  const pages = [["/", home]];
  const paths = ["/about", "/about-us", "/about-us/", "/team", "/our-team", "/our-team/", "/meet-the-team", "/meet-the-team/", "/people", "/our-people", "/staff", "/contact", "/contact-us", "/contact-us/", "/get-in-touch", "/get-in-touch/", "/who-we-are", "/the-team"];
  const fetched = await Promise.all(paths.map(async (pth) => { const r = await get(`https://${host}${pth}`); return r.status === 200 && /html/i.test(r.type || "") ? [pth, r.html] : null; }));
  for (const f of fetched) if (f) pages.push(f);
  const seenHtml = new Set();
  for (const [pth, html] of pages) {
    if (!html || seenHtml.has(html.length)) continue; // same page served under two paths
    seenHtml.add(html.length);
    for (const e of emailsIn(html)) emails.add(e);
    for (const ph of findPhones(html)) phones.add(ph);
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
  const address = addressFromPages(pages);
  const own = [...emails].filter((e) => (e.endsWith("@" + host) || e.endsWith("." + host)) && !/\.(png|jpg|gif|svg|webp)$/.test(e));
  const other = [...emails].filter((e) => !own.includes(e) && !/\.(png|jpg|gif|svg|webp)$|sentry|wixpress|example\.com|yourdomain|email@|name@|user@|wordpress|@2x/i.test(e));
  return { people: people.slice(0, 8), emails: [...own, ...other].slice(0, 10), phones: [...phones].slice(0, 4), linkedin: [...links].slice(0, 6), address };
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

// ---- Hunter.io: named people with roles and verified addresses, when a key is set ----
// Domain Search gives everyone Hunter has for the domain (marketing managers included),
// each with a confidence score; Email Finder guesses a director's address with a score.
// One credit per call, so it runs only for leads worth pitching and results are cached.
export const HUNTER_CAP = Number(process.env.HUNTER_MONTHLY_CAP) || 450;
const hunterKey = () => process.env.HUNTER_API_KEY || "";
export const hunterConfigured = () => Boolean(hunterKey());
async function hunterCall(path, params) {
  const { cacheGet, cacheSet, counterIncr, counterGet } = await import("@/lib/store");
  const ck = `hunter:${path}:${JSON.stringify(params)}`;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const month = `hunter:${new Date().toISOString().slice(0, 7)}`;
  if ((await counterGet(month)) >= HUNTER_CAP) throw new Error(`Hunter monthly cap reached (${HUNTER_CAP}).`);
  await counterIncr(month, 40 * 86400);
  const q = new URLSearchParams({ ...params, api_key: hunterKey() });
  const r = await fetch(`https://api.hunter.io/v2/${path}?${q}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Hunter rejected the API key.");
  if (r.status === 429) throw new Error("Hunter: out of searches for this month.");
  if (!r.ok) throw new Error(j.errors?.[0]?.details || `Hunter error ${r.status}`);
  await cacheSet(ck, j.data || {}, 60 * 86400);
  return j.data || {};
}
// Free: how many addresses Hunter holds for a domain (or a company name). No credit is spent.
export async function hunterCount(host, companyName = "") {
  if (!hunterConfigured() || (!host && !companyName)) return null;
  const { cacheGet, cacheSet } = await import("@/lib/store");
  const ck = `hunter:count:${host || "co:" + companyName.toLowerCase()}`;
  const c = await cacheGet(ck); if (c && typeof c.n === "number") return c.n;
  const q = new URLSearchParams(host ? { domain: host } : { company: companyName.replace(/\s+(ltd|limited|llp|plc)\.?$/i, "") });
  q.set("api_key", hunterKey());
  const r = await fetch(`https://api.hunter.io/v2/email-count?${q}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  const n = Number(j.data?.total) || 0;
  await cacheSet(ck, { n }, 7 * 86400);
  return n;
}
export async function hunterPeople(host, directors = [], companyName = "") {
  const out = [];
  if (!hunterConfigured() || (!host && !companyName)) return out;
  // Nothing on file? Then nothing to pay for.
  const n = await hunterCount(host, companyName).catch(() => null);
  if (n === 0) { out.empty = true; return out; }
  const d = host ? await hunterCall("domain-search", { domain: host, limit: "10" }) : await hunterCall("domain-search", { company: companyName.replace(/\s+(ltd|limited|llp|plc)\.?$/i, ""), limit: "10" });
  if (!host && d.domain) out.foundDomain = String(d.domain).toLowerCase();
  out.organization = String(d.organization || "");
  out.total = Number(d.meta?.results ?? d.total) || n || 0;
  for (const e of d.emails || []) {
    if (!e.value) continue;
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    const role = e.position || (e.department ? cap(e.department) : "") || "Staff";
    const score = Number(e.confidence) || 0;
    out.push({ name: name || e.value.split("@")[0], role, source: "Hunter.io", why: `${e.department ? cap(e.department) + " · " : ""}${score}% confidence${e.verification?.status === "valid" ? ", verified" : ""}${e.linkedin ? "" : ""}`, email: e.value, emailStatus: score >= 70 ? `Hunter.io, ${score}% confidence` : `Hunter.io, only ${score}% confidence`, hunterScore: score, linkedin: e.linkedin || "" });
  }
  // No one on the domain? Ask Hunter for the top director by name.
  if (!out.length && directors.length) {
    const p = directors[0]; const [first, ...rest] = p.name.replace(TITLE_RE, "").split(" "); const last = rest.pop() || "";
    if (first && last) {
      const f = await hunterCall("email-finder", { domain: host, first_name: first, last_name: last });
      if (f.email) out.push({ name: p.name, role: p.role, source: "Companies House + Hunter.io", why: `${p.why}; address from Hunter.io at ${f.score || 0}% confidence`, email: f.email, emailStatus: `Hunter.io, ${f.score || 0}% confidence`, hunterScore: Number(f.score) || 0 });
    }
  }
  return out;
}

// Does the name Hunter (or a site) gives for the organisation look like this company? Shares a distinctive word.
function sameBusiness(orgName, business) {
  const a = words(orgName).filter((x) => x.length > 2 && !GENERIC_WORDS.has(x)), b = words(business).filter((x) => x.length > 2 && !GENERIC_WORDS.has(x));
  if (!a.length || !b.length) return true; // nothing distinctive to compare, give it the benefit of the doubt
  return a.some((x) => b.includes(x)) || b.some((x) => a.includes(x));
}
// Far more people on the domain than a company this size employs: the website is a bigger business with a similar name.
function sizeMismatch(onFile, employees) {
  if (onFile === null || onFile === undefined) return false;
  if (employees !== null && employees !== undefined && employees > 0) return onFile >= 30 && onFile > employees * 2;
  return onFile >= 60;
}

export async function findContacts({ companyNumber, website, business, employees = null, websiteVerified = true, useHunter = false, forceHunter = false, rejectedSites = [] }) {
  const host = String(website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
  let hunterNote = "";
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
  // Hunter.io fills the gaps: named people with roles and scored addresses. It costs a credit,
  // so only when asked for, and only if the free routes (site, Companies House) found nothing usable.
  const freeRoutesFound = people.some((p) => p.email) || site.emails.some((e) => /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception)@/.test(e));
  let hunterUsed = false;
  let hunterDomain = "";
  let websiteDoubt = "";
  // Free check first: if Hunter lists far more people at the domain than this company employs, the website
  // belongs to a bigger business with a similar name. No credit spent, and its staff are not our contacts.
  let hunterOnFile = null;
  if (host && hunterConfigured()) { try { hunterOnFile = await hunterCount(host); } catch {} }
  if (host && sizeMismatch(hunterOnFile, employees)) websiteDoubt = `Website may be wrong: Hunter lists ${hunterOnFile} people at ${host}${employees ? `, but the accounts show ${employees} staff` : ""}. It is probably a bigger company with a similar name. Check it, or mark it as not theirs.`;
  if (host && !websiteVerified && !forceHunter) hunterNote = "Hunter is not used until the website is confirmed as theirs.";
  if (!websiteDoubt && (host || forceHunter) && hunterConfigured() && (forceHunter || (useHunter && !freeRoutesFound && websiteVerified))) {
    try {
      const hp = await hunterPeople(host, people.filter((p) => /Companies House/.test(p.source)), business);
      if (hp.organization && !sameBusiness(hp.organization, business)) {
        websiteDoubt = `Website may be wrong: Hunter has ${host || "that domain"} down as "${hp.organization}", not ${business}. Check it, or mark it as not theirs.`;
        hp.length = 0;
      }
      if (hp.total && sizeMismatch(hp.total, employees) && !websiteDoubt) { websiteDoubt = `Website may be wrong: Hunter lists ${hp.total} people at ${host}${employees ? `, but the accounts show ${employees} staff` : ""}. It is probably a bigger company with a similar name. Check it, or mark it as not theirs.`; hp.length = 0; }
      hunterUsed = !hp.empty;
      if (hp.empty) hunterNote = `Hunter has no addresses on file for ${host || "that company name"} (checked free, no credit spent).`;
      // Looked up by company name and Hunter came back with a domain already marked as not theirs: nothing usable.
      if (hp.foundDomain && rejectedSites.map((x) => String(x).toLowerCase().replace(/^www\./, "")).includes(hp.foundDomain.replace(/^www\./, ""))) { hunterNote = `Hunter only knows ${hp.foundDomain} for this name, which you marked as not theirs.`; hp.length = 0; hp.foundDomain = ""; }
      if (hp.foundDomain) hunterDomain = hp.foundDomain;
      for (const h of hp) {
        const same = people.find((p) => p.name.toLowerCase() === h.name.toLowerCase() || (h.email && (p.email === h.email || p.emailGuess === h.email)));
        if (same) { if (!same.email && h.hunterScore >= 50) { same.email = h.email; same.emailStatus = h.emailStatus; delete same.emailGuess; } if (!/Hunter/.test(same.source)) same.source += " + Hunter.io"; if (h.role && h.role !== "Staff" && !/marketing|director|owner|manager|founder/i.test(same.role)) same.role = h.role; }
        else people.push(h);
      }
    } catch (e) { hunterNote = String(e?.message || e); }
  }
  if (hunterConfigured() && !hunterUsed && hunterOnFile === null) { try { hunterOnFile = await hunterCount(host, host ? "" : business); } catch {} }
  // People Hunter attributed to a doubtful domain are not this company's.
  if (websiteDoubt) for (let i = people.length - 1; i >= 0; i--) if (/^Hunter\.io$/.test(people[i].source)) people.splice(i, 1);
  const q = (p) => encodeURIComponent(`${p.name} ${String(business || "").replace(/\s+(ltd|limited|llp|plc)\.?$/i, "")}`);
  for (const p of people) { p.linkedinSearch = `https://www.linkedin.com/search/results/people/?keywords=${q(p)}`; p.googleSearch = `https://www.google.com/search?q=${q(p)}`; }
  // Rank: marketing and managing roles first, then owners/directors, then the rest.
  const rank = (p) => (/marketing|digital|brand/i.test(p.role) ? 0 : /managing|ceo|founder|owner|proprietor/i.test(p.role) ? 1 : /director|partner|principal|general manager/i.test(p.role) ? 2 : 3);
  people.sort((a, b) => rank(a) - rank(b) || (b.email ? 1 : 0) - (a.email ? 1 : 0) || (b.hunterScore || 0) - (a.hunterScore || 0));
  // A low-confidence Hunter address is a guess, not a verified contact.
  for (const p of people) if (p.email && p.hunterScore !== undefined && p.hunterScore < 50) { p.emailGuess = p.email; delete p.email; p.emailStatus = `Hunter.io guess, ${p.hunterScore}% confidence; unverified`; }
  const generic = site.emails.filter((e) => /^(info|hello|enquiries|enquiry|contact|sales|office|mail|admin|shop|bookings|reception)@/.test(e));
  const channels = [
    ...generic.map((e) => ({ kind: "email", value: e, label: "General inbox (from their site)" })),
    ...site.phones.map((v) => ({ kind: "phone", value: v, label: "Phone (from their site)" })),
    ...site.linkedin.map((v) => ({ kind: "linkedin", value: v, label: /\/company\//.test(v) ? "LinkedIn company page" : "LinkedIn profile linked from their site" })),
  ];
  return { people: people.slice(0, 12), channels, contactsAt: new Date().toISOString(), hunterNote, hunterUsed, hunterDomain, hunterOnFile, websiteDoubt, tradingAddress: site.address || null };
}

// ---- search visibility (SEO) ---------------------------------------------------------
//
// Two searches a customer would actually type: the business name + town, and
// what it does + town ("plumber Teddington"). Where does their site come up?
// Uses the Brave Search API when BRAVE_SEARCH_KEY is set ($5 free credit a month,
// about 1,000 searches), else Google's Programmable Search (whole-web engines are
// no longer offered to new users), else DuckDuckGo's HTML results, which need no
// key but block busy sessions.

const SIC_TERMS = {
  "47110": "convenience store", "47190": "department store", "47210": "greengrocer", "47220": "butcher", "47230": "fishmonger", "47240": "bakery", "47250": "off licence", "47260": "tobacconist", "47290": "food shop", "47410": "computer shop", "47510": "fabric shop", "47520": "hardware shop", "47530": "carpet shop", "47540": "electrical shop", "47590": "furniture shop", "47610": "bookshop", "47620": "newsagent", "47640": "sports shop", "47650": "toy shop", "47710": "clothes shop", "47721": "shoe shop", "47722": "leather goods shop", "47730": "pharmacy", "47750": "beauty shop", "47760": "garden centre", "47770": "jeweller", "47781": "optician", "47782": "photography shop", "47789": "gift shop", "47990": "shop",
  "56101": "restaurant", "56102": "cafe", "56103": "takeaway", "56210": "caterer", "56290": "catering", "56301": "bar", "56302": "pub", "55100": "hotel", "55209": "bed and breakfast",
  "41202": "builder", "43210": "electrician", "43220": "plumber", "43290": "heating engineer", "43310": "plasterer", "43320": "joiner", "43330": "flooring", "43341": "painter and decorator", "43342": "glazier", "43390": "building services", "43910": "roofer", "43990": "builder", "81210": "cleaning company", "81221": "cleaners", "81222": "cleaning", "81223": "window cleaner", "81299": "cleaning", "81300": "landscape gardener", "95110": "computer repair", "95120": "phone repair", "95210": "tv repair", "95220": "appliance repair", "95230": "shoe repair", "95240": "furniture restorer", "95250": "watch repair", "95290": "repair shop", "45200": "garage", "45320": "car parts", "45111": "car dealer", "45112": "car dealer",
  "69101": "solicitor", "69102": "solicitor", "69109": "legal services", "69201": "accountant", "69202": "bookkeeper", "69203": "tax adviser", "70221": "financial adviser", "70229": "business consultant", "71111": "architect", "71112": "architect", "71121": "structural engineer", "71129": "engineering consultant", "71200": "surveyor", "66220": "insurance broker", "66190": "financial adviser", "68310": "estate agent", "68320": "property management", "73110": "advertising agency", "73120": "media agency", "74100": "design studio", "74201": "photographer", "74202": "photographer", "74209": "photographer", "74300": "translator", "74909": "consultant", "78109": "recruitment agency", "78200": "recruitment agency", "82990": "business services",
  "86210": "GP", "86220": "private clinic", "86230": "dentist", "86900": "clinic", "96020": "hairdresser", "96040": "spa", "96090": "beauty salon", "93130": "gym", "93110": "sports club", "93120": "sports club", "93191": "sports club", "93199": "sports club", "75000": "vet",
  "85100": "nursery", "85200": "primary school", "85310": "school", "85320": "college", "85410": "college", "85421": "university", "85422": "university", "85510": "sports coaching", "85520": "music lessons", "85530": "driving school", "85590": "tuition", "85600": "tutor", "88910": "nursery", "90010": "theatre", "90020": "events company", "90030": "artist", "90040": "venue", "91020": "museum", "93210": "activity centre", "93290": "leisure",
  "10710": "bakery", "10720": "bakery", "11050": "brewery", "11010": "distillery", "11020": "winery", "10850": "food producer", "13300": "textile printer", "14190": "clothing maker", "16290": "woodworker", "18129": "printer", "23410": "pottery", "25620": "engineering workshop", "31010": "office furniture", "31020": "kitchen maker", "31090": "furniture maker", "32120": "jewellery maker", "32990": "manufacturer",
};
// What the website says they do beats the SIC code (Flames of Richmond files as "plumbing and heating" but sells fireplaces).
const SITE_TRADES = [
  [/fireplace|fire place|wood ?burn|log ?burn|stove|chimney/, "fireplace shop"], [/air ?con/, "air conditioning installer"], [/boiler|central heating|heating engineer|gas safe/, "heating engineer"],
  [/plumb/, "plumber"], [/electrician|electrical contractor|electrical services|rewir/, "electrician"], [/roof/, "roofer"], [/scaffold/, "scaffolding"], [/locksmith/, "locksmith"],
  [/landscap|garden design|gardener|garden maintenance/, "landscaper"], [/tree surg|arborist/, "tree surgeon"], [/kitchen/, "kitchen showroom"], [/bathroom/, "bathroom showroom"],
  [/carpet|flooring|wood floor/, "flooring shop"], [/window|glazing|double glaz|bifold/, "window company"], [/painter|decorat/, "painter and decorator"], [/plaster/, "plasterer"],
  [/removal|man and van|man with a van/, "removals company"], [/cleaning|cleaners/, "cleaning company"], [/builder|building contractor|extensions|loft conversion|refurbish/, "builder"],
  [/architect/, "architect"], [/interior design/, "interior designer"], [/estate agent|letting|lettings|property sales/, "estate agent"], [/solicitor|law firm|legal/, "solicitor"],
  [/accountan|bookkeep|tax return/, "accountant"], [/mortgage|financial advi/, "financial adviser"], [/insurance broker/, "insurance broker"], [/dentist|dental/, "dentist"],
  [/physio/, "physiotherapist"], [/osteopath/, "osteopath"], [/chiroprac/, "chiropractor"], [/optician|opticians|eye test/, "optician"], [/vet|veterinary/, "vet"], [/pharmacy|chemist/, "pharmacy"],
  [/gym|fitness|personal train/, "gym"], [/yoga|pilates/, "yoga studio"], [/barber/, "barber"], [/hair salon|hairdress|hair studio/, "hairdresser"], [/beauty|nails|aesthetic/, "beauty salon"],
  [/nursery|childcare|pre-?school/, "nursery"], [/tutor|tuition/, "tutor"], [/driving school|driving lessons/, "driving school"], [/restaurant/, "restaurant"], [/caf[eé]|coffee/, "cafe"],
  [/takeaway|pizza|kebab|fish and chips/, "takeaway"], [/pub|public house/, "pub"], [/bakery|baker/, "bakery"], [/butcher/, "butcher"], [/florist|flowers/, "florist"],
  [/car repair|mot test|mot|garage services|servicing and repairs|mechanic/, "garage"], [/car wash|valeting/, "car valeting"], [/taxi|minicab|chauffeur/, "taxi"], [/print/, "printers"],
  [/photograph/, "photographer"], [/wedding/, "wedding venue"], [/event/, "events company"], [/web design|digital agency|marketing agency/, "marketing agency"], [/it support|managed it|it services/, "IT support"],
  [/security|cctv|alarm/, "security company"], [/pest control/, "pest control"], [/drain|drainage/, "drainage company"], [/skip hire/, "skip hire"], [/upholster/, "upholsterer"], [/joiner|carpent|bespoke furniture/, "joiner"],
  [/tiling|tiler|tiles/, "tiler"], [/furniture/, "furniture shop"], [/jewell/, "jeweller"], [/opticians/, "optician"], [/dry clean|laundr/, "dry cleaners"], [/storage/, "self storage"],
];
// The specific niche a site names beats a broad category ("trophy shop" over "sports shop"): a broad term
// matches far too many businesses for the search to mean anything.
const SPECIFIC_TRADES = [
  [/troph|engrav|medals?\b|awards?\b/, "trophy shop"], [/team ?wear|team kit|club kit|kit supplier|printed kit|personalised kit/, "team kit supplier"], [/embroider|screen print|garment print|printed workwear/, "embroidery and printing"],
  [/school ?wear|school uniform/, "school uniform shop"], [/work ?wear|\bppe\b|safety boots/, "workwear supplier"], [/cricket/, "cricket shop"], [/golf/, "golf shop"], [/running shoes|runners|running shop/, "running shop"],
  [/\bbikes?\b|cycling|cycles\b/, "bike shop"], [/swim/, "swimwear shop"], [/angling|fishing tackle/, "fishing tackle shop"], [/football boots|football kit/, "football kit shop"], [/tennis|badminton|squash|racket/, "racket sports shop"],
  [/gym equipment|fitness equipment|home gym/, "gym equipment supplier"], [/martial arts|karate|judo|taekwondo/, "martial arts shop"], [/dance ?wear|ballet/, "dancewear shop"], [/equestrian|saddler|riding wear/, "equestrian shop"],
  [/rugby/, "rugby shop"], [/hockey/, "hockey shop"], [/netball/, "netball shop"], [/skate|scooter/, "skate shop"], [/\bski\b|snowboard/, "ski shop"], [/camping|hiking|outdoor clothing|walking boots/, "outdoor shop"], [/boxing|mma/, "boxing shop"],
  [/wet ?room|walk-in shower/, "wet room installer"], [/loft conversion/, "loft conversion company"], [/extension/, "house extension builder"], [/driveway|resin bound|block paving/, "driveway company"], [/fencing|fence/, "fencing contractor"],
  [/artificial grass|astro ?turf/, "artificial grass installer"], [/tree surg|arborist/, "tree surgeon"], [/underfloor heating/, "underfloor heating installer"], [/heat pump/, "heat pump installer"], [/solar/, "solar panel installer"], [/\bev charg/, "EV charger installer"],
  [/emergency plumber|burst pipe/, "emergency plumber"], [/boiler repair|boiler service/, "boiler repair"], [/gutter/, "gutter cleaning"], [/pressure wash|jet wash/, "pressure washing"], [/end of tenancy/, "end of tenancy cleaning"], [/carpet clean/, "carpet cleaning"], [/oven clean/, "oven cleaning"],
  [/wedding photograph/, "wedding photographer"], [/headshot/, "headshot photographer"], [/wedding cake|celebration cake/, "cake maker"], [/wedding flower/, "wedding florist"], [/bridal/, "bridal shop"], [/tattoo/, "tattoo studio"], [/piercing/, "piercing studio"],
  [/invisalign|braces|orthodont/, "orthodontist"], [/implant/, "dental implants"], [/hygienist/, "dental hygienist"], [/botox|filler|aesthetic/, "aesthetics clinic"], [/laser hair/, "laser hair removal"], [/sports massage/, "sports massage"], [/acupunctur/, "acupuncturist"], [/podiatr|chiropod/, "podiatrist"],
  [/dog groom/, "dog groomer"], [/dog walk/, "dog walker"], [/cattery|dog boarding|kennel/, "pet boarding"], [/conveyanc/, "conveyancing solicitor"], [/family law|divorce/, "family solicitor"], [/employment law/, "employment solicitor"], [/will writ|probate/, "will writing"],
  [/payroll/, "payroll services"], [/\bvat\b|self assessment|tax return/, "tax accountant"], [/mortgage/, "mortgage broker"], [/pension|wealth/, "financial planner"], [/landlord insurance|commercial insurance/, "insurance broker"],
  [/\bmot\b/, "MOT centre"], [/tyres?\b/, "tyre fitter"], [/bodywork|body shop|dent repair/, "car body repair"], [/car detailing|valet/, "car valeting"], [/car hire|van hire/, "van hire"], [/airport transfer/, "airport taxi"],
  [/sushi/, "sushi restaurant"], [/indian restaurant|curry/, "indian restaurant"], [/italian restaurant|pizzeria/, "italian restaurant"], [/thai/, "thai restaurant"], [/fish and chips|chippy/, "fish and chip shop"], [/brunch/, "brunch cafe"], [/coffee roaster/, "coffee roaster"], [/afternoon tea/, "afternoon tea"],
  [/day nursery|preschool|pre-school/, "day nursery"], [/after school club|holiday club/, "holiday club"], [/11\+|eleven plus|gcse|a-level|maths tutor/, "tutor"], [/driving lessons|driving instructor/, "driving instructor"], [/piano lessons|guitar lessons|singing lessons/, "music teacher"],
  [/shopfit|shop fitting/, "shopfitter"], [/office fit|fit-out/, "office fit-out"], [/signage|sign maker|signwrit/, "sign maker"], [/exhibition stand/, "exhibition stands"], [/large format|banner print/, "large format printing"], [/bookkeep/, "bookkeeper"], [/virtual assistant/, "virtual assistant"],
  [/self storage/, "self storage"], [/man and van|man with a van/, "man and van"], [/house clearance/, "house clearance"], [/skip hire/, "skip hire"], [/scaffold/, "scaffolding"], [/asbestos/, "asbestos removal"], [/damp proof/, "damp proofing"], [/basement/, "basement conversion"],
  [/sash window/, "sash window specialist"], [/bi-?fold/, "bifold doors"], [/conservator|orangery/, "conservatory installer"], [/garage door/, "garage doors"], [/shutters|blinds/, "blinds and shutters"], [/curtain/, "curtain maker"], [/upholster/, "upholsterer"], [/french polish|furniture restor/, "furniture restorer"],
  [/stair ?lift|mobility/, "mobility shop"], [/hearing aid/, "hearing aid centre"], [/contact lens/, "optician"], [/bike repair|bicycle repair/, "bike repair"], [/phone repair|screen repair/, "phone repair"], [/computer repair|laptop repair/, "computer repair"], [/key cutting/, "key cutting"],
];
const tradeMatches = (list, t) => { for (const [re, term] of list) if (re.test(t)) return term; return ""; };
export const tradeFromSite = (text, headings = "") => {
  const t = String(text || "").toLowerCase(), h = String(headings || "").toLowerCase();
  return tradeMatches(SPECIFIC_TRADES, `${t} ${h}`) || tradeMatches(SITE_TRADES, t) || tradeMatches(SITE_TRADES, h);
};
export const tradeTerm = (sics, name, siteText = "", headings = "", override = "") => {
  if (override) return String(override).trim();
  const fromSite = tradeFromSite(siteText, headings);
  if (fromSite) return fromSite;
  const fromName = tradeFromSite(name);
  if (fromName) return fromName;
  for (const c of sics || []) if (SIC_TERMS[c]) return SIC_TERMS[c];
  const w = words(name || ""); return w.length > 1 ? w[w.length - 1] : "";
};

// Monthly budget for paid searches: Brave bills overage with no cap, so the app stops at this.
export const SEARCH_CAP = Number(process.env.SEARCH_MONTHLY_CAP) || 900;
export const monthKey = () => `search:${new Date().toISOString().slice(0, 7)}`;
export async function hunterUsage() { const { counterGet } = await import("@/lib/store"); return { used: await counterGet(`hunter:${new Date().toISOString().slice(0, 7)}`), cap: HUNTER_CAP, configured: hunterConfigured() }; }
export async function searchUsage() { const { counterGet } = await import("@/lib/store"); return { used: await counterGet(monthKey()), cap: SEARCH_CAP }; }

async function searchResults(query) {
  const { cacheGet, cacheSet, counterIncr, counterGet } = await import("@/lib/store");
  const brave = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  // Same query again ("plumber Teddington" for every plumber in Teddington) comes from the cache for 30 days.
  const ck = `q:${(brave ? "brave" : "other")}:${query.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const cached = await cacheGet(ck);
  if (cached) return { ...cached, cached: true };
  if (brave) {
    const used = await counterGet(monthKey());
    if (used >= SEARCH_CAP) throw new Error(`Monthly search budget used (${SEARCH_CAP}). Resets on the 1st; raise SEARCH_MONTHLY_CAP in Vercel if you want more.`);
    await counterIncr(monthKey(), 40 * 86400);
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&country=GB&search_lang=en&count=10`, { headers: { accept: "application/json", "X-Subscription-Token": brave }, cache: "no-store" });
    if (r.status === 401 || r.status === 403) throw new Error("Brave Search rejected the key. Check BRAVE_SEARCH_KEY in Vercel.");
    if (r.status === 429) throw new Error("Brave Search is rate-limited or out of credit this month.");
    if (!r.ok) throw new Error(`Brave Search error ${r.status}`);
    const j = await r.json();
    const out = { engine: "Brave", results: (j.web?.results || []).map((i) => ({ url: i.url, title: i.title })) };
    await cacheSet(ck, out, 30 * 86400);
    return out;
  }
  const key = process.env.GOOGLE_CSE_KEY, cx = process.env.GOOGLE_CSE_CX;
  if (key && cx) {
    const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&gl=uk&num=10&q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (r.status === 429) throw new Error("Google search quota used up for today (100 free searches a day).");
    if (!r.ok) throw new Error(`Google search error ${r.status}`);
    const j = await r.json();
    return { engine: "Google", results: (j.items || []).map((i) => ({ url: i.link, title: i.title })) };
  }
  const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=uk-en`);
  if (r.status !== 200) throw new Error(`Search unavailable (${r.status || r.error}). Add BRAVE_SEARCH_KEY (Settings → Connections) for reliable results.`);
  const $ = cheerio.load(r.html || "");
  const results = [];
  $("a.result__a").each((_, a) => {
    let href = $(a).attr("href") || "";
    try { const u = new URL(href, "https://duckduckgo.com"); const real = u.searchParams.get("uddg"); if (real) href = real; } catch {}
    if (/^https?:/.test(href) && !/duckduckgo\.com/.test(href)) results.push({ url: href, title: $(a).text().trim() });
  });
  if (!results.length && /anomaly|bot|captcha/i.test(r.html || "")) throw new Error("DuckDuckGo blocked the search. Add BRAVE_SEARCH_KEY (Settings → Connections) for reliable results.");
  const out = { engine: "DuckDuckGo", results: results.slice(0, 10) };
  if (results.length) await cacheSet(ck, out, 30 * 86400);
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const DIRECTORY_RE = /yell\.com|checkatrade|trustatrader|facebook\.com|instagram\.com|linkedin\.com|yelp|tripadvisor|google\.|bing\.|companieshouse|find-and-update|endole|companycheck|opencorporates|192\.com|thomsonlocal|cylex|scoot|hotfrog|freeindex|bark\.com|rated ?people|mybuilder|nextdoor|wikipedia|businessmagnet|familysearch|ancestry|yellowpages|misterwhat|bizify|touchlocal|localdatasearch|ukbusinessdb|smallbusinessdirectory|companieslist|bizstats|dnb\.com|zoominfo|crunchbase|just-?eat|deliveroo|ubereats|booking\.com|opentable|treatwell|fresha|indeed|reed\.co|glassdoor/i;

// Rank of the business for the two searches, with who beats them.
export async function seoCheck({ business, website, area, sics, companyNumber = "", rejectedSites = [], siteText = "", headings = "", trade: tradeOverride = "" }) {
  const host = String(website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const name = String(business || "").replace(/\s+(ltd|limited|llp|plc)\.?$/i, "");
  const town = String(area || "").split(/[\/(+]/)[0].trim();
  const trade = tradeTerm(sics, name, siteText, headings, tradeOverride);
  // Only the search customers make: the trade in the town. Company-name searches are not run.
  const queries = trade ? [{ kind: "trade", query: `${trade} ${town}`.trim() }] : [];
  const out = { checkedAt: new Date().toISOString(), engine: "", searches: [] };
  try { const { getSetting, setSetting } = await import("@/lib/store"); const seen = (await getSetting("queries-seen")) || {}; let changed = false; for (const q of queries) if (q.kind === "trade" && !seen[q.query.toLowerCase()]) { seen[q.query.toLowerCase()] = new Date().toISOString().slice(0, 10); changed = true; } if (changed) await setSetting("queries-seen", seen); } catch {}
  for (const q of queries) {
    try {
      const { engine, results } = await searchResults(q.query);
      out.engine = engine;
      const idx = host ? results.findIndex((r) => hostOf(r.url) === host || hostOf(r.url).endsWith("." + host)) : -1;
      const ahead = results.slice(0, idx === -1 ? 3 : idx).map((r) => hostOf(r.url)).filter((h) => h && !DIRECTORY_RE.test(h));
      const directoriesOnly = idx === -1 && results.length > 0 && results.slice(0, 3).every((r) => DIRECTORY_RE.test(hostOf(r.url)));
      out.searches.push({ ...q, position: idx === -1 ? null : idx + 1, top: results.slice(0, 5).map((r) => hostOf(r.url)), ahead: [...new Set(ahead)].slice(0, 3), directoriesOnly, results: results.slice(0, 8).map((r) => ({ url: r.url, title: String(r.title || "").slice(0, 100) })) });
    } catch (e) { out.searches.push({ ...q, error: String(e?.message || e) }); }
  }
  // No website yet? If they rank for their trade, that result is theirs: first non-directory result that really mentions them.
  if (!host) {
    const tradeSearch = out.searches.find((x) => x.kind === "trade" && !x.error);
    for (const r of tradeSearch?.results || []) {
      const h = hostOf(r.url);
      if (!h || DIRECTORY_RE.test(h) || rejectedSites.includes(h.replace(/^www\./, ""))) continue;
      const nameWords = words(name).filter((x) => x.length > 3);
      if (!nameWords.some((w) => h.replace(/[^a-z0-9]/g, "").includes(w) || String(r.title || "").toLowerCase().includes(w))) continue;
      const pg = await get(`https://${h}/`);
      const html = pg.status === 0 ? (await get(`http://${h}/`)).html : pg.html;
      if (html && looksLikeTheirs(html, name, "", town, companyNumber)) { out.foundWebsite = h; break; }
    }
  }
  // Monthly searches for the trade query, from Keyword Planner when connected.
  try {
    const { keywordsConfigured, searchVolumes } = await import("@/lib/keywords");
    const tq = out.searches.find((x) => x.kind === "trade" && !x.error);
    if (tq && keywordsConfigured()) { const v = await searchVolumes([tq.query]); if (v[tq.query.toLowerCase()] > 0) tq.volume = v[tq.query.toLowerCase()]; }
  } catch (e) { out.volumeError = String(e?.message || e); }
  const tradeS = out.searches.find((x) => x.kind === "trade");
  out.weak = Boolean(tradeS && !tradeS.error && (tradeS.position === null || tradeS.position > 3));
  out.summary = out.searches.filter((x) => !x.error && x.kind === "trade").map((x) => `"${x.query}": ${x.position ? `#${x.position}` : "not on page 1"}${x.ahead.length ? ` (behind ${x.ahead.join(", ")})` : ""}`).join(" · ") || out.searches.map((x) => x.error).join("; ");
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
  const fonts = [], possibleFonts = [];
  for (const f of rec.fonts || []) {
    const label = issueLabel(f);
    if (label === "Demo Font") fonts.push({ family: f.family, label, detail: "a demo copy installed on the server; demo fonts are for testing only, not live sites", source: f.source || "" });
    else if (label === "Unlicensed Font Source") fonts.push({ family: f.family, label, detail: "loaded from a site that redistributes fonts without a licence", source: f.source || "" });
    else if (f.status === "PROBLEM" || f.status === "CHECK") possibleFonts.push({ family: f.family, label, detail: f.note || "", source: f.source || "" });
  }
  const images = [], possibleImages = [];
  for (const i of rec.images || []) {
    if (!i.flag || /free/i.test(i.flag)) continue;
    const sig = stockLicenceSignal(i);
    if (sig.status === "Possible preview" && /preview file name/i.test(sig.reason)) images.push({ url: i.url, page: i.page || i.pages?.[0] || "", library: i.flag, detail: "the library's watermarked preview file, not a licensed download" });
    else possibleImages.push({ url: i.url, page: i.page || i.pages?.[0] || "", library: i.flag, detail: `${sig.status}${sig.reason ? `: ${sig.reason}` : ""}` });
  }
  // Possible issues, most suspicious first: small previews before "could not check" before "likely licensed".
  const rank = (x) => (/Possible preview/.test(x.detail) ? 0 : /Could not check/.test(x.detail) ? 1 : 2);
  possibleImages.sort((a, b) => rank(a) - rank(b));
  return { fonts: fonts.slice(0, 5), images: images.slice(0, 10), possibleFonts: possibleFonts.slice(0, 3), possibleImages: possibleImages.slice(0, 3), pagesChecked: rec.pagesScanned || rec.pages?.length || 0, checkedAt: new Date().toISOString(), error: rec.status === "UNREACHABLE" ? rec.error || "could not reach the site" : "" };
}

// ---- scoring and copy ----------------------------------------------------------

export function scoreLead(l) {
  // Likelihood: how badly the site lets them down × signs they can and will pay.
  let pts = 0;
  const reasons = [];
  if (/dormant/i.test(l.caveats || "")) return { likelihood: "Low", likelihoodWhy: "Filed as dormant at Companies House, so not trading through this company; nothing to sell to" };
  const sev = { "Dead/broken site": 3, "Parked domain": 3, "No website": 2, "Broken SSL": 3, "Dated template": 2, "Stale copyright": 1, "Low search visibility": 2 }[l.problem] || 0;
  pts += sev;
  if (sev >= 3) reasons.push("site is broken or missing right now, an immediate need");
  else if (l.problem === "Dated template") reasons.push("paying for or stuck on a template is an easy switch pitch");
  else if (l.problem === "Stale copyright") reasons.push(`site untouched for years${l.year ? ` (© ${l.year})` : ""}`);
  else if (l.problem === "Low search visibility") reasons.push("not found for their own trade locally, so that business is going to competitors");
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
export const DRAFT_VERSION = 24;

// Pitch angle and a first-draft email: written as the agency's designer, with
// two or three concrete suggestions, in the house style from the matrix.
// Pages on icldigital.com the emails link to. Editable in Settings → Connections → Email links.
export const DEFAULT_LINKS = { site: "https://icldigital.com/", websites: "https://icldigital.com/services/websites/", videography: "https://icldigital.com/services/videography/", contact: "https://icldigital.com/get-in-touch/" };
// Clients worth name-dropping. "near" lists the towns where a lead will know them.
export const DEFAULT_CLIENTS = [
  // Sunbury-on-Thames, so only places within about a 15-minute drive count as "just down the road".
  { name: "Thames Laundry", url: "https://thameslaundry.co.uk/", town: "Sunbury", near: ["sunbury", "lower sunbury", "upper halliford", "shepperton", "laleham", "littleton", "charlton", "ashford", "feltham", "hanworth", "kempton", "hampton", "hampton hill", "hampton wick", "molesey", "east molesey", "west molesey", "walton", "hersham", "weybridge", "staines", "teddington"] },
  // Based in Clerkenwell (EC1), so never "down the road"; used as the credibility name when nothing local fits.
  { name: "St John Eye Hospital Group", url: "https://www.stjohneyehospital.org/", town: "London", near: [], flagship: true },
];
export const SENDER = { name: "Chris", role: "Lead Designer", agency: "ICL Digital", where: "Richmond" };

export const DEFAULT_SUBJECTS = DEFAULT_SUBJECTS_SHARED;

export function draftOutreach(l, person = null) {
  // One issue, chosen for the person (or for the owner when nobody is chosen yet). The greeting
  // is added when the email is copied or opened, so it matches the day it goes out.
  const subjects = { ...DEFAULT_SUBJECTS, ...(l.links?.subjects || {}) };
  const who = person || (l.contacts || []).find((p) => p.email && p.email === l.emailAddress) || null;
  const issue = pickIssue(l, who || { role: "owner" }, []);
  const d = draftFor(l, who, issue, subjects);
  const pitch = issue ? issue.label : "";
  return { subject: d.subject, pitch, email: d.body, issueId: d.issueId, draftVersion: DRAFT_VERSION };
}

// The website's address beats the registered office (often an accountant). If it is somewhere
// else entirely, say so and stop treating the lead as local.
// The town in a trading address: the last line that is not the postcode, a county or a building/street line.
const COUNTY_RE = /^(greater london|london|surrey|middlesex|west sussex|east sussex|sussex|kent|essex|hertfordshire|herts|berkshire|berks|buckinghamshire|bucks|hampshire|hants|oxfordshire|oxon|england|united kingdom|uk)$/i;
export function townFromAddress(linesOrText, postcode = "") {
  const lines = (Array.isArray(linesOrText) ? linesOrText : String(linesOrText || "").split(/,|\n/)).map((x) => String(x).replace(/\b[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}\b/i, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const pc = String(postcode || "").toLowerCase();
  const rest = lines.filter((x) => x.toLowerCase() !== pc && !COUNTY_RE.test(x) && !/^\d|^(unit|flat|suite|floor|office|studio)\b/i.test(x) && !/\b(road|rd|street|st|lane|ln|avenue|ave|way|drive|close|court|crescent|place|park|terrace|gardens|row|hill|mews|square|house|building|estate|business park|industrial estate)\b\.?$/i.test(x));
  return rest.length ? rest[rest.length - 1] : "";
}

export function applyTradingAddress(lead, addr, caveats) {
  if (!addr?.postcode) return;
  const regOut = outward(lead.postcode), siteOut = outward(addr.postcode);
  lead.tradingPostcode = addr.postcode;
  lead.tradingAddress = [...(addr.lines || []), addr.postcode].join(", ");
  lead.tradingTown = townFromAddress(addr.lines || [], addr.postcode);
  if (regOut && siteOut && regOut !== siteOut) {
    lead.tradesElsewhere = !inOurPatch(addr.postcode);
    const line = `Website gives a different address: ${lead.tradingAddress} (registered office in ${lead.area || lead.postcode || "another area"})${lead.tradesElsewhere ? "; trades outside our area" : ""}`;
    if (caveats && !caveats.some((x) => /different address/i.test(x))) caveats.push(line);
    else if (!caveats && !/different address/i.test(lead.caveats || "")) lead.caveats = [lead.caveats, line].filter(Boolean).join("; ");
  }
}

// Full enrichment of one Companies House candidate. Budgeted so one call stays inside a serverless request.
export async function leadsEnrich(c, { knownSites = new Set(), minAssets = 0 } = {}) {
  const lead = {
    id: c.companyNumber, business: titleCase(c.name), area: c.locality || "", address: c.address || "", postcode: c.postcode || "",
    companyNumber: c.companyNumber, sics: c.sics || [], incorporated: c.incorporated || "",
    website: "", problem: "", problemDetail: "", platform: "", year: 0, title: "",
    netAssets: null, reChange: null, employees: null, accountsDate: "", caveats: "", background: "",
    emailAddress: "", emailNote: "", contactName: "", status: "new", source: "Companies House", addedAt: new Date().toISOString(),
  };
  const officers = c.companyNumber ? await companyPeople(c.companyNumber).catch(() => []) : [];
  let [site, acc] = await Promise.all([c.forcedWebsite ? Promise.resolve({ domain: String(c.forcedWebsite).toLowerCase(), evidence: "confirmed by you", tried: [] }) : findWebsite({ ...c, officers }), accountsFacts(c.companyNumber).catch((e) => ({ caveat: String(e?.message || e) }))]);
  // Too small to pursue: record the facts and stop before any paid search or contact lookup.
  const tooSmall = minAssets > 0 && acc.netAssets !== null && acc.netAssets !== undefined && acc.netAssets < minAssets;
  // Second route when the name-guess finds nothing: a web search for the name + town,
  // taking the first result that is their own site (not a directory) and really mentions them.
  // (Web searches are not spent here: the search step runs last, only for qualified leads.)
  Object.assign(lead, { netAssets: acc.netAssets ?? null, reChange: acc.reChange ?? null, employees: acc.employees ?? null, accountsDate: acc.accountsDate || "", accountsNextDue: acc.accountsNextDue || "", accountsOverdue: !!acc.accountsOverdue });
  const caveats = [];
  if (acc.caveat) caveats.push(acc.caveat);
  if (acc.netAssetsPrev !== null && acc.netAssetsPrev !== undefined && acc.netAssets !== null && Math.abs(acc.netAssets - acc.netAssetsPrev) > Math.abs(acc.netAssets) * 0.5) caveats.push("Big year-on-year swing in net assets; check the accounts");
  if (site.domain) {
    lead.website = site.domain;
    lead.websiteEvidence = site.evidence || "";
    lead.websiteVerified = HARD_EVIDENCE.includes(site.evidence) ? site.evidence : "";
    // Not settled by the homepage alone? Read the contact, about and legal pages now, so the lead arrives
    // verified or flagged rather than pending. Skipped for companies under the size floor.
    if (!lead.websiteVerified && !site.parked && !tooSmall && !/dormant/i.test(acc.caveat || "")) {
      try {
        const v = await verifyWebsite({ website: site.domain, companyNumber: c.companyNumber, postcode: c.postcode, addressLine: String(c.address || "").split(", ")[0], legalName: c.name, officers, homeHtml: site.html });
        if (v.evidence) lead.websiteVerified = v.evidence;
        else if (v.conflict) { lead.websiteDoubt = `Website may be wrong: ${v.conflict}, not ${c.companyNumber}. Check it, or mark it as not theirs.`; caveats.push("Website gives a different company number"); }
      } catch {}
    }
    if (knownSites.has(site.domain.replace(/^www\./, ""))) { lead.status = "not-pursuing"; caveats.push("Already a client"); }
    const w = site.parked ? { problem: "Parked domain", detail: "Domain shows a parking page; there is no site.", siteOk: false } : await checkWebsite(site.domain);
    Object.assign(lead, { problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "", siteUrl: w.siteUrl || "", siteDescription: w.description || "", siteHeadings: w.headings || "" });
    if (w.caveat) caveats.push(w.caveat);
    if (!site.parked && w.status) lead.emailAddress = await findEmail(site.domain, "").catch(() => "");
  } else {
    lead.problem = "No website";
    lead.problemDetail = `No site found under ${site.tried.length} likely domain names. Verify by searching.`;
    caveats.push("No website found by name; could trade under another name");
  }
  if (!lead.emailAddress) lead.emailNote = lead.website ? "Not found on the site" : "No site to take it from";
  // Contact lookups only for leads we would actually pitch: a problem to talk about, big
  // enough to pay, and not already a client.
  const dormant = /dormant/i.test(acc.caveat || "");
  if (dormant) lead.status = "not-pursuing";
  const viable = !!lead.problem && !tooSmall && !dormant && lead.status !== "not-pursuing";
  if (viable) {
    try {
      const provisional = scoreLead({ ...lead, caveats: caveats.join("; "), brandLed: isBrandLed(c.sics) }).likelihood;
      const ct = await findContacts({ companyNumber: c.companyNumber, website: lead.website, business: lead.business, employees: lead.employees, websiteVerified: !lead.website || !!lead.websiteVerified, useHunter: provisional === "High" && !c.hunterTried });
      if (ct.websiteDoubt) { lead.websiteDoubt = ct.websiteDoubt; caveats.push("Website may belong to a bigger company with a similar name"); }
      // The contact pages can settle the website too: a director named there, or the registered postcode.
      if (lead.website && !lead.websiteVerified && !ct.websiteDoubt) {
        if (ct.people.some((p) => /Website/.test(p.source || "") && /Companies House/.test(p.source || ""))) lead.websiteVerified = "a director named on the site";
        else if (ct.tradingAddress?.postcode && c.postcode && ct.tradingAddress.postcode.replace(/\s+/g, "").toLowerCase() === String(c.postcode).replace(/\s+/g, "").toLowerCase()) lead.websiteVerified = "registered postcode on the site";
      }
      lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; lead.contactsTried = true; if (ct.hunterUsed) lead.hunterTried = true;
      applyTradingAddress(lead, ct.tradingAddress, caveats);
      const best = ct.people.find((p) => p.email) || null;
      if (best) { lead.emailAddress = best.email; lead.contactName = firstNameOf(best.name); lead.emailNote = ""; }
    } catch {}
  }
  if (tooSmall) { lead.status = "not-pursuing"; caveats.push(`Net assets under £${minAssets.toLocaleString("en-GB")}`); }
  lead.caveats = caveats.join("; ");
  lead.brandLed = isBrandLed(c.sics);
  const siteTrade = lead.website ? tradeFromSite(`${lead.title || ""} ${lead.siteDescription || ""}`, lead.siteHeadings || "") : "";
  lead.trade = tradeTerm(c.sics, c.name, `${lead.title || ""} ${lead.siteDescription || ""}`, lead.siteHeadings || "", c.tradeOverride || "");
  lead.whatTheyDo = siteTrade && siteTrade !== (SIC_TERMS[(c.sics || []).find((x) => SIC_TERMS[x])] || "") ? `${cap(siteTrade)} (from their site) · ${sicDescription(c.sics)}` : sicDescription(c.sics);
  if (lead.employees) lead.background = `${plural(lead.employees, "staff")}, est. ${(c.incorporated || "").slice(0, 4)}`;
  else if (c.incorporated) lead.background = `Est. ${c.incorporated.slice(0, 4)}`;
  if (lead.problem) {
    Object.assign(lead, scoreLead(lead));
    const d = draftOutreach({ ...lead, links: c.links });
    lead.subject = d.subject; lead.pitch = d.pitch; lead.email = d.email; lead.issueId = d.issueId; lead.draftVersion = d.draftVersion;
    if (lead.status === "not-pursuing") { /* already a client or too small */ }
    else if (!lead.emailAddress) { lead.contactUnverified = true; lead.status = "no-contact"; }
    else lead.status = lead.likelihood === "Low" ? "new" : "qualified";
  } else {
    lead.likelihood = "Low"; lead.likelihoodWhy = "Site is current; no outreach planned"; lead.status = "not-pursuing";
  }
  return lead;
}

// Re-run every automated part of an existing lead with the current rules,
// keeping what a person wrote: status, notes, contact name, a hand-typed address.
export async function leadsRefresh(l, { knownSites = new Set() } = {}) {
  const keep = { status: l.status, notes: l.notes, notesLog: l.notesLog, contactName: l.contactName, rejectedSites: l.rejectedSites, tradeOverride: l.tradeOverride, ...(l.websiteConfirmed && l.website ? { websiteVerified: l.websiteVerified || "confirmed by you", websiteConfirmed: true } : {}), noVideoPitch: l.noVideoPitch, addedAt: l.addedAt, source: l.source, background: l.background, manualEmail: l.manualEmail, hunterTried: l.hunterTried, contacts: l.contacts, channels: l.channels, contactsAt: l.contactsAt, contactsTried: l.contactsTried };
  const fromCH = !!l.companyNumber && l.source !== "Client Matrix v4.1";
  const company = { companyNumber: l.companyNumber, name: l.business, status: "active", type: "ltd", incorporated: l.incorporated || "", sics: l.sics || [], locality: l.area || "", postcode: l.postcode || "", address: l.address || "", links: l.links, hunterTried: !!l.hunterTried, rejectedSites: l.rejectedSites || [], forcedWebsite: l.website && l.websiteConfirmed ? l.website : "", tradeOverride: l.tradeOverride || "" };
  let lead;
  if (fromCH) {
    lead = await leadsEnrich(company, { knownSites });
  } else {
    lead = { ...l };
    if (l.website) { const w = await checkWebsite(l.website); Object.assign(lead, { problem: w.problem || l.problem, problemDetail: w.problem ? w.detail : l.problemDetail, platform: w.platform || "", year: w.year || l.year || 0, title: w.title || "", siteUrl: w.siteUrl || "" }); }
    try { const ct = await findContacts({ companyNumber: l.companyNumber, website: l.website, business: l.business, employees: l.employees, websiteVerified: websiteIsVerified(l) }); if (ct.websiteDoubt) lead.websiteDoubt = ct.websiteDoubt; lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; const best = ct.people.find((p) => p.email); if (best && !l.emailAddress) { lead.emailAddress = best.email; lead.contactName = firstNameOf(l.contactName) || firstNameOf(best.name); } } catch {}
    if (lead.problem) { Object.assign(lead, scoreLead(lead)); const d = draftOutreach({ ...lead, contactName: keep.contactName || lead.contactName, links: l.links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, issueId: d.issueId, draftVersion: d.draftVersion }); }
  }
  if (!lead.emailAddress && l.emailAddress) lead.emailAddress = l.emailAddress;
  // If the website changed (a wrong match thrown out, or a new one found), contacts, drafts and the
  // address that came from the old site go with it; otherwise a fresh lookup that found fewer people
  // than before should not throw away what we had (Hunter results included).
  const siteChanged = String(lead.website || "").toLowerCase() !== String(l.website || "").toLowerCase();
  if (siteChanged) { delete keep.contacts; delete keep.channels; delete keep.contactsAt; delete keep.hunterTried; delete keep.contactName; lead.emailAddress = lead.emailAddress && lead.emailAddress.endsWith("@" + String(l.website || "").replace(/^www\./, "")) ? "" : lead.emailAddress; lead.drafts = {}; lead.emailEdited = false; if (!lead.emailAddress) { lead.contactUnverified = true; } }
  else if ((lead.contacts || []).length < (keep.contacts || []).length) { lead.contacts = keep.contacts; lead.channels = keep.channels || lead.channels; lead.contactsAt = keep.contactsAt || lead.contactsAt; }
  delete keep.contacts; delete keep.channels; delete keep.contactsAt;
  Object.assign(lead, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined && v !== "")));
  const autoParked = l.status === "not-pursuing" && (l.contactUnverified || /site is current|no website|different business|not found by name/i.test(`${l.likelihoodWhy || ""} ${l.caveats || ""}`));
  if (lead.problem && (["new", "qualified", "no-contact"].includes(lead.status) || autoParked)) { if (lead.emailAddress) { lead.status = lead.likelihood === "Low" ? "new" : "qualified"; lead.contactUnverified = false; } else { lead.contactUnverified = true; lead.status = parkStatus({ ...lead, caveats: [lead.caveats, l.caveats].filter(Boolean).join("; ") }); } }
  // Nothing left to pitch (site now current, no licence risk): park it unless a conversation is already under way.
  if (!lead.problem && ["new", "qualified", "no-contact"].includes(lead.status)) { lead.status = "not-pursuing"; lead.likelihood = "Low"; lead.likelihoodWhy = "Site is current; no outreach planned"; }
  lead.refreshedAt = new Date().toISOString();
  delete lead.links;
  return lead;
}

const plural = (n, w) => `${n} ${w}`;
function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, pre, c) => pre + c.toUpperCase()).replace(/\bO'([a-z])/g, (m, c) => "O'" + c.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => "Mc" + c.toUpperCase()).replace(/\b(Ltd|Llp|Plc)\b/g, (m) => ({ Ltd: "Ltd", Llp: "LLP", Plc: "PLC" }[m])).replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of");
}

export { LEAD_STATUSES, PROBLEMS } from "@/lib/leadsShared";
import { parkStatus, pickIssue, draftFor, DEFAULT_SUBJECTS_SHARED, sicDescription, firstNameOf, HARD_EVIDENCE, websiteIsVerified } from "@/lib/leadsShared";
export { HARD_EVIDENCE, websiteIsVerified };
