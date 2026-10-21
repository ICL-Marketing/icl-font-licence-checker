// Client Ideas: turns what a client's website shows into concrete, friendly suggestions we can
// send to an existing client. Plain JavaScript, safe to import in the browser (no Node modules).
import { firstNameOf, staleFooterYear } from "@/lib/leadsShared";

// Board columns, left to right.
// Each idea is managed on its own: it waits in its client's queue (priority order), one goes out each month,
// then it follows the client's reply.
export const IDEA_STATUSES = [
  ["queued", "Queued", "Waiting its turn in the client's monthly queue"],
  ["sent", "Sent", "Suggested to the client"],
  ["interested", "Interested", "They replied keen; estimate to follow"],
  ["agreed", "Agreed", "Estimate accepted"],
  ["done", "Done", "Delivered"],
  ["declined", "Not for them", "Declined, parked or skipped for good"],
];
const OLD_STATUS = { idea: "queued", shortlist: "queued", ready: "queued", pitched: "sent", "not-now": "declined" };
export const normStatus = (st) => OLD_STATUS[st] || (IDEA_STATUSES.some(([id]) => id === st) ? st : "queued");
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const monthName = (key) => { const [y, m] = String(key).split("-").map(Number); return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
// One client's ideas across all their sites, in priority order (fixed-on-site ones that were never sent drop out).
export function clientQueue(recs) {
  return recs.flatMap((r) => (r.ideas || []).map((i) => ({ ...i, status: normStatus(i.status), recId: r.id, website: r.website })))
    .filter((i) => !(i.resolved && i.status === "queued") && !isInternal(i))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.rank - b.rank);
}
// This month for one client: the idea already sent this month, or the next one in the queue.
// ---- Fix or Idea: something broken or wrong on the site, or new work. ----
// Automatic checks that find something wrong rather than an opportunity.
const FIX_RULES = new Set(["ssl", "down", "cookies", "consent-gap", "copyright", "mobile", "alt", "font", "image"]);
const FIX_RE = /lorem ipsum|placeholder|dummy text|sample text|noindex|hidden from google|blocked from google|not (indexed|in google)|staging|test (site|copy|version)|dev\.|broken link|dead link|\b404\b|wrong (phone|number|address|email|details)|out of date (phone|address|details)|typo|spelling|before (the visitor|visitors?|people) (agree|consent)|without consent|cookie.*(before|without)|not secure|ssl|certificate|expired|broken|doesn[’']?t work|not working|error/i;
export const ideaType = (i) => (i.type === "fix" || i.type === "idea" ? i.type : (i.ai || i.custom ? i.kind === "fix" || FIX_RE.test(`${i.title || ""} ${i.why || ""}`) : FIX_RULES.has(i.key)) ? "fix" : "idea");
// Fixes on a site we built are ours to sort: no estimate, and the client hears about it once it's done.
const lower1 = (t) => String(t || "").replace(/^\w/, (c) => c.toLowerCase()).replace(/\.$/, "");
export function supportEmail(client, idea, toEmail = "", mode = "fixed") {
  const { name } = greetingFor(client, toEmail);
  const body = mode === "fixed"
    ? `We spotted something on your website and have fixed it for you: ${lower1(idea.title)}.\n\nThere’s nothing you need to do. Just wanted to let you know it’s sorted.`
    : `We spotted something on your website that needs a small fix: ${lower1(idea.title)}.\n\nWe’ll take care of this for you and let you know once it’s done.`;
  return { subject: mode === "fixed" ? "A quick fix on your website" : "A small fix on your website", body: `${name ? `Hi ${name},` : "Hi there,"}\n\n${IDEA_GREETING}\n\n${body.trimEnd()}` };
}

// ---- Who built the site: ICL, not ICL, or unsure. The account manager's choice always wins. ----
export const ICL_SERVERS = ["68.183.40.131"]; // known ICL hosting; any server shared by two or more clients counts too
const GENERIC_THEMES = /^(astra|divi|avada|hello-elementor|hello-theme|twenty[a-z-]*|generatepress|oceanwp|kadence|flatsome|enfold|salient|bridge|betheme|the7|dt-the7|neve|storefront|sydney|hestia|zakra|blocksy|go|x|pro|uncode|porto|woodmart|jupiter|impreza|total|newspaper|bricks|oxygen|genesis|understrap|sage)$/;
const nameWords = (n) => String(n || "").toLowerCase().replace(/&/g, " ").replace(/\b(ltd|limited|llp|plc|the|and|of|uk|group)\b/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
// A custom WordPress theme named after the client (active-prospects, aet-website for AE Tuition).
export function themeIsTheirs(theme, name) {
  const t = String(theme || "").toLowerCase();
  if (!t || GENERIC_THEMES.test(t.replace(/-child$/, ""))) return false;
  const flat = t.replace(/[^a-z0-9]/g, "");
  const w = nameWords(name);
  if (!w.length) return false;
  if (w.some((x) => x.length >= 4 && flat.includes(x))) return true;
  const combos = [w.map((x) => x[0]).join(""), w[0] + w.slice(1).map((x) => x[0]).join(""), w.join("")].filter((c) => c.length >= 3);
  return combos.some((c) => flat.startsWith(c));
}
// Servers that host two or more different clients (not Cloudflare, not a website builder) are ICL's.
export function iclServerIps(recs) {
  const by = new Map();
  for (const r of recs) { const b = r.built; if (!b?.ip || b.cloudflare || b.builder) continue; if (!by.has(b.ip)) by.set(b.ip, new Set()); by.get(b.ip).add(r.clientId || r.name); }
  return new Set([...ICL_SERVERS, ...[...by].filter(([, s]) => s.size >= 2).map(([ip]) => ip)]);
}
export const BUILT_LABEL = { icl: "Built by ICL", not: "Not ICL", unsure: "Unsure" };
export function builtByFor(client, recs, iclIps = new Set(ICL_SERVERS)) {
  if (client?.builtBy) return { value: client.builtBy, manual: true, why: "Set by hand" };
  const sites = recs.filter((r) => r.built);
  const b = sites.find((r) => r.built.builder);
  if (b) return { value: "not", why: `Runs on ${b.built.builder}` };
  const ip = sites.find((r) => r.built.ip && iclIps.has(r.built.ip));
  if (ip) return { value: "icl", why: `On an ICL server (${ip.built.ip})` };
  const th = sites.find((r) => themeIsTheirs(r.built.theme, client?.name || r.name));
  if (th) return { value: "icl", why: `Custom WordPress theme “${th.built.theme}”` };
  return { value: "icl", unsure: true, why: sites.some((r) => r.built.cloudflare) ? "Behind Cloudflare, so the server is hidden" : sites.length ? "No clear sign either way" : "Not checked yet: run Check all" };
}

// Internal support tasks across a set of client records (our checks failing, not a client problem).
export function internalTasks(recs) {
  return recs.flatMap((r) => (r.ideas || []).filter((i) => isInternal(i) && !["done", "declined"].includes(normStatus(i.status))).map((i) => ({ ...i, recId: r.id, client: r.name, website: r.website })));
}
export function monthlyPick(queue, month = monthKey()) {
  const sent = queue.find((i) => i.sentMonth === month);
  if (sent) return { sent };
  return { next: queue.find((i) => i.status === "queued") || null };
}

// The ICL service each idea sells: shown on every card and used to filter the table.
export const IDEA_SERVICES = {
  "Web design": "bg-blue-600", "Web development": "bg-indigo-700", "Hosting & maintenance": "bg-slate-700", SEO: "bg-emerald-600", PPC: "bg-lime-600", Content: "bg-teal-600",
  "Social media": "bg-fuchsia-600", Videography: "bg-rose-600", Photography: "bg-pink-500", Branding: "bg-amber-500", Integrations: "bg-cyan-700", Apps: "bg-violet-700", Support: "bg-zinc-500",
};
// What each service tag means, so Claude (and the team) tag ideas the same way.
export const SERVICE_DEFS = {
  "Web design": "new or redesigned pages, layouts, landing pages, the look and feel of the site",
  "Web development": "features that do something: booking, quotes, portals, shops, calculators, catalogues, forms that feed a system",
  "Hosting & maintenance": "a hosting, security and maintenance plan or support package (updates, backups, monitoring, help desk)",
  SEO: "getting found on Google: search terms, Google Business Profile, technical SEO, content for search",
  PPC: "paid Google Ads campaigns",
  Content: "writing: page copy, blogs, case studies, guides, newsletters",
  "Social media": "running or setting up their social media: content, posting, ads on Facebook, Instagram, LinkedIn",
  Videography: "filming and editing video",
  Photography: "photo shoots: team, premises, products, projects",
  Branding: "logo, brand identity, brand guidelines",
  Integrations: "connecting the site to other systems: Xero, QuickBooks, Sage, Stripe, PayPal, GoCardless, ActiveCampaign, a CRM",
  Apps: "mobile apps and APIs (iOS/Android with React Native, Laravel)",
  Support: "small one-off fixes and changes to the existing site",
};
// What we sell to existing clients, for the research prompt (prices are for our estimate only, never in an email).
export const ICL_OFFER = `- Hosting, security & maintenance from £49/month: UK hosting, daily backups, security updates, SSL, uptime monitoring, phone and email support, one monthly fee.
- Support packages: Bronze £100/month (maintenance plus reactive and proactive support), Silver £375/month (plus weekly call with a dedicated service delivery manager and monthly strategy meetings), Gold £750/month (plus half a day a month on site and managed hosting).
- Enterprise managed servers: £87 to £569/month.
- SEO: Bronze £599, Silver £999, Gold £1,699 a month (search term research, Google Business Profile, content, link building, Search Console, reporting).
- PPC: 60-day Google Ads campaigns from £580/month management (plus ad spend from £1,000/month).
- Web design and development, e-commerce (WooCommerce, Shopify, Magento, Shopware), apps (React Native) and APIs (Laravel).
- Integrations: Stripe, PayPal, GoCardless, First Data, Xero, QuickBooks, Sage, ActiveCampaign.
- Social media management, videography, photography, content, branding. Cyber Essentials Plus certified.`;
// How long ICL really takes, so Claude's estimates match the team's (they were coming out 3 to 4 times too high).
export const HOURS_SCALE = `How long ICL really takes (an experienced team working on sites we know, with our own templates and page builder). Keep every estimate on this scale:
- A small change to an existing page (a button, a section tweak, a form, a fix): 0.5 to 3 hours.
- A new page or two built from the site's existing styles, e.g. a gallery and price list pages: about 8 hours (design 2, development 6).
- A new section with its own layout and some functionality, e.g. a case studies area or a quote form with logic: about 12 to 16 hours (design 4, development 8 to 12).
- Only a redesign of the whole site or a custom-built system goes above 30 hours.
Development usually takes about twice the design time; content, where needed, about the same as design.`;
// Rough ICL time for each automatic idea, in hours.
const RULE_HOURS = { "consent-gap": 1.5, ssl: 1, down: 2, font: 2, image: 1, cookies: 2, alt: 3, seo: 20, meta: 2, analytics: 1, copyright: 0.5, blog: 10, template: 60, mobile: 24, reviews: 4, form: 3, video: 16, speed: 8 };
// Hours for ideas saved before estimates existed: a fair guess from the size and the words.
export function hoursFor(i) {
  const h = Number(i.hours);
  if (Number.isFinite(h) && h > 0) return h;
  const t = `${i.title || ""}`.toLowerCase();
  if (/\b(fix|correct|clickable|update|replace|remove|tidy|typo|link|broken|rename|swap)\b/.test(t) && i.size !== "large") return 3;
  return i.size === "large" ? 40 : i.size === "medium" ? 12 : 3;
}
export const isQuickFix = (i) => hoursFor(i) <= 4;
// The client's ICL support plan, set by the account manager on the Client Ideas row.
export const PLANS = { "": "Plan?", none: "No plan", baseline: "Baseline £49", bronze: "Bronze", silver: "Silver", gold: "Gold" };
const RULE_SERVICE = { "consent-gap": "Support", maintenance: "Hosting & maintenance", ssl: "Support", down: "Support", font: "Support", image: "Support", cookies: "Support", alt: "Support", seo: "SEO", meta: "SEO", analytics: "SEO", copyright: "Content", blog: "Content", template: "Web design", mobile: "Web design", reviews: "Web design", form: "Web design", video: "Videography", speed: "Web development" };
// For ideas saved before services existed: read it from the words.
export function serviceFor(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(ppc|google ads|paid search|ad campaign|adwords|paid ads)\b/.test(t)) return "PPC";
  if (/social media|instagram|facebook|linkedin|tiktok|social posts?/.test(t)) return "Social media";
  if (/video|film|showreel|drone/.test(t)) return "Videography";
  if (/photo|shoot|headshot|imagery/.test(t)) return "Photography";
  if (/brand|logo|identity|rebrand/.test(t)) return "Branding";
  if (/\b(seo|search|rank|google|keywords?|local listing|not found for)\b/.test(t)) return "SEO";
  if (/hosting|maintenance|support (plan|package)|backups?|security updates?|uptime|managed server/.test(t)) return "Hosting & maintenance";
  if (/xero|quickbooks|\bsage\b|stripe|paypal|gocardless|first data|activecampaign|\bcrm\b|integrat|sync with/.test(t)) return "Integrations";
  if (/mobile app|\bios\b|android|react native|\bapi\b|\bapp\b/.test(t)) return "Apps";
  if (/blog|article|content|copy|case stud|guide|newsletter|knowledge hub|testimonial/.test(t)) return "Content";
  if (/booking|portal|shop|e-?commerce|checkout|payment|integration|automat|system|calculator|crm|app\b|login|database|configurator|speed|faster/.test(t)) return "Web development";
  if (/cookie|consent|security|firewall|ssl|certificate|hosting|accessib|licen[cs]e|gdpr|backup|maintenance/.test(t)) return "Support";
  return "Web design";
}
export const IDEA_KINDS = {
  fix: { label: "Fix", tone: "bg-red-600" },
  growth: { label: "Growth", tone: "bg-blue-600" },
  content: { label: "Content", tone: "bg-emerald-600" },
  compliance: { label: "Compliance", tone: "bg-purple-600" },
  design: { label: "Design", tone: "bg-amber-500" },
};

const SERVICES = { video: "https://icldigital.com/services/videography/" };

const fontList = (s) => [...new Set([...(s.licence?.fonts || []), ...(s.licence?.possibleFonts || [])].map((f) => String(f.family || "").replace(/["']/g, "").replace(/\s+W\s*0?\d+\b.*$/i, "").replace(/(\s+\d[\d\s]*)+$/, "").trim()).filter(Boolean))].slice(0, 4);
const close = "If you’d like us to take care of it, we can send over a quick estimate.";
const host = (w) => String(w || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");

// Every rule: when it applies, and the idea it produces. Order = priority on the board.
// A search result only counts when the term matches what research says the client does (a stray word on
// the site once sent a park-home dealer off as "printers").
const STOPW = new Set(["and", "the", "for", "with", "ltd", "limited", "company", "services", "service", "uk", "online", "local", "in", "of", "a", "an", "to"]);
const stem = (w) => w.replace(/(ies|es|s|ing|ers?)$/, "");
function searchFits(s, query) {
  const does = s.ai?.what_they_do || s.ai?.business_summary || s.tradeOverride;
  if (!does) return true;
  const q = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOPW.has(w)).map(stem);
  const d = String(does).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOPW.has(w)).map(stem);
  return q.some((w) => d.some((x) => x.startsWith(w) || w.startsWith(x)));
}
const RULES = [
  { key: "maintenance", size: "medium", kind: "growth", value: "from £49/month", when: (s) => s.plan === "none", title: () => "Hosting & maintenance plan",
    why: () => "No ICL support plan on file: hosting, backups, security updates and support for one monthly fee.",
    subject: "Looking after your website",
    body: () => `We’d love to look after your website for you on an ongoing basis: hosting on our UK servers, daily backups, security updates, uptime monitoring and support by phone and email, all for one monthly fee.\n\nIt means there’s always someone to call, and the site stays fast and secure.\n\nWould you like us to put the options together for you?` },
  { key: "ssl", size: "small", kind: "fix", when: (s) => s.problem === "Broken SSL", title: () => "Fix the security certificate",
    why: (s) => s.problemDetail || "Browsers show a “Not secure” warning.",
    subject: "Your website is showing a security warning",
    body: (s) => `We’ve spotted that the security certificate on your website needs renewing, so some browsers are showing a “Not Secure” message at the moment.\n\nIt’s a quick one for us to sort, and worth doing soon so visitors and Google see the site as secure.\n\n${close}` },
  { key: "down", size: "small", kind: "fix", when: (s) => s.problem === "Dead/broken site", title: () => "Site not loading properly",
    why: (s) => s.problemDetail || "The homepage did not load.",
    subject: "I think your site might be down?",
    body: (s) => `We’ve noticed your website isn’t loading properly at the moment.\n\nWe’d like to look into it straight away so visitors can reach you.\n\n${close}` },
  { key: "font", size: "small", kind: "compliance", when: (s) => (s.licence?.fonts || []).length > 0 || (s.licence?.possibleFonts || []).length > 0, title: () => "Check the font licences",
    why: (s) => `Fonts to double-check: ${fontList(s).join(", ")}.`,
    subject: "Font licences on your website",
    body: (s) => {
      const all = fontList(s); const fa = all.some((x) => /font ?awesome/i.test(x)); const n = all.filter((x) => !/font ?awesome/i.test(x)); const many = n.length > 1;
      if (!n.length) return `While looking over your website, we noticed it uses a Font Awesome kit for its icons.\n\nIt’s worth checking that the Font Awesome kit used on the website is covered by a valid licence, as unlicensed use could result in a request for backdated payment. ${close}`;
      return `While looking over your website, we noticed it uses ${many ? "a few commercial fonts" : "the commercial font"} (${n.join(", ")}) that need${many ? "" : "s"} a licence for web use.\n\nYou may well have this covered already, but it’s worth a quick check as type foundries do sometimes ask for licence fees.${fa ? " It’s also worth checking that the Font Awesome kit used on the website is covered by a valid licence, as unlicensed use could result in a request for backdated payment." : ""} ${close}`;
    } },
  { key: "image", size: "small", kind: "compliance", when: (s) => (s.licence?.images || []).length > 0, title: (s) => `Stock image licence (${s.licence.images[0].library || "stock"})`,
    why: (s) => `${s.licence.images.length} image${s.licence.images.length === 1 ? "" : "s"} look like watermarked previews rather than licensed downloads.`,
    subject: "A stock image on your website",
    body: (s) => `While looking over your website, we noticed that one of the images looks like ${s.licence.images[0].library || "a stock library"}’s preview file rather than a licensed download.\n\nIt’s worth replacing or licensing it, as stock libraries do send demands for this.\n\n${close}` },
  { key: "seo", size: "large", kind: "growth", when: (s) => { const t = s.seo?.searches?.find((x) => x.kind === "trade" && !x.error); return !!t && (t.position === null || t.position > 3) && searchFits(s, t.query); },
    title: (s) => `Not top for “${s.seo.searches.find((x) => x.kind === "trade").query}”`,
    why: (s) => { const t = s.seo.searches.find((x) => x.kind === "trade"); return `${t.position ? `Number ${t.position}` : "Not near the top of the list"} for “${t.query}”${t.ahead?.length ? `, behind ${t.ahead.slice(0, 2).join(", ")}` : ""}.`; },
    evidence: (s) => `https://www.google.com/search?q=${encodeURIComponent(s.seo.searches.find((x) => x.kind === "trade").query)}`,
    subject: "Your website in search",
    body: (s) => { const t = s.seo.searches.find((x) => x.kind === "trade"); return `We think there’s a real opportunity to bring you more enquiries from Google. When we searched “${t.query}”, the search most new customers make, you ${t.position ? `came up at number ${t.position}` : "weren’t near the top of the list"}.\n\nWith some focused SEO work on the site and your Google profile we could help move you up. Would you like us to put a plan and an estimate together for you?`; } },
  { key: "copyright", size: "small", kind: "content", when: (s) => staleFooterYear(s.year), title: (s) => `Footer still says © ${s.year}`,
    why: (s) => `The footer copyright year is ${s.year}. Visitors read an old year as an unloved site.`,
    subject: "Quick one on your website footer",
    body: (s) => `We noticed the footer on your website still says © ${s.year}.\n\nIt’s a small thing, but visitors do notice it. We can set it to update itself every year so it never comes up again. Happy to send over a quick estimate if you’d like us to sort it.` },
  { key: "template", size: "large", kind: "design", when: (s) => s.problem === "Dated template", title: (s) => `Running on ${String(s.problemDetail || "a template builder").replace(/,.*$/, "")}`,
    why: (s) => s.problemDetail || "Built on a template platform.",
    subject: "A thought on your website",
    body: (s) => `We’ve been thinking about the next chapter for your website. Moving from ${String(s.problemDetail || "a template builder").replace(/,.*$/, "").toLowerCase()} to a fully bespoke site would give you more freedom over the design and more control over how it performs in search.\n\nWould you like us to put some ideas and a rough estimate together for you?` },
  { key: "video", size: "medium", kind: "content", when: (s) => s.signals && !s.signals.video, title: () => "Short video on the homepage",
    why: () => "No video on the homepage. A 10 second clip at the top builds trust fast.",
    subject: "An idea for your homepage",
    body: (s) => `We were just looking over your website and had an idea: a short 10 second video at the top of the homepage could be one of the most impactful changes you make. It shows visitors straight away that you’re a real, established business.\n\nWe can film and edit it for you: ${SERVICES.video}\n\nIf you like the idea, we can send over an estimate for a shoot.` },
  { key: "reviews", size: "small", kind: "growth", when: (s) => s.signals && !s.signals.reviews, title: () => "Show reviews or testimonials",
    why: () => "No reviews or testimonials found on the homepage.",
    subject: "Your reviews on your website",
    body: (s) => `We’ve had an idea for your website: a reviews section on the homepage. Showing a few kind words from your customers is one of the easiest ways to build trust and win more enquiries.\n\n${close}` },
  { key: "form", size: "small", kind: "growth", when: (s) => s.signals && !s.signals.form, title: () => "Add an enquiry form",
    why: () => "No enquiry form found on the homepage or contact page.",
    subject: "Making it easier to get in touch",
    body: (s) => `We’ve had an idea for your website: adding a simple enquiry form alongside your email and phone details.\n\nForms tend to bring in more enquiries, especially out of hours, and they come straight to your inbox.\n\n${close}` },
  { key: "analytics", size: "small", kind: "growth", when: (s) => s.signals && !s.signals.analytics, title: () => "Set up visitor analytics",
    why: () => "No Google Analytics or Tag Manager found, so there is no record of visitors or enquiries.",
    subject: "Seeing who visits your website",
    body: (s) => `We’d love to help you see how your website is performing. Adding analytics would show how many people visit, where they come from and which pages bring in enquiries.\n\nIt’s quick for us to set up.\n\n${close}` },
  { key: "cookies", size: "small", kind: "compliance", when: (s) => s.signals && s.signals.analytics && !s.signals.consent, title: () => "Cookie consent banner",
    why: () => "Tracking runs on the site but no cookie consent tool was found.",
    subject: "Cookie banner on your website",
    body: (s) => `We noticed your website uses tracking cookies but doesn’t seem to ask visitors for consent first.\n\nUK rules expect a consent banner for this, so it’s worth adding one to stay on the right side of it.\n\n${close}` },
  { key: "consent-gap", size: "small", kind: "compliance", when: (s) => !!s.signals?.consentGap, title: () => "Tracking fires before cookie consent",
    why: (s) => s.signals.consentGap.summary,
    brief: (s) => s.signals.consentGap.ticket,
    subject: "Your cookie banner and tracking",
    body: (s) => `We noticed your website has a cookie banner, but your analytics and tracking tags seem to load before a visitor says yes, and still load if they say no.\n\nUK rules (PECR and UK GDPR) expect tracking to wait for consent, and the ICO has been writing to businesses about exactly this. It’s a small fix in Google Tag Manager to make the tags wait for the banner.\n\n${close}` },
  { key: "meta", size: "small", kind: "growth", when: (s) => s.signals && (!s.signals.metaDescription || !s.signals.ogImage), title: (s) => (!s.signals.metaDescription ? "Missing search description" : "No preview image when shared"),
    why: (s) => (!s.signals.metaDescription ? "The homepage has no meta description, so Google writes its own snippet." : "No social preview image, so links shared on WhatsApp, LinkedIn or Facebook show a blank card."),
    subject: "How your website looks in Google and when shared",
    body: (s) => (!s.signals.metaDescription
      ? `We noticed your homepage doesn’t have a search description, so Google picks its own bit of text to show under your name.\n\nIt’s a quick fix and gives you control over what people read before they click.\n\n${close}`
      : `We noticed that when your website is shared on WhatsApp, LinkedIn or Facebook it doesn’t show a preview image.\n\nIt’s a quick fix and makes shared links look far more inviting.\n\n${close}`) },
  { key: "mobile", size: "large", kind: "fix", when: (s) => s.signals && !s.signals.viewport, title: () => "Not set up for mobile",
    why: () => "No mobile viewport tag, so phones show a shrunk desktop page.",
    subject: "Your website on mobile",
    body: (s) => `With most visitors now on their phones, we’d like to give your website a mobile-first refresh so it reads and works beautifully on a small screen.\n\nIt would make it easier for customers to get in touch on the go.\n\n${close}` },
  { key: "alt", size: "small", kind: "compliance", when: (s) => s.signals && s.signals.imagesNoAlt >= 5, title: (s) => `${s.signals.imagesNoAlt} images without alt text`,
    why: (s) => `${s.signals.imagesNoAlt} of ${s.signals.images} homepage images have no alt text, which screen readers and Google rely on.`,
    subject: "A quick accessibility point on your website",
    body: (s) => `We’d like to add image descriptions (alt text) across your website. Screen readers and Google both use them, so it’s a nice boost for accessibility and search.\n\n${close}` },
  { key: "speed", size: "medium", kind: "fix", when: (s) => s.signals && s.signals.ms > 4000, title: () => "Homepage is slow to load",
    why: (s) => `The homepage took ${(s.signals.ms / 1000).toFixed(1)}s to respond.`,
    subject: "Your website’s loading speed",
    body: (s) => `We’ve spotted a few ways we could make your website load even faster.\n\nA quicker site keeps more visitors on the page, and Google takes speed into account too.\n\n${close}` },
  { key: "blog", size: "medium", kind: "content", when: (s) => s.signals && !s.signals.blog, title: () => "Start a news or blog section",
    why: () => "No news, blog or articles section found.",
    subject: "An idea for your website",
    body: (s) => `We were just looking over your website and had an idea: a simple news or blog section would give you a place to share projects and updates.\n\nIt helps with search over time and gives you something to post on social too.\n\n${close}` },
];

// Our own tools failing (a check timing out, our scanner blocked by their firewall) is a job for us, never an email.
const OUR_TOOL_RE = /\b(our (monitoring|monitor|tool|tools|checker|check|checks|scan|scanner|crawler|bot|uptime)|block(s|ed|ing)? (our|us)|firewall|timed? ?out|time-?outs?|captcha|bot protection|403|forbidden)\b/i;
export const isInternal = (i) => !!i.internal || OUR_TOOL_RE.test(`${i.title || ""} ${i.why || ""} ${i.email || ""}`);
export const IDEAS_VERSION = 8; // bump when the wording changes: unedited emails are rewritten on load
export const IDEA_RULE_KEYS = RULES.map((r) => r.key);

// Build the ideas for one client site, keeping anything a person already did with an idea
// (its status, notes, edited email) when the same idea comes up again.
// "on activeprospects.org.uk" -> "on your website" (emails never name the domain).
const plainSite = (text, website) => { const h = host(website); if (!h) return String(text || ""); const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return String(text || "").replace(new RegExp(`(https?:\\/\\/)?(www\\.)?${esc}\\/?`, "gi"), "your website").replace(/your website's/gi, "your website’s"); };
export const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
export function ideasFor(site, previous = []) {
  const prev = new Map((previous || []).map((i) => [i.key, i]));
  const out = [];
  // New ideas join the back of the queue; existing ones keep their place.
  let nextPriority = Math.max(-1, ...(previous || []).map((i) => (Number.isFinite(i.priority) ? i.priority : -1))) + 1;
  const keepOrNext = (old) => (old && Number.isFinite(old.priority) ? old.priority : nextPriority++);
  // Freshly researched ideas are the most specific, so they go to the front of the queue (in Claude's order).
  const newAi = (site.ai?.ideas || []).filter((a) => !prev.has(`ai:${slug(a.title)}`)).length;
  let frontPriority = Math.min(0, ...(previous || []).map((i) => (Number.isFinite(i.priority) ? i.priority : 0))) - newAi;
  const keepOrFront = (old) => (old && Number.isFinite(old.priority) ? old.priority : frontPriority++);
  // Researched ideas come first: they are specific to the business.
  for (const a of site.ai?.ideas || []) {
    const key = `ai:${slug(a.title)}`;
    if (!key || out.some((i) => i.key === key)) continue;
    const old = prev.get(key);
    out.push({
      key, ai: true, service: IDEA_SERVICES[a.service] ? a.service : serviceFor(`${a.title} ${a.why}`), kind: IDEA_KINDS[a.kind] ? a.kind : "growth", size: ["small", "medium", "large"].includes(a.project_size) ? a.project_size : "medium", value: a.est_value || "", likely: a.likely || "", hours: Number(a.hours) > 0 ? Number(a.hours) : null, title: a.title, why: a.why, evidenceUrl: a.evidence_url || "", rank: out.length,
      starred: !!old?.starred, status: old ? normStatus(old.status) : "queued", priority: keepOrFront(old), sentAt: old?.sentAt || "", sentMonth: old?.sentMonth || "", notes: old?.notes || "", statusAt: old?.statusAt || "",
      subject: old?.edited ? old.subject : a.subject, email: old?.edited ? old.email : plainSite(a.email, site.website), edited: !!old?.edited,
      foundAt: old?.foundAt || new Date().toISOString(), ...(old?.claudeCheck ? { claudeCheck: old.claudeCheck } : {}),
    });
  }
  // The automated checks only mean something if the website on file is really theirs.
  const wrongSite = site.ai && site.ai.website_is_theirs === false;
  for (const r of wrongSite ? [] : RULES) {
    let applies = false;
    try { applies = !!r.when(site); } catch { applies = false; }
    if (!applies) continue;
    const old = prev.get(r.key);
    const draft = { subject: r.subject, body: r.body(site) };
    out.push({
      key: r.key, ai: false, value: r.value || "", evidenceUrl: (() => { try { return r.evidence ? r.evidence(site) : ""; } catch { return ""; } })(), brief: (() => { try { return r.brief ? r.brief(site) : ""; } catch { return ""; } })(), hours: RULE_HOURS[r.key] || null, service: RULE_SERVICE[r.key] || "Web design", size: r.size || "small", kind: r.kind, title: r.title(site), why: r.why(site), rank: out.length,
      starred: !!old?.starred, status: old ? normStatus(old.status) : "queued", priority: keepOrNext(old), sentAt: old?.sentAt || "", sentMonth: old?.sentMonth || "", notes: old?.notes || "", statusAt: old?.statusAt || "",
      subject: old?.edited ? old.subject : draft.subject, email: old?.edited ? old.email : draft.body, edited: !!old?.edited,
      foundAt: old?.foundAt || new Date().toISOString(), ...(old?.claudeCheck ? { claudeCheck: old.claudeCheck } : {}),
    });
  }
  // Ideas that no longer apply (fixed on the site) are kept only if someone already moved them on.
  // A "site down" that is really our check being timed out or blocked is an internal support task.
  for (const i of out) if (isInternal(i) || (i.key === "down" && OUR_TOOL_RE.test(site.problemDetail || ""))) { i.internal = true; if (i.key === "down") { i.title = "Our check can’t reach the site"; i.why = site.problemDetail || i.why; } }
  for (const [key, old] of prev) if (!out.some((i) => i.key === key) && old.custom) out.push({ ...old, status: normStatus(old.status) });
  for (const [key, old] of prev) if (!out.some((i) => i.key === key) && !old.custom && normStatus(old.status) !== "queued") out.push({ ...old, status: normStatus(old.status), resolved: true });
  return out;
}

// Client emails open the same way every time (no "having a good weekend" on a Tuesday).
export const IDEA_GREETING = "Hope you’re well.";
// Who the email greets, and whether a person should check it before it goes:
// a name typed for the client wins; a full contact name in Settings is trusted; a single word,
// a name guessed from the email address, or no name at all ("Hi there") is flagged.
export function greetingFor(client, toEmail = "") {
  const typed = String(client?.greetName || "").trim();
  if (typed) return { name: typed, warn: "" };
  const poc = String(client?.poc || "").split(/\n|,/)[0].replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+/i, "").trim();
  const pocFirst = firstNameOf(poc);
  if (pocFirst && poc.split(/\s+/).length >= 2) return { name: pocFirst, warn: "" };
  if (pocFirst) return { name: pocFirst, warn: `Is “${pocFirst}” their first name? Settings only has one word for this contact.` };
  const local = String(toEmail || "").split("@")[0];
  const guess = firstNameOf(local.replace(/[._-].*$/, ""));
  if (guess && guess.length > 2) { const g = guess[0].toUpperCase() + guess.slice(1).toLowerCase(); return { name: g, warn: `“${g}” was guessed from the email address. Check it’s their first name.` }; }
  return { name: "", warn: "No contact name, so it says “Hi there”. Add their first name." };
}
// Greeting + body, written on the day it is sent.
export function ideaEmail(client, idea, toEmail = "") {
  const { name } = greetingFor(client, toEmail);
  return `${name ? `Hi ${name},` : "Hi there,"}\n\n${IDEA_GREETING}\n\n${String(idea.email || "").trimEnd()}`;
}

// ---- Free research on your own Claude plan: the app writes the prompt, you run it in Claude, paste the reply back.
const KIND_LIST = Object.keys(IDEA_KINDS).join(", ");
export function researchPrompt(items, feedback = [], liked = []) {
  const lessons = (feedback || []).slice(0, 25).map((f) => `- "${f.title}"${f.service ? ` (${f.service})` : ""}: ${f.reason}`).join("\n");
  const likes = (liked || []).slice(0, 20).map((i) => `- "${i.title}"${i.service ? ` (${i.service})` : ""}`).join("\n");
  const blocks = items.map((it, n) => `### Client ${n + 1}
client_id: ${it.id}
Name: ${it.name}
Website on file: ${it.websites.join(", ") || "none"}
${it.notes ? `Our notes: ${it.notes}\n` : ""}Their ICL support plan: ${it.plan || "not known"}
What our checker found on the site: ${it.findings || "not checked yet"}${(it.current || []).length ? `\nOur current ideas for them (check each one, keep the key exactly):\n${it.current.map((i) => `- [${i.key}] ${i.title}${i.why ? `: ${i.why}` : ""} (${i.service}, ~${i.hours} hrs)`).join("\n")}` : ""}`).join("\n\n");
  return `You're helping ICL Digital, a web design agency in Richmond (London), find genuinely useful work to suggest to clients we ALREADY work with. We build and look after websites. What we offer (prices are for your est_value only, never put them in an email):
${ICL_OFFER}

Include a hosting/maintenance or support package idea when the client has no plan (or "not known" and the site shows signs of being unmaintained: old software, no SSL, slow, errors). If they already have a plan, an upgrade (e.g. Bronze to Silver) only when there's a clear reason.

For EACH client below, use web search to research them properly before suggesting anything:
1. Confirm who the business really is. Check the website on file: is it really theirs? If not, find the right one, or say there is none.
2. Find what they actually sell and to whom, where they trade, and who they compete with (search their main service in their town; look at reviews and social profiles).
3. Use our checker's findings only where they matter for that business.

Then give the 4 to 6 best ideas per client, best first (biggest budget the client is most likely to say yes to). They must be substantial projects worth real money to us and to them, the kind of work worth an estimate of several thousand pounds: for example a new booking or quote system, an online shop, a customer or members' portal, a focused SEO and content campaign, a brand refresh and redesign, landing pages for a new service or location, a video or photography shoot, integrations or automation that save them admin time. Ground each idea in something you found (a gap on their site, what competitors do better, how customers search, where their business is heading). No small fixes (footer year, alt text, meta descriptions, analytics, cookie banners), no generic advice that fits every business, and nothing a web agency can't deliver.

Important: in most cases WE (ICL) designed and built these websites. Never criticise or run down the current site, its design, its build or past decisions, and never call anything outdated, poor, broken, missing or wrong. Frame every idea as a new opportunity or a next step that builds on what's there ("we'd love to add…", "a nice next step would be…"). Genuine faults (e.g. a security certificate that has lapsed) can be raised, but as something we've spotted and will take care of, not as a failing.

${likes ? `Ideas our team starred as strong ones. Suggest more of this calibre where they fit:\n${likes}\n\n` : ""}${lessons ? `Ideas our team rejected before, and why. Learn from these and don't suggest anything similar:\n${lessons}\n\n` : ""}Email for each idea (they're an existing client, so this is a friendly suggestion from their web team, not a sales pitch):
- UK English, warm and plain, no sales jargon, no exclamation marks.
- 2 or 3 short paragraphs separated by a blank line (write \\n\\n in the JSON). No greeting and no sign-off: the app puts "Hi <name>, Hope you're well." above. These are existing clients who already know us, so don't repeat a greeting, introduce us or mention our other services or clients.
- Open with what we noticed or the idea, e.g. "We were just looking over your website and had an idea…".
- Never suggest anything about our own monitoring, checks or tools (for example our check timing out or being blocked by their firewall): that is our problem to sort, not theirs.
- Say "your website", never the web address. Never mention where they are based, nearby towns, distances or how close anyone is, unless that exact town is written on their own website. If in doubt, leave location out. Only mention things you have confirmed (don't assume they have Google reviews, a booking system, social accounts, etc.).
- Say briefly why it helps them (more enquiries, bookings, trust…).
- End by offering to do it and, subtly, to send an estimate, e.g. "If you'd like us to set this up, we can send over a quick estimate." or "Would you like us to put an estimate together?". Never mention prices. Use "we" for ICL.

${items.some((it) => (it.current || []).length) ? `Where a client lists "Our current ideas", check every one against their live site and what you found: is it accurate (not already done, the problem is real) and worth suggesting to this client? Put each in "checked": "keep" or "drop", "type" bug (something broken for our support team) or idea (worth pitching), a fair "hours" figure on the scale below, and a one-line reason. Don't repeat a current idea in "ideas".
${HOURS_SCALE}

` : ""}Reply with ONLY one JSON code block, no other text, in exactly this shape (one object per client, keep each client_id exactly as given):
\`\`\`json
[
  {
    "client_id": "…",
    "business_summary": "two sentences: who they are and who their customers are",
    "what_they_do": "main service as a customer would search for it",
    "location": "town they trade from, or national/online",
    "website_is_theirs": true,
    "correct_website": "domain.co.uk or empty",
    "website_evidence": "one sentence",
    "competitors": ["…"],
    "sources": ["https://…"],
    "checked": [ { "key": "copy the [key] exactly", "verdict": "keep or drop", "type": "bug or idea", "hours": 2, "reason": "one line" } ],
    "ideas": [
      { "title": "under 60 characters", "service": "exactly one of: ${Object.entries(SERVICE_DEFS).map(([k, d]) => `${k} (${d})`).join("; ")}", "kind": "one of: ${KIND_LIST} (use fix for anything broken or wrong: placeholder text, hidden from Google, dead links, wrong details, tracking before consent)", "project_size": "medium or large", "est_value": "rough budget for us, e.g. £3k-£6k (internal only, never in the email)", "likely": "High, Medium or Low: how likely this client is to say yes", "hours": "our estimated hours to deliver it, a number on the scale below", "why": "1-2 sentences citing what you found", "evidence_url": "page that shows it, or empty", "subject": "email subject", "email": "email body" }
    ]
  }
]
\`\`\`

${blocks}`;
}

// Pull the JSON out of Claude's reply (code fences, extra words around it, a single object or an array).
export function parseResearchReply(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in the reply. Paste Claude's whole answer.");
  body = body.slice(start);
  const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  body = body.slice(0, end + 1);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("The reply isn't valid JSON. Ask Claude to reply with the JSON block only, then paste it again."); }
  const list = Array.isArray(data) ? data : Array.isArray(data.clients) ? data.clients : [data];
  return list.filter((x) => x && typeof x === "object" && x.client_id).map((x) => ({
    client_id: String(x.client_id),
    business_summary: String(x.business_summary || ""), what_they_do: String(x.what_they_do || ""), location: String(x.location || ""),
    website_is_theirs: x.website_is_theirs !== false, correct_website: String(x.correct_website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
    website_evidence: String(x.website_evidence || ""), competitors: Array.isArray(x.competitors) ? x.competitors.map(String).slice(0, 6) : [],
    sources: Array.isArray(x.sources) ? x.sources.map(String).filter((u) => /^https?:\/\//.test(u)).slice(0, 15) : [],
    ideas: (Array.isArray(x.ideas) ? x.ideas : []).filter((i) => i && i.title && i.email).slice(0, 6).map((i) => ({
      title: String(i.title).slice(0, 80), service: Object.keys(IDEA_SERVICES).find((k) => k.toLowerCase() === String(i.service || "").trim().toLowerCase()) || "", kind: IDEA_KINDS[i.kind] ? i.kind : "growth", project_size: String(i.project_size || "").toLowerCase().trim(), est_value: String(i.est_value || "").slice(0, 40), likely: ["High", "Medium", "Low"].find((v) => v.toLowerCase() === String(i.likely || "").trim().toLowerCase()) || "", hours: Math.max(0, parseFloat(String(i.hours ?? "").replace(/[^0-9.]/g, "")) || 0) || null, why: String(i.why || ""), evidence_url: /^https?:\/\//.test(String(i.evidence_url || "")) ? String(i.evidence_url) : "",
      subject: String(i.subject || i.title).slice(0, 90), email: String(i.email).replace(/\\n/g, "\n"),
    })),
    checked: (Array.isArray(x.checked) ? x.checked : []).filter((c) => c && c.key).map((c) => ({ key: String(c.key).replace(/^\[|\]$/g, ""), verdict: /drop/i.test(c.verdict) ? "drop" : "keep", type: /bug/i.test(c.type) ? "bug" : "idea", hours: Number(c.hours) > 0 ? Number(c.hours) : null, reason: String(c.reason || "").slice(0, 300) })),
    researchedAt: new Date().toISOString(), model: "Claude (your plan)",
  }));
}

// A one-line summary of the checker's findings for the prompt.
export function findingsLine(r) {
  if (!r?.checkedAt) return "";
  const s = r.signals || {};
  const t = r.seo?.searches?.find((x) => x.kind === "trade" && !x.error);
  const parts = [
    r.problem ? `${r.problem}${r.problemDetail ? ` (${r.problemDetail})` : ""}` : "site loads fine",
    r.platform ? `built on ${r.platform}` : "",
    staleFooterYear(r.year) ? `footer says © ${r.year}` : "",
    t ? `“${t.query}”: ${t.position ? `#${t.position}` : "not on page 1"}` : "",
    r.signals ? `homepage has ${["video", "reviews", "form", "analytics", "blog"].filter((k) => s[k]).join(", ") || "none of video/reviews/enquiry form/analytics/blog"}` : "",
    r.signals && !s.consent && s.analytics ? "tracking without a cookie banner" : "",
    s.consentGap ? `tracking fires before cookie consent (${s.consentGap.summary})` : "",
    ((r.licence?.fonts || []).length + (r.licence?.possibleFonts || []).length) ? `font licence questions: ${[...(r.licence.fonts || []), ...(r.licence.possibleFonts || [])].map((f) => f.family).join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

// The client's three best ideas still in play: big projects first (Claude's in its order), small fixes never.
// Best first: big projects, a decent budget, and a client likely to say yes. Small fixes never make the list.
const budgetTop = (v) => { const nums = String(v || "").toLowerCase().replace(/,/g, "").match(/\d+(\.\d+)?\s*k?/g) || []; return Math.max(0, ...nums.map((n) => parseFloat(n) * (/k/.test(n) ? 1000 : 1))); };
export const ideaScore = (i) => (i.starred ? 100 : 0) + ((i.size === "large" ? 3 : 2) * 10) - (isQuickFix(i) ? 8 : 0) + ({ High: 6, Medium: 3, Low: 0 }[i.likely] ?? 2) + Math.min(budgetTop(i.value) / 1000, 12) + (i.ai ? 2 : 0) + (i.status === "queued" ? 1 : 0);
export function topIdeas(queue, n = 3, service = "", { withSmall = false } = {}) {
  const live = queue.filter((i) => !["declined", "done"].includes(i.status) && (withSmall || (i.size || "small") !== "small") && (!service || (i.service || serviceFor(i.title)) === service))
    .map((i, at) => ({ i, at })).sort((a, b) => ideaScore(b.i) - ideaScore(a.i) || a.at - b.at).map((x) => x.i);
  // A client with two websites can hold the same idea twice: keep the first.
  const seen = new Set();
  const unique = live.filter((i) => { const k = String(i.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  return unique.slice(0, n);
}

// An idea typed in by the team. The email is written in the house style when left blank.
export function customIdea({ title, service, size, hours, value, why, subject, email }, priority = -1) {
  const h = Number(hours) > 0 ? Number(hours) : size === "quick" ? 3 : size === "large" ? 40 : 12;
  const body = String(email || "").trim() || `We were just looking over your website and had an idea: ${String(title).trim().replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}.${why ? `\n\n${String(why).trim()}` : ""}\n\nIf you’d like us to take care of it, we can send over a quick estimate.`;
  return {
    key: `custom:${slug(title)}-${Date.now().toString(36)}`, custom: true, ai: false, service: IDEA_SERVICES[service] ? service : serviceFor(title), kind: "growth",
    size: size === "large" ? "large" : "medium", hours: h, value: String(value || "").trim(), likely: "", title: String(title).trim(), why: String(why || "").trim(), evidenceUrl: "",
    rank: 0, priority, status: "queued", notes: "", statusAt: "", sentAt: "", sentMonth: "", subject: String(subject || "").trim() || "An idea for your website", email: body, edited: !!String(email || "").trim(),
    foundAt: new Date().toISOString(),
  };
}

// ---- Finding websites for clients that have none in Settings.
const GENERIC_MAIL_RE = /gmail|googlemail|hotmail|outlook|live\.|yahoo|icloud|btinternet|aol\.|me\.com|mac\.com|protonmail|msn\.|sky\.com|talktalk|virginmedia|ntlworld|blueyonder/i;
// A client's own email domain is nearly always their website.
export function websiteFromEmails(client) {
  for (const e of client.emails || []) { const d = String(e).split("@")[1]?.toLowerCase(); if (d && !GENERIC_MAIL_RE.test(d) && d.includes(".")) return d.replace(/^www\./, ""); }
  return "";
}
export function findWebsitesPrompt(items) {
  const blocks = items.map((it, n) => `### Client ${n + 1}\nclient_id: ${it.id}\nName: ${it.name}${it.type ? `\nType: ${it.type}` : ""}${it.poc ? `\nContact: ${it.poc}` : ""}${it.emails?.length ? `\nEmail domains: ${it.emails.map((e) => e.split("@")[1]).join(", ")}` : ""}${it.notes ? `\nNotes: ${it.notes}` : ""}`).join("\n\n");
  return `You're helping ICL Digital, a web design agency in Richmond (London). These are existing clients of ours whose website we don't have on file. For EACH one, use web search to find their website: search the name (with "UK", the contact's name or the email domain where given), check Google Maps and other listings, Companies House, Facebook, Instagram and LinkedIn pages, and visit the site to confirm it's really them (name, people, address or email domain matching). A social page is not a website: only give one if no website exists, and say so.

Reply with ONLY one JSON code block, no other text, one object per client, keeping each client_id exactly as given:
\`\`\`json
[
  { "client_id": "…", "website": "domain.co.uk or empty if none", "confidence": "high, medium or low", "evidence": "one sentence on what confirmed it", "social": "a Facebook/Instagram/LinkedIn URL if that's all they have, else empty" }
]
\`\`\`

${blocks}`;
}
export function parseWebsitesReply(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in the reply. Paste Claude's whole answer.");
  body = body.slice(start, Math.max(body.lastIndexOf("]"), body.lastIndexOf("}")) + 1);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("The reply isn't valid JSON. Ask Claude to reply with the JSON block only, then paste it again."); }
  const list = Array.isArray(data) ? data : [data];
  const dom = (w) => String(w || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return list.filter((x) => x && x.client_id).map((x) => ({ client_id: String(x.client_id), website: /\./.test(dom(x.website)) && !/facebook|instagram|linkedin|twitter|tiktok/.test(dom(x.website)) ? dom(x.website) : "", confidence: String(x.confidence || "").toLowerCase(), evidence: String(x.evidence || ""), social: /^https?:\/\//.test(String(x.social || "")) ? String(x.social) : "" }));
}

// ---- "Check ideas with Claude": a second opinion on the open ideas before anyone pitches them.
// Claude checks each idea against the live site, sends simple bugs to support and keeps only medium-sized work.
export function checkIdeasPrompt(groups) {
  const blocks = groups.map((g) => {
    const site = (g.recs.find((r) => r.website) || {}).website;
    const ref = (g.recs.find((r) => r.website) || g.recs[0] || {}).id || g.name;
    const lines = g.top.map((i) => `  - [${i.recId}~${i.key}] ${i.title}${i.why ? ` — ${i.why}` : ""}${i.page ? ` (page: ${i.page})` : ""} [${i.service || serviceFor(i.title)}, ~${hoursFor(i)} hrs, ${ideaType(i) === "fix" ? "fix" : "idea"}]`);
    return `${g.name}${site ? ` (https://${site})` : ""} · client ref: ${ref}\n${lines.join("\n")}`;
  });
  return `You are reviewing website ideas for ICL Digital, a web agency, before we pitch them to existing clients. Below are the ideas we have for each client, with our rough hour estimates.

For every idea, visit the client's website and check:
1. Is it accurate? Is the problem real, or does the site already have this feature or page?
2. Is it worth doing? Would it make a real difference to this client's business?

Then give every idea one verdict:

- "bug": something broken or wrong on the live site (broken links, errors, missing images, typos, layout faults, forms not working). A simple job we send straight to our support team, not a pitch. Give the page and exactly what support needs to fix.
- "pitch": new functionality or new pages that add real value, roughly 4 to 20 hours of work on the scale below (for example a booking form, a new service page, a case studies section, a quote calculator).
- "drop": inaccurate, already done, too small to pitch (minor tweaks that are not bugs), too big for now (full redesigns, rebuilds, large projects), or not worthwhile for this client.

${HOURS_SCALE}

If you spot an obvious bug or a better pitch we missed, add it under "new_ideas" with that client's ref.

Reply with ONLY one JSON code block, no other text, covering every idea below (copy each [ref] exactly, without the brackets):
\`\`\`json
{ "idea_check": [
  { "ref": "copy the [ref] exactly", "verdict": "bug | pitch | drop", "hours": 3, "reason": "one line", "page": "https://… (bugs)", "fix": "what support needs to fix (bugs)" }
],
  "new_ideas": [
  { "client_ref": "copy the client ref", "title": "under 60 characters", "verdict": "bug | pitch", "service": "Web design, Web development, SEO, Content, Support…", "hours": 6, "reason": "one or two sentences: what you found", "page": "https://…" }
] }
\`\`\`

${blocks.join("\n\n")}`;
}

// Claude's reply to "Check ideas", tidied.
export function parseIdeaCheck(text) {
  const t = String(text || ""), m = t.match(/```(?:json)?\s*([\s\S]*?)```/i), body = m ? m[1] : t;
  let d; try { d = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)); } catch { throw new Error("That reply isn't valid JSON. Paste Claude's whole JSON block."); }
  const verdict = (v) => (/bug/i.test(v) ? "bug" : /drop/i.test(v) ? "drop" : "pitch");
  const num = (v) => (Number(v) > 0 ? Number(v) : null);
  const url = (v) => (/^https?:\/\//.test(String(v || "")) ? String(v) : "");
  return {
    checks: (Array.isArray(d.idea_check) ? d.idea_check : []).filter((c) => c && String(c.ref || "").includes("~")).map((c) => { const ref = String(c.ref).replace(/^\[|\]$/g, ""), k = ref.lastIndexOf("~"); return { recId: ref.slice(0, k), key: ref.slice(k + 1), verdict: verdict(c.verdict), hours: num(c.hours), reason: String(c.reason || "").slice(0, 300), page: url(c.page), fix: String(c.fix || "").slice(0, 300) }; }),
    added: (Array.isArray(d.new_ideas) ? d.new_ideas : []).filter((n) => n && n.title && n.client_ref).map((n) => ({ recId: String(n.client_ref), title: String(n.title).slice(0, 80), verdict: verdict(n.verdict) === "bug" ? "bug" : "pitch", service: String(n.service || ""), hours: num(n.hours), reason: String(n.reason || "").slice(0, 400), page: url(n.page) })),
  };
}
