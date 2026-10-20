// Does tracking wait for the cookie banner? Read from the page HTML and, when Google Tag Manager
// is used, from the public GTM container (where the tags and their triggers live). Nothing here
// runs a browser, so a "gap" means the setup lets tags fire before consent; the developer brief
// says how to confirm it in an incognito window. Shared by Website checks, Client Ideas and Leads.
import { CONSENT_RE } from "@/lib/leadsShared";

const BANNERS = [
  [/beautiful[-_ ]?cookie|nsc_bar|nsc-bar/i, "Beautiful and responsive cookie consent"], [/cookiebot/i, "Cookiebot"], [/cookieyes|cookie-law-info/i, "CookieYes"],
  [/complianz|cmplz/i, "Complianz"], [/borlabs/i, "Borlabs Cookie"], [/real-cookie-banner/i, "Real Cookie Banner"], [/moove_gdpr/i, "GDPR Cookie Compliance"],
  [/cookie-notice/i, "Cookie Notice"], [/onetrust/i, "OneTrust"], [/termly/i, "Termly"], [/iubenda/i, "iubenda"], [/cookiehub/i, "CookieHub"], [/osano/i, "Osano"],
  [/usercentrics/i, "Usercentrics"], [/didomi/i, "Didomi"], [/cookie-script/i, "Cookie-Script"], [/cookiefirst/i, "CookieFirst"],
];
const OTHER_TAGS = [
  [/connect\.facebook\.net|fbq\(/i, "Meta Pixel"], [/snap\.licdn\.com|_linkedin_partner_id/i, "LinkedIn Insight"], [/analytics\.tiktok\.com|ttq\.load/i, "TikTok Pixel"],
  [/bat\.bing\.com/i, "Microsoft Ads"], [/clarity\.ms/i, "Microsoft Clarity"], [/static\.hotjar\.com|hotjar\.com/i, "Hotjar"], [/\bAW-\d{6,}/, "Google Ads"],
];
// Google Consent Mode set before the tags load (by the banner, GTM4WP or by hand).
const CONSENT_DEFAULT = /['"]consent['"]\s*,\s*['"]default['"]/i;
// A tracking script the banner holds back until consent (the usual blocking attributes).
const HELD_BACK = /type=["']text\/plain["']|data-cookieconsent|data-category|data-cookiecategory|data-cookie-?consent|cmplz|data-service=|data-borlabs|data-blocked/i;
const TRACKING_SCRIPT = /googletagmanager\.com|google-analytics\.com|gtag\(|gtm\.start|connect\.facebook\.net|fbq\(|snap\.licdn\.com|analytics\.tiktok\.com|bat\.bing\.com|clarity\.ms|hotjar/i;
// In a GTM container: triggers on a banner's own consent events, or tags with consent checks set.
const GTM_GATED = /beautiful_cookie_consent|cookie_consent_(update|statistics|marketing)|cmplz_|cookieyes[-_]consent|CookiebotOnAccept|CookiebotOnConsentReady|borlabs-cookie|rcb-consent|OneTrustGroupsUpdated|consent_update|"vtp_consentStatus"|"consent":\["list"/i;

// What the page HTML shows: the banner, the tags, and whether anything holds them back.
export function scanTags(html = "") {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1] || "", body: m[2] || "" }));
  const tracking = scripts.filter((s) => TRACKING_SCRIPT.test(s.attrs) || TRACKING_SCRIPT.test(s.body));
  return {
    banner: CONSENT_RE.test(html),
    bannerName: (BANNERS.find(([re]) => re.test(html)) || [])[1] || "",
    ga4: [...new Set([...html.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)].map((m) => m[1]))].slice(0, 3),
    gtm: [...new Set([...html.matchAll(/\b(GTM-[A-Z0-9]{4,10})\b/g)].map((m) => m[1]))].slice(0, 2),
    gtm4wp: /gtm4wp/i.test(html),
    wordpress: /wp-content|wp-includes/i.test(html),
    others: OTHER_TAGS.filter(([re]) => re.test(html)).map(([, n]) => n),
    consentDefault: CONSENT_DEFAULT.test(html),
    tracking: tracking.length > 0,
    ungated: tracking.some((s) => !HELD_BACK.test(s.attrs)),
  };
}

// The public GTM container: which GA4 and ad tags it holds, and whether anything ties them to consent.
export async function readContainer(id, timeoutMs = 6000) {
  try {
    const r = await fetch(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { id, ok: false };
    const all = await r.text();
    // Only the container's own tags and triggers: Google's runtime code below them mentions consent everywhere.
    const end = all.indexOf('"runtime"');
    const js = end > 0 ? all.slice(0, end) : all.slice(0, 60000);
    const ua = [...new Set([...js.matchAll(/\b(UA-\d{4,10}-\d{1,3})\b/g)].map((m) => m[1]))];
    return { id, ok: true, ga4: [...new Set([...js.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)].map((m) => m[1]))].slice(0, 3),
      others: [...OTHER_TAGS.filter(([re]) => re.test(js)).map(([, n]) => n), ...(ua.length ? [`Universal Analytics ${ua.join(", ")} (retired by Google)`] : [])], gated: GTM_GATED.test(js) };
  } catch { return { id, ok: false }; }
}

// Page scan + containers -> the verdict, a one-line summary and a brief for the developer.
export function consentVerdict(scan, containers = []) {
  if (!scan?.tracking && !containers.length) return { gap: false, summary: "" };
  const ga4 = [...new Set([...(scan.ga4 || []), ...containers.flatMap((c) => c.ga4 || [])])];
  const others = [...new Set([...(scan.others || []), ...containers.flatMap((c) => c.others || [])])];
  if (!scan.banner) return { gap: false, noBanner: true, ga4, others, summary: "Tracking runs but there is no cookie banner." };
  const gtmGated = containers.some((c) => c.ok && c.gated);
  const heldBack = !scan.ungated;
  if (scan.consentDefault || gtmGated || heldBack) return { gap: false, ga4, others, summary: `Tracking looks tied to the cookie banner (${scan.consentDefault ? "Google Consent Mode" : gtmGated ? "Tag Manager triggers on consent" : "scripts held back by the banner"}). Test in a private window to be sure.` };
  const what = ga4.length ? `GA4 (${ga4.join(", ")})` : "Analytics";
  const via = scan.gtm?.length ? `via Tag Manager ${scan.gtm.join(", ")}` : "directly in the page";
  return { gap: true, ga4, others, summary: `${what} loads ${via} and has nothing tying it to the cookie banner${scan.bannerName ? ` (${scan.bannerName})` : ""} in the page code or Tag Manager, so it probably fires before consent (confirm with Claude or in a private window)${others.length ? `. Also on the site: ${others.join(", ")}` : ""}.`, ticket: consentTicket(scan, ga4, others) };
}

// A brief a developer can act on, in the house format.
export function consentTicket(scan, ga4 = scan.ga4 || [], others = scan.others || []) {
  const beautiful = /beautiful/i.test(scan.bannerName || "");
  const perf = beautiful ? "Performance" : "analytics (statistics)", target = beautiful ? "Targeting" : "marketing";
  const gtm = scan.gtm || [];
  return [
    `For a ${scan.wordpress ? "WordPress developer" : "developer"}${gtm.length ? " with access to Google Tag Manager" : ""}`,
    `${ga4.length ? `GA4 (${ga4.join(", ")})` : "Analytics"} loads ${gtm.length ? `via GTM container ${gtm.join(", ")}${scan.gtm4wp ? " (injected by GTM4WP)" : ""}` : "directly in the page"}`,
    "and isn't tied to the cookie banner, so it may fire before consent.",
    `Please make ${ga4.length ? "GA4" : "analytics"} fire only after the visitor accepts ${perf} cookies,`,
    `and not at all if they reject. Check any other tags (ads, pixels${others.length ? `: ${others.join(", ")}` : ""}) and gate`,
    `them on ${target} the same way.`,
    "Context",
    "",
    `* Banner plugin: ${scan.bannerName || "a cookie banner (name not detected)"}`,
    ...(beautiful ? [
      "* It pushes consent events to the dataLayer:",
      "   * beautiful_cookie_consent_initialized / beautiful_cookie_consent_updated",
      "* Its Google Consent Mode feature is premium, so no Consent Mode update is sent",
    ] : ["* Check whether the banner has a free Google Consent Mode setting or pushes a consent event to the dataLayer to trigger on"]),
    ...(scan.gtm4wp ? ["   * GTM4WP's Consent Mode default is off."] : []),
    "* Free solutions only",
    "",
    "Test in incognito (Network tab, filter \"collect\")",
    "",
    "* No choice made: no GA4 request",
    "* Reject all: no GA4 request",
    "* Accept all: page_view fires",
    "* Returning visitor who accepted: fires with no banner",
  ].join("\n");
}

// Server side, one call: scan the page, read up to two GTM containers, give the verdict.
export async function trackingConsent(html) {
  const scan = scanTags(html);
  const containers = await Promise.all((scan.gtm || []).map((id) => readContainer(id)));
  return { ...consentVerdict(scan, containers), bannerName: scan.bannerName, gtm: scan.gtm, tracking: scan.tracking || containers.some((c) => c.ok && (c.ga4?.length || c.others?.length)) };
}

// Claude double-checks the flagged sites (it can read the page, the container, and with a browser watch the requests).
export function consentCheckPrompt(items) {
  const list = items.map((r, n) => `${n + 1}. ${r.site}\n   Our check: ${r.summary}${r.gtm?.length ? `\n   Tag Manager: ${r.gtm.join(", ")} (container: https://www.googletagmanager.com/gtm.js?id=${r.gtm[0]})` : ""}${r.ga4?.length ? `\n   GA4: ${r.ga4.join(", ")}` : ""}${r.bannerName ? `\n   Banner: ${r.bannerName}` : ""}`).join("\n\n");
  return `You're checking whether these websites load analytics or advertising tags before the visitor accepts cookies (UK PECR / UK GDPR). Our automatic check flagged them from the page code and the Google Tag Manager container; confirm or correct it for each one.

For each site:
1. Read the homepage source. Note the cookie banner, and how GA4 / GTM / pixels are loaded: a plain <script>, or held back by the banner (type="text/plain", data-borlabs-*, data-cookieconsent, data-category, cmplz, a banner "content blocker" that only injects GTM after consent, etc.).
2. If GTM is used, read the container at the address given. Look at the tags (GA4, Google Ads, Meta, LinkedIn, etc.) and their triggers: do they fire on All Pages / gtm.js / Initialization with no consent condition, or only on the banner's consent event or with consent settings (analytics_storage / ad_storage)? Is Google Consent Mode set to "denied" by default before GTM loads?
3. If you can load the page in a real browser, open it fresh with no cookies and check whether requests go to google-analytics.com/g/collect, googletagmanager.com, facebook.com/tr etc. before you click anything. That is the strongest evidence.

Be honest about how sure you are: only say "fires_before_consent" or "waits_for_consent" with high confidence when the evidence is clear.

Sites:
${list}

Reply with ONLY one JSON code block, no other text:
\`\`\`json
{ "consent_check": [
  { "site": "example.co.uk", "verdict": "fires_before_consent | waits_for_consent | no_banner | unsure", "confidence": "high | medium | low", "tags_before_consent": ["GA4 G-XXXX", "Meta Pixel"], "evidence": "one or two sentences: what you saw and where" }
] }
\`\`\``;
}
