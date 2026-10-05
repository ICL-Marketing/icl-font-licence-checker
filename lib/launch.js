/**
 * Launch checks (server side). Three steps, each one short request so the
 * browser can drive a full-site check inside serverless time limits:
 *   launchStart(url)        site-level facts: SSL, http->https, robots.txt, sitemap, DNS
 *   launchPages(url, urls)  per-page facts: titles, descriptions, alt tags, mixed content, tracking…
 *   checkUrls(urls)         status (and size) of links and images
 */

import * as cheerio from "cheerio";
import tls from "node:tls";
import dns from "node:dns/promises";
import { detectPlatform } from "@/lib/scanner";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ICL-LaunchCheck";
const TIMEOUT_MS = 15000;
export const MAX_PAGES = 500;
const SKIP_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json|ico|woff2?|ttf|otf)(\?|$)|\/wp-json\/|\/feed\/?$|\/wp-admin|\/wp-login|\/xmlrpc|\?(s|replytocom|add-to-cart)=/i;

async function fetchUrl(url, { method = "GET", maxBytes = 3_000_000, redirect = "follow" } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method, headers: { "user-agent": UA, accept: "*/*" }, redirect, signal: ctrl.signal, cache: "no-store" });
    const ms = Date.now() - started;
    const buf = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    return {
      status: r.status, url: r.url || url, ms, redirected: r.redirected,
      type: r.headers.get("content-type") || "", length: Number(r.headers.get("content-length")) || buf.length,
      robotsHeader: r.headers.get("x-robots-tag") || "", location: r.headers.get("location") || "",
      body: buf.subarray(0, maxBytes),
    };
  } catch (e) {
    return { status: 0, url, ms: Date.now() - started, error: e?.cause?.code || e?.name || String(e?.message || e), body: Buffer.alloc(0), type: "" };
  } finally {
    clearTimeout(t);
  }
}

export function parseStart(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".") && u.hostname !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}
const hostKey = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
function sameSite(u, host) {
  try { return hostKey(new URL(u).host) === hostKey(host); } catch { return false; }
}
function isPage(u, host) {
  return /^https?:/.test(u) && sameSite(u, host) && !SKIP_RE.test(u);
}
const abs = (base, u) => { try { return new URL(u, base).href; } catch { return null; } };

// Certificate details straight from the TLS handshake.
function certInfo(hostname, port = 443) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 10000 }, () => {
      const c = sock.getPeerCertificate();
      const out = {
        valid: sock.authorized, error: sock.authorizationError ? String(sock.authorizationError) : "",
        issuer: c?.issuer?.O || c?.issuer?.CN || "", validTo: c?.valid_to || "",
        daysLeft: c?.valid_to ? Math.floor((new Date(c.valid_to) - Date.now()) / 86400000) : null,
      };
      sock.end();
      resolve(out);
    });
    sock.on("error", (e) => resolve({ valid: false, error: e?.code || String(e?.message || e) }));
    sock.on("timeout", () => { sock.destroy(); resolve({ valid: false, error: "Timed out" }); });
  });
}

// robots.txt: does it block the whole site for all crawlers or Googlebot?
function robotsBlocksAll(txt) {
  const groups = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) cur.rules.push([k, v]);
  }
  const blocked = [];
  for (const g of groups) {
    if (!g.agents.some((a) => a === "*" || a.includes("googlebot") || a.includes("bingbot"))) continue;
    const disallowAll = g.rules.some(([k, v]) => k === "disallow" && (v === "/" || v === "/*"));
    const allowRoot = g.rules.some(([k, v]) => k === "allow" && (v === "/" || v === "/$"));
    if (disallowAll && !allowRoot) blocked.push(g.agents.join(", "));
  }
  return blocked;
}

