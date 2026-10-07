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
import fs from "node:fs";
import path from "node:path";
import nspell from "nspell";
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

// British English spell checker, loaded once per server instance.
let speller = null;
function getSpeller() {
  if (speller !== null) return speller;
  try {
    const dir = path.join(process.cwd(), "node_modules", "dictionary-en-gb");
    speller = nspell({ aff: fs.readFileSync(path.join(dir, "index.aff")), dic: fs.readFileSync(path.join(dir, "index.dic")) });
  } catch {
    speller = false;
  }
  return speller;
}
// Common web / business words the dictionary lacks.
const EXTRA_WORDS = new Set(("accessibility analytics automations backlink backlinks benchmarking blog blogs blogging bespoke branding cashflow chatbot chatbots checkout cms crm cyber dashboard dashboards ecommerce email emails favicon fintech freelancer freelancers geotargeting hashtag hashtags homepage hosting implementer implementers infographic infographics integrations keyword keywords lifecycle livestream login logins logout merchantability microsite microsites mobile-first multichannel onboarding onsite offsite omnichannel optimisation optimise optimised optimising pagespeed paywall podcast podcasts popup popups pseudonymise pseudonymised remarketing retargeting rollout rollouts scalable scalability screenshot screenshots signup signups sitemap sitemaps smartphone smartphones startup startups subdomain subdomains timeframe timeframes toolkit toolkits touchpoint touchpoints upsell upselling uptime username usernames videography videographer webinar webinars webmaster webpage webpages website websites whitepaper whitepapers wifi wireframe wireframes workflow workflows wysiwyg " +
  // Real words (mostly UK spellings and Latin plurals) the dictionary misses.
  "aspirational impactful transferrable transferable annum licensor licensors licensee licensees syllabi syllabus curricula alumni alumnus criteria focusses focussed focussing inclusivity upcycle upcycled upcycling upcycler toile toiles ordinator ordinators ordinating ordinate ordination civilization civilizations wellbeing signposting signposted learnings deliverables mentee mentees apprenticeships employability enrol enrolment enrolments enrolling practise practised practising programme programmes centre centres fulfil fulfilment judgement judgements acknowledgement acknowledgements artefact artefacts aluminium analyse analysed analysing catalogue catalogues licence licences cheque cheques grey tyre tyres kerb kerbs mould moulds moulded plough storey storeys sulphur whisky draught pyjamas aeroplane skilful wilful instalment instalments jewellery manoeuvre manoeuvres manoeuvring"
).split(" "));

// Lower-case words the dictionary doesn't know. Skips capitalised words (names,
// brands, places), words that are two dictionary words joined (cashflow), plain
// inflections of known words (automations), and words that appear in the site's
// own addresses (brand names in URLs and emails).
export function suspectWords(text, knownFromUrls) {
  const sp = getSpeller();
  if (!sp) return [];
  const ok = (w) => sp.correct(w) || sp.correct(w.toLowerCase()) || EXTRA_WORDS.has(w.toLowerCase()) || knownFromUrls.has(w.toLowerCase());
  const okish = (w) => {
    if (ok(w)) return true;
    const l = w.toLowerCase();
    if (/iz(e|es|ed|ing|ation|ations)$/.test(l) && ok(l.replace(/iz/, "is"))) return true; // -ize spellings are also correct UK English
    if (/al$|ful$|ity$|ness$|ment$|ous$|ive$|ism$|ist$/.test(l)) { for (const re of [/al$/, /ful$/, /ity$/, /ness$/, /ment$/, /ous$/, /ive$/, /ism$/, /ist$/]) { if (re.test(l)) { const b = l.replace(re, ""); if (b.length >= 4 && (ok(b) || ok(b + "e") || ok(b.replace(/i$/, "y")))) return true; } } }
    for (const [re, to] of [[/ies$/, "y"], [/es$/, ""], [/s$/, ""], [/ed$/, ""], [/ed$/, "e"], [/ing$/, ""], [/ing$/, "e"], [/ers?$/, ""], [/ers?$/, "e"], [/able$/, ""], [/able$/, "e"], [/ability$/, "able"], [/ise$|ised$|ising$/, "e"], [/ly$/, ""]]) {
      if (re.test(l)) { const base = l.replace(re, to); if (base.length >= 3 && ok(base)) return true; }
    }
    for (let i = 3; i <= l.length - 3; i++) if (ok(l.slice(0, i)) && ok(l.slice(i))) return true; // cash+flow, chat+bots
    return false;
  };
  const out = new Set();
  // Soft hyphens and zero-width characters split words in the HTML but not on screen.
  const clean = text.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "");
  for (const raw of clean.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]/g) || []) {
    // "co-ordinator" and "re-upholstery" are fine as a whole; only split a hyphenated word when the whole is unknown.
    const whole = raw.replace(/’/g, "'").replace(/-/g, "");
    if (raw.includes("-") && (okish(raw.replace(/’/g, "'")) || okish(whole))) continue;
    for (const w of raw.replace(/’/g, "'").split("-")) {
      const word = w.replace(/'s$/i, "").replace(/^'+|'+$/g, "");
      if (word.length < 4 || /[A-Z]/.test(word) || /^(https?|www|html|com|png|jpg)$/i.test(word)) continue;
      if (!okish(word)) out.add(word);
      if (out.size >= 40) return [...out];
    }
  }
  return [...out];
}

