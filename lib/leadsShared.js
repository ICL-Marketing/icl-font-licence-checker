// Constants shared by the Website Leads UI and server code (no Node-only imports here).
export const LEAD_STATUSES = [
  ["new", "To assess", "Check each one (Claude can help), then move it to Ready to send"], ["ready", "Ready to send", "Checked by hand: website, contact and email all correct"], ["contacted", "Contacted", "Email sent, waiting"], ["cold", "Cold", "No reply after chasing"], ["replied", "Replied", "They answered"], ["meeting", "Meeting", "Call or visit booked"],
  ["won", "Won", "Signed up"], ["no-contact", "Contact not verified", "Worth it, but no verified email yet"], ["not-pursuing", "Not pursuing", "Our call: not worth it"], ["lost", "Lost", "Said no, or went quiet for good"],
];
export const PROBLEMS = ["No website", "Parked domain", "Dead/broken site", "Broken SSL", "Dated template", "Stale copyright", "Licence risk", "Low search visibility"];

// Keep in step with DRAFT_VERSION in lib/leads.js (that file cannot be imported by the browser).
export const DRAFT_VERSION = 25;

// Bump when the contact-finding logic improves, so parked leads can be retried once more.
export const CONTACTS_VERSION = 2;

// Website evidence that settles it without a person looking; anything softer waits for a click.
export const HARD_EVIDENCE = ["company number on the site", "exact legal name on the site", "registered postcode on the site", "registered street address on the site", "a director named on the site", "a director's email address on the site", "name and the registered postcode area on the site", "confirmed by you", "checked by Claude"];
// Lost and Won leads are history: nothing automatic touches them again.
export const FROZEN = ["lost", "won"];
export const isFrozen = (l) => FROZEN.includes(l?.status);
export const websiteIsVerified = (l) => !l.website || HARD_EVIDENCE.includes(l.websiteVerified || "");

// Shared inboxes (info@, hello@, contact@ …) are not people: no first name, so the email opens "Hi there,".
export const GENERIC_BOX_RE = /^(info|information|hello|hi|hey|enquiries|enquiry|inquiries|contact|contactus|sales|office|mail|email|admin|administrator|shop|bookings|booking|reception|support|accounts|hr|jobs|careers|team|studio|help|post|general|marketing|service|services|customerservice|customerservices|orders|noreply|no-reply|webmaster|press|media|finance|invoices)$/i;
export function firstNameOf(name) {
  const first = String(name || "").replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s/, "").trim().split(/\s+/)[0] || "";
  if (!first || first.includes("@") || !/[a-z]/i.test(first) || GENERIC_BOX_RE.test(first)) return "";
  return first;
}

// Short follow-up for a lead that has gone quiet: a nudge, the one thing that matters to them, the offer.
export function draftFollowUp(l) {
  const first = firstNameOf(l.contactName);
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
    "Low search visibility": "You're still not showing up for the search your customers make, and every week that stays the case that work is going to someone else.",
  }[String(l.issueId || "").startsWith("font") || String(l.issueId || "").startsWith("image:") ? "Licence risk" : l.problem] || "The point I mentioned is still there, and we'd happily talk it through.";
  const body = `${hi}\n\n${dayGreeting()}\n\nJust nudging this to the top of your inbox in case it got buried. ${hook}\n\nHappy to help if that's useful, and no problem at all if not.`;
  return { subject: `Re: ${l.subject || "your website"}`, body };
}

// A lead with no verified email is parked as "Contact not verified" unless there is a
// better reason not to pursue it (too small, already a client, nothing to pitch).
export const OTHER_REASON_RE = /under £|already a client|site is current|dormant/i;
// Every route for an email has been tried (free routes, then Hunter, or Hunter has nothing on file).
export const contactExhausted = (l) => !l.emailAddress && (!!l.hunterTried || l.hunterOnFile === 0);
export const parkStatus = (l) => (!l.problem || OTHER_REASON_RE.test(`${l.caveats || ""} ${l.likelihoodWhy || ""}`) || contactExhausted(l) ? "not-pursuing" : "no-contact");

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
const ALL_ROLES = ["marketing", "sales", "owner", "finance", "ops", "technical", "kitchen", "other"];