async function readSitemaps(origin, robotsTxt) {
  const roots = [];
  for (const m of robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.push(m[1].trim());
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    const u = abs(origin, p);
    if (!roots.includes(u)) roots.push(u);
  }
  const files = [];
  const urls = new Set();
  const seen = new Set();
  const queue = [...roots];
  while (queue.length && seen.size < 40 && urls.size < 5000) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await fetchUrl(u, { maxBytes: 6_000_000 });
    if (!r.status || r.status >= 400) continue;
    const xml = r.body.toString("utf8");
    if (!/<(urlset|sitemapindex)/i.test(xml)) continue;
    files.push(r.url);
    const isIndex = /<sitemapindex/i.test(xml);
    for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)/gi)) {
      const loc = m[1].replace(/&amp;/g, "&");
      if (isIndex) queue.push(loc);
      else urls.add(loc.split("#")[0]);
      if (urls.size >= 5000) break;
    }
  }
  return { files, urls: [...urls] };
}

export async function launchStart(input) {
  const start = parseStart(input);
  if (!start) return { error: "Enter a valid website address." };
  const host = start.host;
  const httpsHome = `https://${host}/`;
  const home = await fetchUrl(start.protocol === "http:" ? start.href : (start.pathname === "/" ? httpsHome : start.href));
  if (!home.status) {
    // HTTPS failed outright: try plain http so the report can still say why.
    const plain = await fetchUrl(`http://${host}/`);
    if (!plain.status) return { error: `Could not reach the site (${home.error || "no response"}).` };
  }
  const finalUrl = home.url || httpsHome;
  const origin = new URL(finalUrl).origin;
  const finalHost = new URL(finalUrl).host;

  const [cert, httpHop, robots, mx] = await Promise.all([
    certInfo(new URL(httpsHome).hostname, Number(new URL(httpsHome).port) || 443),
    fetchUrl(`http://${host}/`, { redirect: "manual" }),
    fetchUrl(abs(origin, "/robots.txt")),
    dns.resolveMx(hostKey(host).split(":")[0]).catch(() => []),
  ]);
  // Follow the http version fully to see where it ends up.
  const httpFinal = await fetchUrl(`http://${host}/`);

  const robotsTxt = robots.status && robots.status < 400 && !/html/i.test(robots.type) ? robots.body.toString("utf8").slice(0, 100_000) : "";
  const homeHtml = home.status && /html/i.test(home.type) ? home.body.toString("utf8") : "";
  const $ = cheerio.load(homeHtml || "<html></html>");
  const metaRobots = ($('meta[name="robots"]').attr("content") || "") + " " + ($('meta[name="googlebot"]').attr("content") || "");

  const sm = await readSitemaps(origin, robotsTxt);
  const finalHostKey = hostKey(finalHost);
  const pages = sm.urls.filter((u) => isPage(u, finalHost));
  const offSite = sm.urls.filter((u) => !sameSite(u, finalHost)).slice(0, 50);
  const queue = [...new Set([finalUrl, ...pages])].slice(0, MAX_PAGES);

  return {
    input: start.href, host: finalHostKey, origin, finalUrl,
    homeStatus: home.status, homeMs: home.ms, homeBytes: home.body.length,
    platform: detectPlatform(homeHtml),
    https: { ok: finalUrl.startsWith("https://") && home.status > 0 && home.status < 400, cert },
    httpRedirect: { status: httpHop.status, location: httpHop.location, finalUrl: httpFinal.url, toHttps: (httpFinal.url || "").startsWith("https://") },
    robots: {
      status: robots.status, found: !!robotsTxt, blockedFor: robotsTxt ? robotsBlocksAll(robotsTxt) : [],
      text: robotsTxt.slice(0, 3000),
      homeNoindex: /noindex/i.test(metaRobots) || /noindex/i.test(home.robotsHeader || ""),
      homeRobotsMeta: metaRobots.trim(), homeRobotsHeader: home.robotsHeader || "",
    },
    sitemap: { files: sm.files, count: sm.urls.length, urls: sm.urls.slice(0, 2000), offSite },
    mx: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).slice(0, 5),
    pageQueue: queue,
    pagesTotal: Math.min(Math.max(queue.length, 1), MAX_PAGES),
    capped: pages.length + 1 > MAX_PAGES,
    hasSitemap: sm.files.length > 0,
    scannedAt: new Date().toISOString(),
  };
}