// Accessible name of an element, close to how browsers work it out.
function accessibleName($, el) {
  const t = $(el);
  if ((t.attr("aria-label") || "").trim()) return true;
  const lb = t.attr("aria-labelledby");
  if (lb && lb.split(/\s+/).some((id) => $(`[id="${id}"]`).text().trim())) return true;
  if ((t.attr("title") || "").trim()) return true;
  if (t.text().replace(/\s+/g, "").length) return true;
  if (t.find("img[alt]").toArray().some((i) => ($(i).attr("alt") || "").trim())) return true;
  if (t.find("svg title, [aria-label]").toArray().some((i) => ($(i).text() || $(i).attr("aria-label") || "").trim())) return true;
  if (t.is("input") && ((t.attr("value") || "").trim() || /submit|reset/i.test(t.attr("type") || ""))) return true;
  return false;
}
function snippet($, el) {
  const t = $(el);
  const bits = [el.tagName, t.attr("id") && `#${t.attr("id")}`, t.attr("name") && `name="${t.attr("name")}"`, t.attr("type") && `type="${t.attr("type")}"`,
    t.attr("href") && `href="${String(t.attr("href")).slice(0, 60)}"`, t.attr("class") && `.${String(t.attr("class")).trim().split(/\s+/).slice(0, 2).join(".")}`];
  return `<${bits.filter(Boolean).join(" ")}>`;
}

