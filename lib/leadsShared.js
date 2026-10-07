// Constants shared by the Website Leads UI and server code (no Node-only imports here).
export const LEAD_STATUSES = [
  ["new", "To assess", "Low likelihood: decide whether to pursue or park"], ["qualified", "Qualified", "Worth contacting"], ["contacted", "Contacted", "Email sent, waiting"], ["cold", "Cold", "No reply after chasing"], ["replied", "Replied", "They answered"], ["meeting", "Meeting", "Call or visit booked"],
  ["won", "Won", "Signed up"], ["no-contact", "Contact not verified", "Worth it, but no verified email yet"], ["not-pursuing", "Not pursuing", "Our call: not worth it"], ["lost", "Lost", "Said no, or went quiet for good"],
];
export const PROBLEMS = ["No website", "Parked domain", "Dead/broken site", "Broken SSL", "Dated template", "Stale copyright", "Licence risk"];

// Keep in step with DRAFT_VERSION in lib/leads.js (that file cannot be imported by the browser).
export const DRAFT_VERSION = 22;

// Bump when the contact-finding logic improves, so parked leads can be retried once more.
export const CONTACTS_VERSION = 2;

// Short follow-up for a lead that has gone quiet: a nudge, the one thing that matters to them, the offer.
export function draftFollowUp(l) {
  const first = l.contactName ? l.contactName.split(" ")[0] : "";
  const hi = first ? `Hi ${first},` : "Hi there,";
  const year = l.year ? ` (the footer still says ${l.year})` : "";
  const hook = {
    "No website": "I still can't find a website for you, and the people searching locally are landing on your competitors instead.",
    "Parked domain": "Your domain is still pointing at a parking page, so anyone who finds you online gets nothing.",
    "Dead/broken site": "The site is still down as I write this, so customers are landing on an error.",
    "Broken SSL": "The security warning is still showing on the site, and it's a quick fix if you'd like it sorted.",
    "Stale copyright": `The site hasn't changed since I last looked${year}, and a refresh would make a real difference to how you come across.`,
    "Dated template": "The template is still holding the site back, and a design built around your brand would stand out straight away.",
    "Licence risk": "The licensing issue I mentioned is still live on the site, and it's cheaper to fix now than if the foundry or library chases you for it.",
  }[String(l.issueId || "").startsWith("font:") || String(l.issueId || "").startsWith("image:") ? "Licence risk" : l.problem] || "The point I mentioned is still there, and we'd happily talk it through.";
  const body = `${hi}\n\n${dayGreeting()}\n\nJust nudging this to the top of your inbox in case it got buried. ${hook}\n\nHappy to help if that's useful, and no problem at all if not.`;
  return { subject: `Re: ${l.subject || "your website"}`, body };
}

// A lead with no verified email is parked as "Contact not verified" unless there is a
// better reason not to pursue it (too small, already a client, nothing to pitch).
export const OTHER_REASON_RE = /under £|already a client|site is current|dormant/i;
export const parkStatus = (l) => (!l.problem || OTHER_REASON_RE.test(`${l.caveats || ""} ${l.likelihoodWhy || ""}`) ? "not-pursuing" : "no-contact");

// ---- One issue, one person: the outreach email ----------------------------------------
//
// The email names a single thing on the site that could cost them money or customers,
// written for the person it goes to: a finance director hears about licence fees, a
// marketing manager about the dated design or the search results, an IT manager about
// the certificate. The greeting is written on the day it is sent.

export function dayGreeting(d = new Date()) {
  const day = d.getDay(); // 0 Sun … 6 Sat
  if (day === 1 || day === 2) return "Hope you are well and had a good weekend.";
  if (day === 3 || day === 4) return "Hope you are well and having a good week.";
  if (day === 5) return "Hope you are well and have a nice weekend planned.";
  return "Hope you are well and having a good weekend.";
}

// What kind of person is this, from their role text.
export function roleGroup(p) {
  const r = `${p?.role || ""} ${p?.why || ""}`.toLowerCase();
  if (/marketing|brand|digital|communications|comms|content|social/.test(r)) return "marketing";
  if (/\b(cto|it|technical|technology|developer|web|systems|infrastructure)\b/.test(r)) return "technical";
  if (/finance|financial|accounts|cfo|bookkeep|payroll/.test(r)) return "finance";
  if (/sales|business development|commercial|account manager/.test(r)) return "sales";
  if (/chef|kitchen|menu|food/.test(r)) return "kitchen";
  if (/operations|office manager|practice manager|general manager|ops\b/.test(r)) return "ops";
  if (/owner|founder|director|managing|ceo|chief|partner|principal|proprietor|chair/.test(r)) return "owner";
  return "other";
}

