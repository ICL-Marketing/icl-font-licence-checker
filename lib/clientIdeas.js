// Client Ideas: turns what a client's website shows into concrete, friendly suggestions we can
// send to an existing client. Plain JavaScript, safe to import in the browser (no Node modules).
import { dayGreeting, firstNameOf } from "@/lib/leadsShared";

// Board columns, left to right.
export const IDEA_STATUSES = [
  ["idea", "Ideas", "Spotted on their site"],
  ["shortlist", "Shortlisted", "Worth raising"],
  ["ready", "Ready to send", "Checked by hand"],
  ["pitched", "Sent", "Suggested to the client"],
  ["agreed", "Agreed", "They want it done"],
  ["done", "Done", "Delivered"],
  ["not-now", "Not now", "Parked or declined"],
];

export const IDEA_KINDS = {
  fix: { label: "Fix", tone: "bg-red-600" },
  growth: { label: "Growth", tone: "bg-blue-600" },
  content: { label: "Content", tone: "bg-emerald-600" },
  compliance: { label: "Compliance", tone: "bg-purple-600" },
  design: { label: "Design", tone: "bg-amber-500" },
};

const SERVICES = { video: "https://icldigital.com/services/videography/" };

const close = "Just thought I’d flag it. Happy to sort it for you if that’s useful.";
const host = (w) => String(w || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");

// Every rule: when it applies, and the idea it produces. Order = priority on the board.
const RULES = [
  { key: "ssl", kind: "fix", when: (s) => s.problem === "Broken SSL", title: () => "Fix the security certificate",
    why: (s) => s.problemDetail || "Browsers show a “Not secure” warning.",
    subject: "Your website is showing a security warning",
    body: (s) => `I was just on ${host(s.website)} and noticed that it’s currently showing a “Not Secure” warning in the browser, as the security certificate doesn’t appear to be working correctly.\n\nIt’s worth getting this fixed as soon as you can, as the warning can put visitors off before they’ve seen anything, and it can affect where you show up in Google.\n\n${close}` },
  { key: "down", kind: "fix", when: (s) => s.problem === "Dead/broken site", title: () => "Site not loading properly",
    why: (s) => s.problemDetail || "The homepage did not load.",
    subject: "I think your site might be down?",
    body: (s) => `I was just trying to look at ${host(s.website)} and it doesn’t seem to be loading properly at the moment.\n\nWorth a quick look as soon as you can, as anyone visiting is landing on an error.\n\n${close}` },
  { key: "font", kind: "compliance", when: (s) => (s.licence?.fonts || []).length > 0 || (s.licence?.possibleFonts || []).length > 0, title: (s) => `Font licence: ${[...(s.licence?.fonts || []), ...(s.licence?.possibleFonts || [])][0]?.family || "check"}`,
    why: (s) => { const f = [...(s.licence?.fonts || []), ...(s.licence?.possibleFonts || [])][0]; return f ? `${f.family}: ${f.detail || f.label}` : "Font licensing to check."; },
    subject: "Font licence on your website",
    body: (s) => { const f = [...(s.licence?.fonts || []), ...(s.licence?.possibleFonts || [])][0]; return `I was just on ${host(s.website)} and noticed that it’s using the font '${f?.family || "one of your fonts"}', but it doesn’t look like it’s licensed for web use the way it’s set up at the moment.\n\nIt’s worth getting this sorted to avoid the font foundry potentially contacting you to request a licence fee.\n\n${close}`; } },
  { key: "image", kind: "compliance", when: (s) => (s.licence?.images || []).length > 0, title: (s) => `Stock image licence (${s.licence.images[0].library || "stock"})`,
    why: (s) => `${s.licence.images.length} image${s.licence.images.length === 1 ? "" : "s"} look like watermarked previews rather than licensed downloads.`,
    subject: "A stock image on your website",
    body: (s) => `I was just on ${host(s.website)} and noticed that one of the images looks like ${s.licence.images[0].library || "a stock library"}’s preview file rather than a licensed download.\n\nIt’s worth replacing or licensing it, as stock libraries do send demands for this.\n\n${close}` },
  { key: "seo", kind: "growth", when: (s) => { const t = s.seo?.searches?.find((x) => x.kind === "trade" && !x.error); return !!t && (t.position === null || t.position > 3); },
    title: (s) => `Not found for “${s.seo.searches.find((x) => x.kind === "trade").query}”`,
    why: (s) => { const t = s.seo.searches.find((x) => x.kind === "trade"); return `${t.position ? `#${t.position}` : "Not on page 1"} for “${t.query}”${t.ahead?.length ? `, behind ${t.ahead.slice(0, 2).join(", ")}` : ""}.`; },
    subject: "Your website in search",
    body: (s) => { const t = s.seo.searches.find((x) => x.kind === "trade"); return `I was just searching for “${t.query}” and noticed you ${t.position ? `came up at number ${t.position}` : "weren’t on the first page"}. That’s the search most new customers make.\n\nA few small changes to the site usually sort that out. Just thought I’d flag it, as it’s probably sending enquiries to competitors. Happy to help if that’s useful.`; } },
  { key: "copyright", kind: "content", when: (s) => s.year && s.year < new Date().getFullYear(), title: (s) => `Footer still says © ${s.year}`,
    why: (s) => `The footer copyright year is ${s.year}. Visitors read an old year as an unloved site.`,
    subject: "Quick one on your website footer",
    body: (s) => `I was just on ${host(s.website)} and noticed the footer still says © ${s.year}.\n\nIt’s a tiny thing, but visitors do notice it. We can set it to update itself every year so it never comes up again.\n\n${close}` },
  { key: "template", kind: "design", when: (s) => s.problem === "Dated template", title: (s) => `Running on ${String(s.problemDetail || "a template builder").replace(/,.*$/, "")}`,
    why: (s) => s.problemDetail || "Built on a template platform.",
    subject: "A thought on your website",
    body: (s) => `I was just on ${host(s.website)} and noticed it’s running on ${String(s.problemDetail || "a template builder").replace(/,.*$/, "").toLowerCase()}, which limits how it looks and how well it shows up in search.\n\nWhenever you’re ready for the next version, a site built around your brand would stand out straight away. Happy to share a couple of ideas if that’s useful.` },
  { key: "video", kind: "content", when: (s) => s.signals && !s.signals.video, title: () => "Short video on the homepage",
    why: () => "No video on the homepage. A 10 second clip at the top builds trust fast.",
    subject: "An idea for your homepage",
    body: (s) => `I was just on ${host(s.website)} and had a thought: a short 10 second video at the top of the homepage could be one of the most impactful changes you make. It shows visitors straight away that you’re a real, established business.\n\nWe can film and edit it for you: ${SERVICES.video}\n\nHappy to talk it through if that’s of interest.` },
  { key: "reviews", kind: "growth", when: (s) => s.signals && !s.signals.reviews, title: () => "Show reviews or testimonials",
    why: () => "No reviews or testimonials found on the homepage.",
    subject: "Your reviews on your website",
    body: (s) => `I was just on ${host(s.website)} and noticed there aren’t any reviews or testimonials on the homepage.\n\nPulling a few of your best ones onto the site is one of the easiest ways to win more enquiries, and we can link it to your Google reviews so it stays up to date.\n\n${close}` },
  { key: "form", kind: "growth", when: (s) => s.signals && !s.signals.form, title: () => "Add an enquiry form",
    why: () => "No enquiry form found on the homepage or contact page.",
    subject: "Making it easier to get in touch",
    body: (s) => `I was just on ${host(s.website)} and noticed there isn’t an enquiry form, so people have to email or call.\n\nA simple form tends to bring in more enquiries, especially out of hours, and they come straight to your inbox.\n\n${close}` },
  { key: "analytics", kind: "growth", when: (s) => s.signals && !s.signals.analytics, title: () => "Set up visitor analytics",
    why: () => "No Google Analytics or Tag Manager found, so there is no record of visitors or enquiries.",
    subject: "Seeing who visits your website",
    body: (s) => `I was just on ${host(s.website)} and noticed there doesn’t seem to be any analytics set up, so there’s no record of how many people visit or where they come from.\n\nIt’s quick to add and makes it much easier to see what’s working.\n\n${close}` },
  { key: "cookies", kind: "compliance", when: (s) => s.signals && s.signals.analytics && !s.signals.consent, title: () => "Cookie consent banner",
    why: () => "Tracking runs on the site but no cookie consent tool was found.",
    subject: "Cookie banner on your website",
    body: (s) => `I was just on ${host(s.website)} and noticed it uses tracking cookies but doesn’t seem to ask visitors for consent first.\n\nUK rules expect a consent banner for this, so it’s worth adding one to stay on the right side of it.\n\n${close}` },
  { key: "meta", kind: "growth", when: (s) => s.signals && (!s.signals.metaDescription || !s.signals.ogImage), title: (s) => (!s.signals.metaDescription ? "Missing search description" : "No preview image when shared"),
    why: (s) => (!s.signals.metaDescription ? "The homepage has no meta description, so Google writes its own snippet." : "No social preview image, so links shared on WhatsApp, LinkedIn or Facebook show a blank card."),
    subject: "How your website looks in Google and when shared",
    body: (s) => (!s.signals.metaDescription
      ? `I was just on ${host(s.website)} and noticed the homepage doesn’t have a search description, so Google picks its own bit of text to show under your name.\n\nIt’s a quick fix and gives you control over what people read before they click.\n\n${close}`
      : `I was just on ${host(s.website)} and noticed that when the site is shared on WhatsApp, LinkedIn or Facebook it doesn’t show a preview image.\n\nIt’s a quick fix and makes shared links look far more inviting.\n\n${close}`) },
  { key: "mobile", kind: "fix", when: (s) => s.signals && !s.signals.viewport, title: () => "Not set up for mobile",
    why: () => "No mobile viewport tag, so phones show a shrunk desktop page.",
    subject: "Your website on mobile",
    body: (s) => `I was just looking at ${host(s.website)} on my phone and it doesn’t seem to be set up for mobile, so it shows a shrunk-down desktop version.\n\nMost visitors will be on a phone, so it’s worth sorting.\n\n${close}` },
  { key: "alt", kind: "compliance", when: (s) => s.signals && s.signals.imagesNoAlt >= 5, title: (s) => `${s.signals.imagesNoAlt} images without alt text`,
    why: (s) => `${s.signals.imagesNoAlt} of ${s.signals.images} homepage images have no alt text, which screen readers and Google rely on.`,
    subject: "A quick accessibility point on your website",
    body: (s) => `I was just on ${host(s.website)} and noticed a number of images on the homepage don’t have descriptions (alt text), which screen readers and Google both rely on.\n\nIt’s a quick one to tidy up and helps with accessibility and search.\n\n${close}` },
  { key: "speed", kind: "fix", when: (s) => s.signals && s.signals.ms > 4000, title: () => "Homepage is slow to load",
    why: (s) => `The homepage took ${(s.signals.ms / 1000).toFixed(1)}s to respond.`,
    subject: "Your website’s loading speed",
    body: (s) => `I was just on ${host(s.website)} and noticed the homepage takes a little while to load.\n\nSpeeding it up usually means fewer people giving up before it appears, and Google takes it into account too.\n\n${close}` },
  { key: "blog", kind: "content", when: (s) => s.signals && !s.signals.blog, title: () => "Start a news or blog section",
    why: () => "No news, blog or articles section found.",
    subject: "An idea for your website",
    body: (s) => `I was just on ${host(s.website)} and had a thought: a simple news or blog section would give you a place to share projects and updates.\n\nIt helps with search over time and gives you something to post on social too.\n\n${close}` },
];

export const IDEA_RULE_KEYS = RULES.map((r) => r.key);

// Build the ideas for one client site, keeping anything a person already did with an idea
// (its status, notes, edited email) when the same idea comes up again.
export function ideasFor(site, previous = []) {
  const prev = new Map((previous || []).map((i) => [i.key, i]));
  const out = [];
  for (const r of RULES) {
    let applies = false;
    try { applies = !!r.when(site); } catch { applies = false; }
    if (!applies) continue;
    const old = prev.get(r.key);
    const draft = { subject: r.subject, body: r.body(site) };
    out.push({
      key: r.key, kind: r.kind, title: r.title(site), why: r.why(site), rank: out.length,
      status: old?.status || "idea", notes: old?.notes || "", statusAt: old?.statusAt || "",
      subject: old?.edited ? old.subject : draft.subject, email: old?.edited ? old.email : draft.body, edited: !!old?.edited,
      foundAt: old?.foundAt || new Date().toISOString(),
    });
  }
  // Ideas that no longer apply (fixed on the site) are kept only if someone already moved them on.
  for (const [key, old] of prev) if (!out.some((i) => i.key === key) && old.status && old.status !== "idea") out.push({ ...old, resolved: true });
  return out;
}

// Greeting + body, written on the day it is sent.
export function ideaEmail(client, idea, toEmail = "") {
  const pocFirst = firstNameOf(String(client?.poc || "").split(/\n|,/)[0]);
  const fromEmail = firstNameOf(String(toEmail || "").split("@")[0].replace(/[._-].*$/, ""));
  const first = pocFirst || (fromEmail && fromEmail.length > 2 ? fromEmail[0].toUpperCase() + fromEmail.slice(1) : "");
  return `${first ? `Hi ${first},` : "Hi there,"}\n\n${dayGreeting()}\n\n${idea.email || ""}`;
}