const TRACKERS = [
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents|fbq\(\s*['"]init/i],
  ["LinkedIn Insight", /snap\.licdn\.com|_linkedin_partner_id/i],
  ["Hotjar", /static\.hotjar\.com|hotjar\.com\/c\/hotjar/i],
  ["Microsoft Clarity", /clarity\.ms\/tag/i],
  ["TikTok Pixel", /analytics\.tiktok\.com/i],
  ["Microsoft Ads (UET)", /bat\.bing\.com/i],
  ["HubSpot", /js\.hs-scripts\.com|js\.hs-analytics\.net/i],
  ["Google Ads", /AW-\d{6,}/],
  ["Matomo", /matomo\.js|piwik\.js/i],
  ["Leadfeeder / Dealfront", /lftracker|leadfeeder/i],
  ["Lead Forensics", /leadforensics|lf-tracker|secure\.\w+\.com\/js\/\d+\.js/i],
  ["Pinterest Tag", /s\.pinimg\.com\/ct\/core\.js|pintrk\(/i],
  ["X (Twitter) Pixel", /static\.ads-twitter\.com/i],
];
const FORM_TOOLS = [
  ["Gravity Forms", /gform_wrapper|gravityforms/i], ["Contact Form 7", /wpcf7/i], ["WPForms", /wpforms/i],
  ["Ninja Forms", /nf-form|ninja-forms/i], ["Formidable", /frm_forms|formidable/i], ["Elementor form", /elementor-form/i],
  ["HubSpot form", /hs-form|hbspt\.forms/i], ["Fluent Forms", /fluentform/i],
];
const PLACEHOLDER_RE = /\b(lorem ipsum|dolor sit amet|consectetur adipiscing|just another wordpress site|hello world!|sample page|this is an example page|your (text|title|content) here|insert (text|content) here|add your (text|content)|click here to edit|placeholder text|coming soon|tbc|tbd|xxx+)\b/gi;

function pageFacts(url, r) {
  const html = r.body.toString("utf8");
  const $ = cheerio.load(html);
  const https = r.url.startsWith("https://");
  const meta = (n) => ($(`meta[name="${n}"]`).attr("content") || "").trim();

  const images = [];
  const missingAlt = [];
  let emptyAlt = 0;
  for (const el of $("img").toArray()) {
    const t = $(el);
    const src = t.attr("src") || t.attr("data-src") || t.attr("data-lazy-src") || (t.attr("srcset") || "").split(/\s+/)[0] || "";
    const u = src && !src.startsWith("data:") ? abs(r.url, src) : null;
    if (u) images.push(u);
    // Tracking pixels and spacer images are not content images.
    if (/facebook\.com\/tr|bat\.bing|linkedin\.com\/collect|google-analytics|doubleclick/i.test(src)) continue;
    if (t.attr("alt") === undefined) missingAlt.push(u || "(inline image)");
    else if (!t.attr("alt").trim() && t.attr("role") !== "presentation" && t.attr("aria-hidden") !== "true") emptyAlt++;
  }

  const mixed = [];
  if (https) {
    const check = (v) => { if (v && /^http:\/\//i.test(v.trim())) mixed.push(v.trim()); };
    $("img, script, iframe, source, video, audio, embed, track").each((_, el) => { check($(el).attr("src")); });
    $("img, source").each((_, el) => { for (const p of ($(el).attr("srcset") || "").split(",")) check(p.trim().split(/\s+/)[0]); });
    $('link[rel~="stylesheet"], link[rel~="icon"], link[rel~="preload"]').each((_, el) => check($(el).attr("href")));
    $("form[action]").each((_, el) => check($(el).attr("action")));
    for (const m of html.matchAll(/url\(\s*['"]?(http:\/\/[^'")]+)/gi)) check(m[1]);
  }

  const links = [];
  for (const a of $("a[href]").toArray()) {
    const href = ($(a).attr("href") || "").trim();
    if (!href || /^(mailto|tel|javascript|sms|whatsapp):|^#/i.test(href)) continue;
    const l = abs(r.url, href)?.split("#")[0];
    if (l) links.push(l);
  }

  const forms = $("form").toArray().filter((f) => {
    const t = $(f);
    return !(t.attr("role") === "search" || /search/i.test(t.attr("class") || "") || t.find('input[name="s"]').length);
  }).length;
  const formTools = FORM_TOOLS.filter(([, re]) => re.test(html)).map(([n]) => n);

  const ga = [...new Set([...html.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)].map((m) => m[1]))].slice(0, 5);
  const ua = [...new Set([...html.matchAll(/\b(UA-\d{4,10}-\d{1,4})\b/g)].map((m) => m[1]))].slice(0, 5);
  const gtm = [...new Set([...html.matchAll(/\b(GTM-[A-Z0-9]{4,10})\b/g)].map((m) => m[1]))].slice(0, 5);
  const gaLoader = /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(analytics|ga)\.js|gtag\(\s*['"]config/i.test(html);
  const trackers = TRACKERS.filter(([, re]) => re.test(html)).map(([n]) => n);

  // Placeholder text in the visible copy only.
  $("script, style, noscript, svg, template").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  const placeholders = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const i = m.index;
    placeholders.push(text.slice(Math.max(0, i - 40), i + m[0].length + 40).trim());
    if (placeholders.length >= 5) break;
  }

  return {
    url, finalUrl: r.url, status: r.status, ms: r.ms, bytes: r.body.length,
    title: $("title").first().text().trim().slice(0, 200),
    description: meta("description").slice(0, 320),
    noindex: /noindex/i.test(meta("robots") + " " + (r.robotsHeader || "")),
    canonical: $('link[rel="canonical"]').attr("href") || "",
    h1: $("h1").length,
    lang: $("html").attr("lang") || "",
    viewport: meta("viewport"),
    imgCount: images.length, missingAlt: missingAlt.slice(0, 15), missingAltCount: missingAlt.length, emptyAlt,
    images: [...new Set(images)].slice(0, 150),
    mixed: [...new Set(mixed)].slice(0, 15),
    links: [...new Set(links)].slice(0, 400),
    forms, formTools, ga, ua, gtm, gaLoader, trackers, placeholders,
  };
}

export async function launchPages(urls, { deadlineMs = 40_000 } = {}) {
  const started = Date.now();
  const queue = [...urls];
  const pages = [];
  const remaining = [];
  async function worker() {
    while (queue.length) {
      if (Date.now() - started > deadlineMs) { remaining.push(...queue.splice(0)); return; }
      const u = queue.shift();
      const r = await fetchUrl(u);
      if (!r.status || r.status >= 400 || !/html/i.test(r.type)) {
        pages.push({ url: u, finalUrl: r.url, status: r.status, error: r.error || "", notHtml: !!r.status && r.status < 400 });
        continue;
      }
      try { pages.push(pageFacts(u, r)); } catch (e) { pages.push({ url: u, status: r.status, error: String(e?.message || e) }); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { pages, remaining };
}

// Status of links and images. HEAD first, GET when a server refuses HEAD.
export async function checkUrls(urls, { deadlineMs = 40_000 } = {}) {
  const started = Date.now();
  const queue = [...urls];
  const out = {};
  const remaining = [];
  async function worker() {
    while (queue.length) {
      if (Date.now() - started > deadlineMs) { remaining.push(...queue.splice(0)); return; }
      const u = queue.shift();
      let r = await fetchUrl(u, { method: "HEAD" });
      if (!r.status || r.status === 405 || r.status === 403 || r.status === 501 || (r.status < 400 && !r.length)) {
        const g = await fetchUrl(u, { maxBytes: 8_000_000 });
        if (g.status) r = g;
      }
      out[u] = { status: r.status, bytes: r.length || 0, type: (r.type || "").split(";")[0], error: r.error || "" };
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return { results: out, remaining };
}