// Every issue the scan found on this lead, best first, with who would care about it.
export function issuesFor(l) {
  const out = [];
  const lic = l.licence || {};
  const host = String(l.website || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const siteUrl = l.siteUrl || (host ? `https://${host}/` : "");
  const page = (x) => x.page || x.url || siteUrl;
  for (const f of lic.fonts || []) {
    out.push({ id: `font:${f.family}`, kind: "licence-font", label: `Font licence: ${f.family}`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-font", body: f.label === "Demo Font"
        ? `I was just on your website and noticed that it's currently using a demo copy of the font '${f.family}'. Demo fonts are only licensed for testing, not for a live site.\n\nI'd recommend getting this fixed as soon as possible to avoid the font foundry contacting you to request a licence fee or payment for its use.`
        : `I was just on your website and noticed that it's loading the font '${f.family}' from a site that redistributes fonts without a licence.\n\nI'd recommend getting this fixed as soon as possible to avoid the font foundry contacting you to request a licence fee or payment for its use.` });
  }
  for (const f of lic.possibleFonts || []) {
    if (!/Adobe Font Not Linked|Google Font Not Linked|Licence Not Found|Licence Info Missing|Font Awesome Pro|Subscription To Confirm/i.test(f.label)) continue;
    const via = /Adobe/i.test(f.label) ? "Adobe Fonts" : /Google/i.test(f.label) ? "Google Fonts" : "";
    out.push({ id: `font:${f.family}`, kind: "licence-font", label: `Font licence: ${f.family}`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-font", body: /Font Awesome Pro/i.test(f.label)
        ? `I was just on your website and noticed that it's using the paid Font Awesome Pro icons, but there doesn't appear to be a Pro kit on the site.\n\nI'd recommend checking that as soon as possible, as Font Awesome do chase for it, or the free icons swap in easily.`
        : via
        ? `I was just on your website and noticed that it's currently using '${f.family}', but the font doesn't appear to have been embedded correctly via ${via}.\n\nI'd recommend getting this fixed as soon as possible to avoid the font foundry potentially contacting you to request a licence fee or payment for its use.`
        : `I was just on your website and noticed that it's currently using '${f.family}' as font files installed on the server, with no sign of a web licence for it.\n\nI'd recommend checking that as soon as possible, as type foundries do contact businesses to request licence fees for this and it's cheap to put right.` });
  }
  for (const i of lic.images || []) {
    out.push({ id: `image:${i.url}`, kind: "licence-image", label: `Stock image preview (${i.library})`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-image", body: `I was just on your website and noticed that one of the images on ${page(i)} is ${i.library}'s watermarked preview file rather than a licensed download.\n\nI'd recommend replacing or licensing it as soon as possible, as stock libraries do send demands for this and the fees are steep.` });
  }
  for (const i of (lic.possibleImages || []).filter((x) => /Possible preview/i.test(x.detail))) {
    out.push({ id: `image:${i.url}`, kind: "licence-image", label: `Possible stock preview (${i.library})`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-image", body: `I was just on your website and noticed that one of the images on ${page(i)} looks like ${i.library}'s small preview version rather than a licensed download.\n\nWorth checking as soon as possible, as stock libraries do send demands for this and the fees are steep.` });
  }
  const P = l.problem;
  if (P === "Broken SSL") out.push({ id: "ssl", kind: "technical", label: "Security warning (SSL)", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Broken SSL",
    body: `I was just on your website and noticed it's showing a 'Not secure' warning in the browser, because the security certificate isn't working on ${host ? `https://${host}/` : "the https address"}.\n\nI'd recommend getting this fixed as soon as possible: it puts visitors off before they've seen anything, and Google ranks sites without it lower.` });
  if (P === "Dead/broken site") out.push({ id: "dead", kind: "technical", label: "Site not loading", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Dead/broken site",
    body: `I was just trying to look at your website and it isn't loading at the moment (${siteUrl}).\n\nI'd recommend getting it looked at as soon as possible, as customers are landing on an error page right now.` });
  if (P === "Parked domain") out.push({ id: "parked", kind: "technical", label: "Domain shows a parking page", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Parked domain",
    body: `I was just looking for your website and noticed that ${host || "your domain"} currently lands on a parking page rather than a site.\n\nI'd recommend getting it pointed somewhere as soon as possible, as anyone who finds you online is getting nothing at the moment.` });
  if (P === "Stale copyright") out.push({ id: "stale", kind: "design", label: "Dated design", audience: ["marketing", "owner", "sales"], subjectKey: "Stale copyright",
    body: `I was just on your website and noticed the footer still says ${l.year || "an old year"} and the design hasn't been touched in a while.\n\nIt's the first thing new customers judge you on, so a refresh would make a real difference to how you come across. Happy to share a couple of ideas if that's useful.` });
  if (P === "Dated template") out.push({ id: "template", kind: "design", label: "Template site", audience: ["marketing", "owner", "sales"], subjectKey: "Dated template",
    body: `I was just on your website and noticed it's running on ${l.problemDetail ? l.problemDetail.replace(/,.*$/, "").toLowerCase() : "a template builder"}, which limits how it looks and how well it shows up in search.\n\nA design built around your own brand would stand out straight away. Happy to share a couple of ideas if that's useful.` });
  if (P === "No website") out.push({ id: "nosite", kind: "design", label: "No website found", audience: ["owner", "marketing", "sales"], subjectKey: "No website",
    body: `I was just looking for your website and couldn't find one, so people searching for you locally are landing on a directory or a competitor instead.\n\nEven a simple one-page site would fix that. Happy to share a couple of ideas if that's useful.` });
  const st = l.seo?.searches?.find((x) => x.kind === "trade" && !x.error);
  if (st && (st.position === null || st.position > 3)) out.push({ id: "seo", kind: "seo", label: `Not found for "${st.query}"`, audience: ["marketing", "sales", "owner"], subjectKey: "seo",
    body: `I was just searching for "${st.query}" and noticed you ${st.position ? `came up at number ${st.position}` : "weren't on the first page"}${st.ahead?.length ? `, behind ${st.ahead.slice(0, 2).join(" and ")}` : ""}.${st.volume ? ` Around ${st.volume.toLocaleString("en-GB")} people a month make that exact search.` : " That's the search most new customers make."}\n\nA few local SEO changes usually move that. Happy to share what they'd be if that's useful.` });
  return out;
}

// The issue for this person: the best one their role cares about, avoiding ones already
// given to other contacts at the same company where there is a choice.
export function pickIssue(l, person, taken = []) {
  const issues = issuesFor(l);
  if (!issues.length) return null;
  const g = roleGroup(person);
  const fits = issues.filter((i) => i.audience.includes(g));
  const pool = fits.length ? fits : issues.filter((i) => i.audience.includes("owner")).concat(issues);
  return pool.find((i) => !taken.includes(i.id)) || pool[0];
}

export const DEFAULT_SUBJECTS_SHARED = {
  "No website": "Couldn't find you online", "Parked domain": "Your domain isn't showing a website", "Dead/broken site": "Your website is down",
  "Broken SSL": "Your website is showing a security warning", "Stale copyright": "A few thoughts on your website", "Dated template": "Your website could be doing more for you",
  "Licence risk": "Something on your website that could cost you money", "licence-font": "Font licence on your website", "licence-image": "A stock image on your website", seo: "Your website in search", other: "A few thoughts on your website",
};

// The email body for one person and one issue, without the greeting (that is written on the day).
export function draftFor(l, person, issue, subjects = {}) {
  const S = { ...DEFAULT_SUBJECTS_SHARED, ...subjects };
  if (!issue) return { subject: S.other, body: "I was just on your website and had a thought or two that might be useful. Happy to share them if that's of interest.", issueId: "" };
  return { subject: S[issue.subjectKey] || S.other, body: issue.body, issueId: issue.id };
}

// Greeting + body, the way it is copied or opened in Outlook.
export function fullEmail(l, body, person) {
  const first = (person?.name || l.contactName || "").replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").split(" ")[0];
  return `${first ? `Hi ${first},` : "Hi there,"}\n\n${dayGreeting()}\n\n${body}`;
}