function a11yFacts($) {
  const hidden = (el) => $(el).closest('[aria-hidden="true"], [hidden], [style*="display:none"], [style*="display: none"]').length > 0;
  const unlabelled = [];
  for (const el of $("input, select, textarea").toArray()) {
    const t = $(el);
    const type = (t.attr("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type) || hidden(el)) continue;
    const id = t.attr("id");
    const ok = (id && $(`label[for="${id}"]`).text().trim()) || t.closest("label").text().trim() ||
      (t.attr("aria-label") || "").trim() || t.attr("aria-labelledby") || (t.attr("title") || "").trim() || (t.attr("placeholder") || "").trim();
    if (!ok) unlabelled.push(snippet($, el));
  }
  const noNameButtons = [];
  for (const el of $('button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]').toArray()) {
    if (hidden(el)) continue;
    if (!accessibleName($, el)) noNameButtons.push(snippet($, el));
  }
  const noNameLinks = [];
  for (const el of $("a[href]").toArray()) {
    if (hidden(el)) continue;
    if (!accessibleName($, el)) noNameLinks.push(snippet($, el));
  }
  const vp = ($('meta[name="viewport"]').attr("content") || "").toLowerCase();
  const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(vp);
  const zoomBlocked = /user-scalable\s*=\s*(no|0)\b/.test(vp) || (maxScale && Number(maxScale[1]) < 2);
  return {
    unlabelled: unlabelled.slice(0, 10), unlabelledCount: unlabelled.length,
    noNameButtons: noNameButtons.slice(0, 10), noNameButtonCount: noNameButtons.length,
    noNameLinks: noNameLinks.slice(0, 10), noNameLinkCount: noNameLinks.length,
    zoomBlocked: !!zoomBlocked,
  };
}

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
  const linkText = {};
  for (const a of $("a[href]").toArray()) {
    const href = ($(a).attr("href") || "").trim();
    if (!href || /^(mailto|tel|javascript|sms|whatsapp):|^#/i.test(href)) continue;
    // Cloudflare's email-protection links are decoded by the browser; not real pages.
    if (/\/cdn-cgi\//i.test(href)) continue;
    const l = abs(r.url, href)?.split("#")[0];
    if (!l) continue;
    links.push(l);
    if (!linkText[l]) {
      const t = $(a);
      const txt = t.text().replace(/\s+/g, " ").trim() || (t.attr("aria-label") || "").trim() || (t.attr("title") || "").trim() || (t.find("img[alt]").first().attr("alt") || "").trim();
      linkText[l] = txt.slice(0, 60) || (t.find("img").length ? "(image link)" : "(no text)");
    }
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

  const a11y = a11yFacts($);

  // Content facts: headings, videos, link wording and the footer copyright year.
  const h1s = $("h1").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim().slice(0, 80)).slice(0, 3);
  const videos = [];
  for (const el of $("iframe[src], iframe[data-src]").toArray()) {
    const src = ($(el).attr("src") || $(el).attr("data-src") || "").trim();
    const kind = /youtube(-nocookie)?\.com|youtu\.be/i.test(src) ? "YouTube" : /vimeo\.com/i.test(src) ? "Vimeo" : /wistia\.(com|net)/i.test(src) ? "Wistia" : /loom\.com/i.test(src) ? "Loom" : "";
    if (!kind) continue;
    videos.push({ src: src.slice(0, 300), kind, title: ($(el).attr("title") || "").trim().slice(0, 100), autoplay: /[?&]autoplay=1/i.test(src), muted: /[?&](mute|muted)=1/i.test(src) });
  }
  for (const el of $("video").toArray()) {
    const t = $(el);
    const src = (t.attr("src") || t.find("source").first().attr("src") || "").trim();
    videos.push({ src: (src ? abs(r.url, src) || src : "(inline video)").slice(0, 300), kind: "Video file", title: (t.attr("title") || t.attr("aria-label") || "").trim().slice(0, 100),
      autoplay: t.attr("autoplay") !== undefined, muted: t.attr("muted") !== undefined, controls: t.attr("controls") !== undefined,
      captions: t.find('track[kind="captions"], track[kind="subtitles"]').length > 0, decorative: t.attr("autoplay") !== undefined && t.attr("muted") !== undefined && t.attr("loop") !== undefined && t.attr("controls") === undefined });
  }
  const VAGUE = /^(click here|here|read more|learn more|more|link|see more|view more|find out more|details|go|this|this page|website|page)\s*[>→»…]*$/i;
  const vagueLinks = Object.entries(linkText).filter(([, t]) => VAGUE.test(t)).slice(0, 10).map(([u, t]) => ({ url: u, text: t }));

  // Placeholder text and typos in the visible copy only.
  $("script, style, noscript, svg, template, code, pre").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  const placeholders = [];
  let lastHit = -1000;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const i = m.index;
    if (i - lastHit < 100) continue; // "lorem ipsum dolor sit amet" is one hit, not two
    lastHit = i;
    placeholders.push(text.slice(Math.max(0, i - 40), i + m[0].length + 40).trim());
    if (placeholders.length >= 5) break;
  }
  // Words inside the site's own addresses (brand names) are never typos.
  const knownFromUrls = new Set();
  for (const u of [r.url, ...links]) { try { for (const part of new URL(u).hostname.replace(/^www\./, "").split(".")) if (part.length >= 4) knownFromUrls.add(part.toLowerCase()); } catch {} }
  for (const m of html.matchAll(/[\w.-]+@([\w-]+)\./g)) knownFromUrls.add(m[1].toLowerCase());
  const typos = suspectWords(text, knownFromUrls);
  const words = (text.match(/[A-Za-z][A-Za-z'’-]+/g) || []).length;
  // Footer copyright: "© 2019 Company" or "Copyright 2018-2021".
  const years = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})\b/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= 2100);
  const copyrightYear = years.length ? Math.max(...years) : 0;
  // "© Company" with no year can't go out of date; a year written by code updates itself.
  const copyrightNoYear = !copyrightYear && /(©|\(c\)|copyright)\s*[A-Za-z]/i.test(text);
  const copyrightAuto = !copyrightYear && /getFullYear\s*\(|date\(\s*['"]Y['"]\s*\)|current_year|\{\{\s*(year|now)/i.test(r.body.toString("utf8"));

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
    links: [...new Set(links)].slice(0, 400), linkText,
    forms, formTools, ga, ua, gtm, gaLoader, trackers, placeholders, typos, ...a11y,
    h1s, videos: videos.slice(0, 20), vagueLinks, words, copyrightYear, copyrightNoYear, copyrightAuto,
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

// ---------------------------------------------------------------------------
// Google PageSpeed Insights (Lighthouse in a real browser). Gives contrast,
// font size and image optimisation results that need a rendered page.
// Free with an API key in PSI_API_KEY; without one Google rate-limits hard.

const OWN_A11Y = new Set(["color-contrast", "image-alt", "html-has-lang", "html-lang-valid", "label", "button-name", "link-name", "meta-viewport", "document-title", "input-button-name", "select-name"]);
const IMAGE_AUDITS = ["uses-optimized-images", "modern-image-formats", "uses-responsive-images", "image-delivery-insight"];

// Prefer the visible text of the element; fall back to its code snippet.
const nodeText = (n) => (n?.nodeLabel && !/^</.test(n.nodeLabel) ? n.nodeLabel : "") || n?.snippet || n?.selector || "";
export function compactPsi(json) {
  const lr = json?.lighthouseResult;
  if (!lr) return { ok: false, error: json?.error?.message || "No result" };
  const A = lr.audits || {};
  const failed = (id) => A[id] && A[id].scoreDisplayMode !== "notApplicable" && A[id].scoreDisplayMode !== "manual" && A[id].scoreDisplayMode !== "informative" && A[id].score !== null && A[id].score < 1;
  const items = (id) => A[id]?.details?.items || [];

  const contrast = failed("color-contrast") ? items("color-contrast").slice(0, 15).map((i) => {
    const ex = i.node?.explanation || "";
    const ratio = /contrast of ([\d.]+)/.exec(ex)?.[1];
    const fg = /foreground color: (#[0-9a-f]+)/i.exec(ex)?.[1];
    const bg = /background color: (#[0-9a-f]+)/i.exec(ex)?.[1];
    const need = /Expected contrast ratio of ([\d.]+:1)/.exec(ex)?.[1];
    return { text: (i.node?.nodeLabel || "").slice(0, 80), selector: i.node?.selector || "", ratio, fg, bg, need };
  }) : [];

  // Lighthouse font-size audit (SEO category): share of text under 12px on mobile.
  const fs = A["font-size"];
  const small = (fs?.details?.items || []).filter((i) => { const n = parseFloat(i.fontSize); return n && n < 12 && !/≥/.test(String(i.fontSize)); })
    .slice(0, 10).map((i) => ({ selector: typeof i.selector === "string" ? i.selector : nodeText(i.selector), size: i.fontSize, coverage: i.coverage }));
  const legible = parseFloat(fs?.displayValue || "") || (fs?.score === 1 && !small.length ? 100 : null);

  const a11yRefs = lr.categories?.accessibility?.auditRefs?.map((r) => r.id) || [];
  const other = a11yRefs.filter((id) => !OWN_A11Y.has(id) && failed(id)).map((id) => ({
    id, title: A[id].title, examples: items(id).slice(0, 3).map((i) => nodeText(i.node)).filter(Boolean),
  }));
  const ownFails = {};
  for (const id of ["label", "button-name", "link-name", "input-button-name", "select-name"]) {
    // Keep the code snippet (it carries the href/type) so duplicates of the HTML scan's findings can be spotted.
    if (failed(id)) ownFails[id] = items(id).slice(0, 10).map((i) => i.node?.snippet || nodeText(i.node));
  }

  const imageIssues = [];
  for (const id of IMAGE_AUDITS) {
    if (!A[id] || !failed(id)) continue;
    for (const i of items(id).slice(0, 10)) {
      if (!i.url) continue;
      imageIssues.push({ audit: A[id].title, url: i.url, wastedKb: Math.round((i.wastedBytes || 0) / 1024) });
    }
  }
  const imageAuditsRun = IMAGE_AUDITS.some((id) => A[id]);

  const num = (id) => A[id]?.numericValue;
  return {
    ok: true,
    a11yScore: Math.round((lr.categories?.accessibility?.score ?? 0) * 100),
    perfScore: lr.categories?.performance ? Math.round((lr.categories.performance.score ?? 0) * 100) : null,
    lcp: num("largest-contentful-paint"), fcp: num("first-contentful-paint"), tbt: num("total-blocking-time"), cls: num("cumulative-layout-shift"),
    contrastChecked: !!A["color-contrast"] && A["color-contrast"].scoreDisplayMode !== "notApplicable", contrast,
    fontSizeChecked: !!fs && fs.scoreDisplayMode !== "notApplicable", legible, small,
    other, ownFails, imageIssues, imageAuditsRun,
  };
}

export async function psiAudit(url) {
  const key = process.env.PSI_API_KEY || "";
  const q = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["ACCESSIBILITY", "SEO", "PERFORMANCE"]) q.append("category", c);
  if (key) q.set("key", key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 52_000);
  try {
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: ctrl.signal, cache: "no-store" });
    const json = await r.json().catch(() => ({}));
    // 429 = Google's per-minute limit: the browser waits and retries. 403 = key problem: stop.
    if (r.status === 429) return { ok: false, retryAfter: 30, error: key ? "Google's per-minute limit reached; waiting before retrying." : "PageSpeed needs a free API key (PSI_API_KEY) – Google is rate-limiting requests without one." };
    if (r.status === 403) return { ok: false, fatal: true, error: `PageSpeed API refused the request (403): ${json?.error?.message || "key problem"}` };
    if (!r.ok) return { ok: false, error: json?.error?.message || `PageSpeed error ${r.status}` };
    return compactPsi(json);
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "PageSpeed timed out on this page" : String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}