// "Avenir W 01 85 1475544" -> "Avenir", "Din Next W 01" -> "Din Next": web-font build suffixes and ids removed.
export const cleanFontName = (n) => String(n || "").replace(/["']/g, "").replace(/\s+W\s*0?\d+\b.*$/i, "").replace(/(\s+\d[\d\s]*)+$/, "").replace(/[-_](regular|webfont|web)$/i, "").trim();
export function issuesFor(l) {
  const out = [];
  const lic = l.licence || {};
  const host = String(l.website || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const siteUrl = l.siteUrl || (host ? `https://${host}/` : "");
  const page = (x) => x.page || x.url || siteUrl;
  // Every font question in one email, worded as a check rather than a verdict: they may well hold a licence.
  const fontNames = [...new Set([...(lic.fonts || []), ...(lic.possibleFonts || []).filter((f) => /Adobe Font Not Linked|Google Font Not Linked|Licence Not Found|Licence Info Missing|Font Awesome Pro|Subscription To Confirm/i.test(f.label))].map((f) => cleanFontName(f.family)).filter(Boolean))];
  if (fontNames.length) {
    const list = fontNames.length === 1 ? `'${fontNames[0]}'` : `${fontNames.slice(0, -1).map((n) => `'${n}'`).join(", ")} and '${fontNames[fontNames.length - 1]}'`;
    const many = fontNames.length > 1;
    out.push({ id: "fonts", kind: "licence-font", certain: (lic.fonts || []).length > 0, label: `Font licence: ${fontNames.join(", ")}`, audience: ["finance", "owner", "marketing", "ops"], subjectKey: "licence-font",
      body: `I was just on your website and noticed it’s using the font${many ? "s" : ""} ${list}. ${many ? "These are commercial fonts" : "It’s a commercial font"} that need${many ? "" : "s"} a licence for use on a website, and it wasn’t clear from the site how ${many ? "they’re" : "it’s"} licensed.\n\nYou may well have this covered already, but it’s worth a quick check, as type foundries do sometimes contact businesses to ask for a licence fee. Just thought I’d flag it.` });
  }
  for (const i of lic.images || []) {
    out.push({ id: `image:${i.url}`, kind: "licence-image", certain: true, label: `Stock image preview (${i.library})`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-image", body: `I was just on your website and noticed that one of the images on ${page(i)} is ${i.library}'s watermarked preview file rather than a licensed download.\n\nI'd recommend replacing or licensing it as soon as possible, as stock libraries do send demands for this and the fees are steep.` });
  }
  for (const i of (lic.possibleImages || []).filter((x) => /Possible preview/i.test(x.detail))) {
    out.push({ id: `image:${i.url}`, kind: "licence-image", label: `Possible stock preview (${i.library})`, audience: ["finance", "owner", "marketing", "ops"],
      subjectKey: "licence-image", body: `I was just on your website and noticed that one of the images on ${page(i)} looks like ${i.library}'s small preview version rather than a licensed download.\n\nWorth checking as soon as possible, as stock libraries do send demands for this and the fees are steep.` });
  }
  const P = l.problem;
  if (P === "Broken SSL") out.push({ id: "ssl", kind: "technical", label: "Security warning (SSL)", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Broken SSL",
    body: `I was just on your website and noticed that it’s currently showing a “Not Secure” warning in the browser, as the security certificate doesn’t appear to be working correctly.\n\nIt’s definitely worth getting this fixed as soon as you can, as the warning can make visitors feel unsure about using the site and may encourage them to leave before they’ve even had a chance to see what you offer. It can also have an impact on your visibility in Google.\n\nJust thought I’d flag it with you so it can be looked into.` });
  if (P === "Dead/broken site") out.push({ id: "dead", kind: "technical", label: "Site not loading", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Dead/broken site",
    body: `I was just trying to look at your website and it isn't loading at the moment (${siteUrl}).\n\nCustomers are landing on an error page right now, so it’s worth getting looked at as soon as you can.\n\nJust thought I’d flag it with you in case nobody had noticed.` });
  if (P === "Parked domain") out.push({ id: "parked", kind: "technical", label: "Domain shows a parking page", audience: ["technical", "ops", "owner", "marketing"], subjectKey: "Parked domain",
    body: `I was just looking for your website and noticed that ${host || "your domain"} currently lands on a parking page rather than a site.\n\nAnyone who finds you online is getting nothing at the moment, so it’s worth getting pointed somewhere as soon as you can.\n\nJust thought I’d flag it with you in case nobody had noticed.` });
  if (P === "Stale copyright") out.push({ id: "stale", kind: "design", label: "Dated design", audience: ["marketing", "owner", "sales"], subjectKey: "Stale copyright",
    body: `I was just on your website and noticed the footer still says ${l.year || "an old year"} and the design hasn't been touched in a while.\n\nIt’s the first thing new customers judge you on, so it might be worth a quick refresh at some point.\n\nJust thought I’d mention it in case it had slipped down the list.` });
  if (P === "Dated template") out.push({ id: "template", kind: "design", label: "Template site", audience: ["marketing", "owner", "sales"], subjectKey: "Dated template",
    body: `I was just on your website and noticed it's running on ${l.problemDetail ? l.problemDetail.replace(/,.*$/, "").toLowerCase() : "a template builder"}, which limits how it looks and how well it shows up in search.\n\nNothing wrong with it as a starting point, but it does hold the site back a bit on both counts.\n\nJust thought I’d mention it in case it was useful.` });
  if (P === "No website") out.push({ id: "nosite", kind: "design", label: "No website found", audience: ["owner", "marketing", "sales"], subjectKey: "No website",
    body: `I was just looking for your website and couldn't find one, so people searching for you locally are landing on a directory or a competitor instead.\n\nEven a simple one-page site would fix that.\n\nJust thought I’d mention it in case it was useful.` });
  // Search visibility comes first: not being found for their trade is business going elsewhere, which we can fix.
  // Only meaningful when they have a site to be found (no site is its own issue above).
  const st = l.website && P !== "No website" ? l.seo?.searches?.find((x) => x.kind === "trade" && !x.error) : null;
  if (st && (st.position === null || st.position > 3)) out.push({ id: "seo", kind: "seo", label: `Not found for "${st.query}"`, audience: ALL_ROLES, rank: 0, subjectKey: "seo",
    body: `I was just searching for "${st.query}" and noticed you ${st.position ? `came up at number ${st.position}` : "weren't on the first page"}.${st.volume ? ` Around ${st.volume.toLocaleString("en-GB")} people a month make that exact search.` : " That's the search most new customers make."}\n\nA few small changes to the site usually sort that out. Just thought I’d flag it, as it’s probably costing you enquiries to your competitors.` });
  // Order: search visibility, then licence risks we are sure of, dated copyright, possible licence issues, the rest.
  const rankOf = (i) => i.rank ?? (i.kind === "licence-font" || i.kind === "licence-image" ? (i.certain ? 1 : 3) : i.id === "stale" ? 2 : 4);
  out.sort((a, b) => rankOf(a) - rankOf(b));
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
  // A dated copyright year is worth a line too, whatever the main issue is.
  const staleYear = l.website && l.year && l.year <= new Date().getFullYear() - 3 && !["stale", "dead", "parked"].includes(issue.id) ? l.year : 0;
  const body = staleYear ? `${issue.body}\n\nWhile I was there I also noticed the footer still says © ${staleYear}, which is a quick one to update.` : issue.body;
  return { subject: S[issue.subjectKey] || S.other, body, issueId: issue.id };
}

// Greeting + body, the way it is copied or opened in Outlook.
export function fullEmail(l, body, person) {
  const first = firstNameOf(person?.name || l.contactName);
  return `${first ? `Hi ${first},` : "Hi there,"}\n\n${dayGreeting()}\n\n${body}`;
}

// Official SIC descriptions for the codes the presets search, for the "what they do" line.
export const SIC_DESC = {
  "47110": "Retail in non-specialised stores with food predominating", "47190": "Other retail in non-specialised stores", "47210": "Retail of fruit and vegetables", "47220": "Retail of meat and meat products", "47230": "Retail of fish and seafood", "47240": "Retail of bread, cakes and confectionery", "47250": "Retail of beverages", "47260": "Retail of tobacco products", "47290": "Other retail of food", "47410": "Retail of computers and software", "47510": "Retail of textiles", "47520": "Retail of hardware, paints and glass", "47530": "Retail of carpets, rugs, wall and floor coverings", "47540": "Retail of electrical household appliances", "47590": "Retail of furniture, lighting and household articles", "47610": "Retail of books", "47620": "Retail of newspapers and stationery", "47640": "Retail of sports goods and bicycles", "47650": "Retail of games and toys", "47710": "Retail of clothing", "47721": "Retail of footwear", "47722": "Retail of leather goods", "47730": "Dispensing chemist", "47750": "Retail of cosmetics and toilet articles", "47760": "Retail of flowers, plants, seeds, pet animals", "47770": "Retail of watches and jewellery", "47781": "Retail of hearing aids / optician", "47782": "Retail of photographic and optical equipment", "47789": "Other retail of new goods in specialised stores", "47990": "Other retail not in stores",
  "56101": "Licensed restaurants", "56102": "Unlicensed restaurants and cafes", "56103": "Take-away food shops", "56210": "Event catering", "56290": "Other food services", "56301": "Licensed clubs", "56302": "Public houses and bars", "55100": "Hotels and similar accommodation", "55209": "Other holiday accommodation",
  "41202": "Construction of domestic buildings", "43210": "Electrical installation", "43220": "Plumbing, heat and air-conditioning installation", "43290": "Other construction installation", "43310": "Plastering", "43320": "Joinery installation", "43330": "Floor and wall covering", "43341": "Painting", "43342": "Glazing", "43390": "Other building completion and finishing", "43910": "Roofing", "43990": "Other specialised construction", "81210": "General cleaning of buildings", "81221": "Window cleaning", "81222": "Specialised cleaning", "81223": "Furnace and chimney cleaning", "81299": "Other cleaning", "81300": "Landscape service activities", "95110": "Repair of computers", "95120": "Repair of communication equipment", "95210": "Repair of consumer electronics", "95220": "Repair of household appliances and garden equipment", "95230": "Repair of footwear and leather goods", "95240": "Repair of furniture", "95250": "Repair of watches, clocks and jewellery", "95290": "Repair of other personal and household goods", "45200": "Maintenance and repair of motor vehicles", "45320": "Retail of motor vehicle parts", "45111": "Sale of new cars", "45112": "Sale of used cars",
  "69101": "Barristers", "69102": "Solicitors", "69109": "Other legal activities", "69201": "Accounting and auditing", "69202": "Bookkeeping", "69203": "Tax consultancy", "70221": "Financial management consultancy", "70229": "Management consultancy", "71111": "Architectural activities", "71112": "Urban planning and landscape architecture", "71121": "Engineering design for industrial process", "71129": "Other engineering activities", "71200": "Technical testing and analysis", "66220": "Insurance agents and brokers", "66190": "Other financial services", "68310": "Real estate agencies", "68320": "Management of real estate", "73110": "Advertising agencies", "73120": "Media representation", "74100": "Specialised design activities", "74201": "Portrait photography", "74202": "Other specialist photography", "74209": "Photographic activities", "74300": "Translation and interpretation", "74909": "Other professional, scientific and technical activities", "78109": "Other employment placement", "78200": "Temporary employment agency", "82990": "Other business support services",
  "86210": "General medical practice", "86220": "Specialist medical practice", "86230": "Dental practice", "86900": "Other human health activities", "96020": "Hairdressing and other beauty treatment", "96040": "Physical well-being activities", "96090": "Other service activities", "93130": "Fitness facilities", "93110": "Operation of sports facilities", "93120": "Sports clubs", "93191": "Activities of racehorse owners", "93199": "Other sports activities", "75000": "Veterinary activities",
  "85100": "Pre-primary education", "85200": "Primary education", "85310": "General secondary education", "85320": "Technical and vocational secondary education", "85410": "Post-secondary non-tertiary education", "85421": "First-degree level higher education", "85422": "Post-graduate level higher education", "85510": "Sports and recreation education", "85520": "Cultural education", "85530": "Driving school activities", "85590": "Other education", "85600": "Educational support services", "88910": "Child day-care activities", "90010": "Performing arts", "90020": "Support activities to performing arts", "90030": "Artistic creation", "90040": "Operation of arts facilities", "91020": "Museums", "93210": "Amusement parks and theme parks", "93290": "Other amusement and recreation",
  "10710": "Manufacture of bread, fresh pastry and cakes", "10720": "Manufacture of biscuits and preserved pastry", "11050": "Manufacture of beer", "11010": "Distilling and blending of spirits", "11020": "Manufacture of wine", "10850": "Manufacture of prepared meals", "13300": "Finishing of textiles", "14190": "Manufacture of other wearing apparel", "16290": "Manufacture of other products of wood", "18129": "Printing", "23410": "Manufacture of ceramic household articles", "25620": "Machining", "31010": "Manufacture of office and shop furniture", "31020": "Manufacture of kitchen furniture", "31090": "Manufacture of other furniture", "32120": "Manufacture of jewellery", "32990": "Other manufacturing",
};
export const sicDescription = (sics) => { for (const c of sics || []) if (SIC_DESC[c]) return SIC_DESC[c]; return ""; };

// ---- Check with Claude (free on your own Claude plan) for leads in To assess.
export function leadCheckPrompt(items) {
  const blocks = items.map((it, n) => `### Lead ${n + 1}
lead_id: ${it.id}
Company: ${it.business}${it.companyNumber ? ` (Companies House ${it.companyNumber})` : ""}
Registered: ${it.address || it.area || "unknown"}
What Companies House says they do: ${it.sic || "unknown"}
Website we matched: ${it.website || "none found"}
Issue our checker found: ${it.issue || "none"}
Contacts we have: ${it.contacts || "none"}${it.parked ? `\nWhy we parked it earlier (re-judge this now): ${it.parked}` : ""}`).join("\n\n");
  return `You're helping ICL Digital, a web design agency in Richmond (London), check new sales leads before we email them. For EACH lead below, use web search to verify:
1. The business: is the website we matched really theirs (check the company name, registration number, address or directors on the site)? If not, find the right website or say there is none.
2. What they actually do, and where they trade from.
3. The issue our checker found: is it real right now? (e.g. visit the site; is the security warning, old footer year or missing site genuine?)
4. The best person to email about their website: the owner, managing director, or marketing lead. Give their name, role, and an email address only if you found it published (their website, LinkedIn, Companies House filings, press). Never guess an address pattern. Include the LinkedIn URL if you found one.
5. Whether they are worth contacting (an active, trading business that would plausibly pay for website work), with a one-sentence reason, and how likely they are to buy website work: High, Medium or Low, with the reason.
6. A one-sentence background: roughly how big they are, how long they've traded, and who their customers are.

Then write a short first email to that person about the one issue, in this style:
- UK English, friendly and plain, no sales pitch, no services list, no exclamation marks. 2 short paragraphs separated by a blank line (write \\n\\n in the JSON). No greeting and no sign-off.
- Open with what I noticed, e.g. "I was just on your website and noticed…". Say "your website", never the web address.
- Explain briefly why it matters to them, then end with something like "Just thought I'd flag it." Only mention facts you confirmed.

Keep every text field to ONE short sentence (under 20 words), no brackets or asides; email_source is just a few words (e.g. "contact page", "LinkedIn").

Reply with ONLY one JSON code block, no other text, in exactly this shape (one object per lead, keep each lead_id exactly as given):
\`\`\`json
[
  {
    "lead_id": "…",
    "website_is_theirs": true,
    "correct_website": "domain.co.uk or empty",
    "website_evidence": "one sentence",
    "what_they_do": "main service as a customer would search for it",
    "location": "town they trade from",
    "issue_confirmed": true,
    "issue_note": "one sentence on what you saw",
    "contact": { "name": "", "role": "", "email": "", "email_source": "where the address is published", "linkedin": "" },
    "worth_contacting": true,
    "reason": "one sentence",
    "likelihood": "High, Medium or Low",
    "likelihood_reason": "one sentence",
    "background": "one sentence",
    "email_subject": "",
    "email_body": "",
    "sources": ["https://…"]
  }
]
\`\`\`

${blocks}`;
}

export function parseLeadCheck(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in the reply. Paste Claude's whole answer.");
  body = body.slice(start);
  body = body.slice(0, Math.max(body.lastIndexOf("]"), body.lastIndexOf("}")) + 1);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("The reply isn't valid JSON. Ask Claude to reply with the JSON block only, then paste it again."); }
  const list = Array.isArray(data) ? data : Array.isArray(data.leads) ? data.leads : [data];
  const dom = (w) => String(w || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return list.filter((x) => x && typeof x === "object" && x.lead_id).map((x) => {
    const c = x.contact && typeof x.contact === "object" ? x.contact : {};
    const email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(c.email || "").trim()) ? String(c.email).trim().toLowerCase() : "";
    return {
      lead_id: String(x.lead_id), website_is_theirs: x.website_is_theirs !== false, correct_website: dom(x.correct_website), website_evidence: String(x.website_evidence || ""),
      what_they_do: String(x.what_they_do || ""), location: String(x.location || ""), issue_confirmed: x.issue_confirmed !== false, issue_note: String(x.issue_note || ""),
      contact: { name: String(c.name || "").trim(), role: String(c.role || "").trim(), email, email_source: String(c.email_source || "").trim(), linkedin: /^https?:\/\//.test(String(c.linkedin || "")) ? String(c.linkedin) : "" },
      worth_contacting: x.worth_contacting !== false, reason: String(x.reason || ""),
      likelihood: ["High", "Medium", "Low"].find((v) => v.toLowerCase() === String(x.likelihood || "").trim().toLowerCase()) || "", likelihood_reason: String(x.likelihood_reason || ""), background: String(x.background || ""),
      email_subject: String(x.email_subject || "").slice(0, 90), email_body: String(x.email_body || "").replace(/\\n/g, "\n"),
      sources: Array.isArray(x.sources) ? x.sources.map(String).filter((u) => /^https?:\/\//.test(u)).slice(0, 12) : [],
      checkedAt: new Date().toISOString(),
    };
  });
}
