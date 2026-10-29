// Proposal decks for existing clients: the ideas you pick (and add), the hours behind them,
// and the Claude prompt that writes the deck copy. The deck itself is built in app/proposalDeck.js.
import { hoursFor, serviceFor, HOURS_SCALE } from "@/lib/clientIdeas";
import { packageFor, packagesOf, packagesPromptLines, hourTeams, isPackageLine } from "@/lib/packages";

// [key, name, short name for the effort table]
export const TEAMS = [["design", "Design", "Design"], ["dev", "Development", "Dev"], ["seo", "SEO", "SEO"], ["ppc", "PPC", "PPC"], ["mkt", "Marketing", "Mktg"], ["content", "Content", "Content"], ["video", "Videography", "Video"], ["graphic", "Graphic design", "Graphic"]];
export const DAY_HOURS = 7.5;
// Slides that never change: designed in PowerPoint, exported as a picture and uploaded in Settings → Proposals.
export const FIXED_SLIDES = [["support", "Support packages"], ["services", "Our service retainer offering"], ["seo", "SEO packages"], ["ppc", "PPC packages"], ["video", "Videography"], ["closing", "Closing slide"]];

// Who usually does the work for each kind of idea.
const TEAM_FOR = {
  "Web design": ["design", "dev"], "Web development": ["dev"], "Hosting & maintenance": ["dev"], SEO: ["seo", "dev"], PPC: ["ppc"], Content: ["content"],
  "Social media": ["mkt", "graphic"], Videography: ["video"], Photography: ["video"], Branding: ["graphic"], Integrations: ["dev"], Apps: ["dev", "design"], Support: ["dev"],
};
// Hours are whole numbers; the only part hour is a half hour, for work under an hour (never 1.5 or 0.75).
export const quarter = (n) => (n < 0.75 ? 0.5 : Math.round(n));

// Content that needs a new page or section on the site (news, blog, guides) takes design and development as well as writing.
const NEW_SECTION = /\b(section|page|pages|hub|blog|news|insights|articles|guides?|resources|case studies)\b/i;
// Ongoing search work (a campaign, retainer or monthly SEO) is the SEO package on its own, priced like videography.
const ONGOING_SEO = /\b(ongoing|monthly|retainer|campaign|package|month[- ]to[- ]month)\b/i;
// Blog, news and insight work is writing only: the content team, no design or development.
const WRITING = /\b(blogs?|news|insights?|articles?|newsletters?)\b/i;
// A homepage idea is a full restructure (a new opening plus the new features from the other ideas), not just new copy.
export const HOMEPAGE = /\bhome ?page\b/i;
const teamFor = (i, service) => {
  const text = `${i.title} ${i.why || ""}`;
  if (service === "SEO" && ONGOING_SEO.test(text)) return ["seo"];
  if (WRITING.test(i.title)) return ["content"];
  if (HOMEPAGE.test(i.title)) return ["design", "dev"];
  return ["Content", "Social media"].includes(service) && NEW_SECTION.test(text) ? ["design", "dev", "content"] : TEAM_FOR[service] || ["dev"];
};
// A proposal line from a Client Ideas idea: hours as a range, the team that would do it.
export function lineFromIdea(i) {
  const h = hoursFor(i); // one set figure: min and max stay equal
  const service = i.service || serviceFor(i.title);
  const team = withDesign(teamFor(i, service));
  if (HOMEPAGE.test(i.title) && !WRITING.test(i.title)) return { key: i.key, title: i.title, why: i.why || "", service, min: 10, max: 10, hrs: { design: 3, dev: 7 }, team, ai: !!i.ai, custom: false }; // default: design 3, development 7
  return { key: i.key, title: i.title, why: i.why || "", service, min: quarter(h), max: quarter(h), team, ai: !!i.ai, custom: false };
}
// Development always comes with design.
export const withDesign = (team) => (team.includes("dev") && !team.includes("design") ? ["design", ...team] : team);
export const ownLine = ({ title, why = "", max = 2, team = ["design", "dev"], hrs }) => { const h = hrs ? Object.values(hrs).reduce((a, b) => a + b, 0) || Number(max) || 1 : Number(max) || 1; return { hrs, key: `own:${Date.now().toString(36)}`, title: String(title).trim(), why: String(why).trim(), service: serviceFor(title), min: h, max: h, team: withDesign(team), ai: false, custom: true }; };

// "2–3", "1", "0.5–1"
export const range = (a, b) => { const f = (n) => (Number.isInteger(n) ? String(n) : String(n)); return a === b ? f(a) : `${f(a)}–${f(b)}`; };
// Hours split evenly across the team on the line, for the effort table.
// SEO, PPC and Videography are priced by package, so a line's hours belong to its other teams only.
// Hours per team: set one by one, or (for older lines) the total shared evenly.
// House rule: design is a third of the development time (there is never development without design); content about the same as design.
const WEIGHT = { design: 1, dev: 3, content: 1 };
export function teamHours(line) {
  const ht = TEAMS.map(([k]) => k).filter((k) => hourTeams(line).includes(k)), out = {};
  const w = (k) => WEIGHT[k] || 1, total = ht.reduce((a, k) => a + w(k), 0) || 1;
  for (const k of ht) out[k] = quarter(Number.isFinite(line.hrs?.[k]) ? line.hrs[k] : (line.max * w(k)) / total);
  return out;
}
// A newly ticked team's starting hours, following the house rule from the hours already there.
function startHours(k, hrs) {
  const design = hrs.design ?? (hrs.dev != null ? hrs.dev / 3 : null);
  if (k === "dev" && design != null) return quarter(design * 3);
  if ((k === "design" || k === "content") && design != null) return quarter(design);
  return 1;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
// Changing the teams keeps each team's hours; a newly ticked team starts at 1 hour.
export function withTeam(line, team) {
  team = withDesign(team); // development never goes without design
  const old = teamHours(line), hrs = {};
  for (const k of hourTeams({ team })) if (old[k] != null) hrs[k] = old[k];
  for (const k of hourTeams({ team })) if (hrs[k] == null) hrs[k] = startHours(k, hrs);
  const t = sum(hrs);
  return { team, hrs, ...(t ? { min: t, max: t } : {}) };
}
// Taking a team off clears its hours. Unlike withTeam it doesn't add design back, so any team can come off.
export function withoutTeam(line, k) {
  const hrs = { ...teamHours(line) }; delete hrs[k];
  const t = sum(hrs);
  return { team: (line.team || []).filter((x) => x !== k), hrs, min: t, max: t };
}
export function withHours(line, k, h) { const hrs = { ...teamHours(line), [k]: quarter(h) }; const t = sum(hrs); return { hrs, min: t, max: t }; }
export function split(line) {
  const th = teamHours(line), out = {};
  for (const [k] of TEAMS) out[k] = k in th ? [th[k], th[k]] : null;
  return out;
}
export function totals(lines) {
  const t = { min: 0, max: 0, ...Object.fromEntries(TEAMS.map(([k]) => [k, [0, 0]])) };
  for (const l of lines) {
    if (isPackageLine(l) || l.free) continue; // free work is shown, but not counted
    t.min += l.min; t.max += l.max;
    const s = split(l);
    for (const [k] of TEAMS) if (s[k]) { t[k][0] += s[k][0]; t[k][1] += s[k][1]; }
  }
  return t;
}
// What an idea is worth, for ordering the deck: hourly work at the day rate, package work at its price, free work last.
export const DAY_RATE = 750; // the default; set in Settings → Proposals
export const rateOf = (v) => (Number(v?.rate) > 0 ? Number(v.rate) : DAY_RATE);
// The price of an idea's hours at the day rate, e.g. "£800".
export const priceFor = (line, rate = DAY_RATE) => `£${Math.round((line.max * rate) / DAY_HOURS).toLocaleString("en-GB")}`;
const poundsOf = (p) => Number(String(p || "").replace(/[^0-9.]/g, "")) || 0;
export function lineValue(line, picked = [], rate = DAY_RATE) {
  if (line.free) return -1;
  // A package is worth what the client would spend: monthly ones over 3 months, "From £1,999" as £2,000,
  // and a package wins a tie with hourly work.
  const worth = (t) => { let v = poundsOf(t.price) * (/month/i.test(t.period || "") ? 3 : 1); if (/^from/i.test(String(t.price))) v = Math.ceil(v / 100) * 100; return v ? v + 1 : 0; };
  if (isPackageLine(line)) return Math.max(0, ...packagesOf(line, picked).flatMap((g) => g.tiers.filter((t) => g.picked.includes(t.id)).map(worth)));
  return (line.max * rate) / DAY_HOURS;
}
// The suggested changes as plain text, in deck order, for pasting into the written proposal. No prices.
export function ideasText({ lines, copy }) {
  const byKey = Object.fromEntries((copy?.ideas || []).map((i) => [i.key, i]));
  return lines.map((l, n) => { const c = byKey[l.key] || {}; return [`${n + 1}. ${c.title || l.title}`, c.intro || l.why || "", ...(c.bullets || []).map((b) => b.trim()).filter(Boolean).map((b) => `• ${b}`), c.closing || ""].filter(Boolean).join("\n"); }).join("\n\n");
}

// Bronze, Silver and Gold options from the ideas, most valuable first: Bronze the most important
// (about 40% of the value), Silver adds a few more (about 70%), Gold has everything. Monthly packages are
// left out (they run alongside); free work comes with every tier. Needs at least three paid ideas.
// Bronze / Silver / Gold from the paid ideas. Each idea sits in one tier (auto: the biggest in Bronze, the rest
// spread to roughly 40% and 70% of the total), and `set` overrides that per idea key. Higher tiers include the lower ones.
const TIER_RANK = { bronze: 0, silver: 1, gold: 2 };
// Each tier costs its items' total minus the saving shown on the slide. Bronze has no saving (its total rounded to
// the nearest £50). By default Silver sits close to Bronze (about 17% more, e.g. Glentaffe £4,200 / £4,900) and Gold
// is about 5% off its total; a saving only changes when you set one in the review step (`savings`).
export const SILVER_OVER_BRONZE = 1.17, GOLD_OFF = 0.05;
export function tierPlan(lines, picked = [], rate = DAY_RATE, set = {}, savings = {}) {
  const costOf = (l) => { const g = packagesOf(l, picked)[0]; if (isPackageLine(l)) return g?.fixed ? Number(String((g.tiers.find((t) => g.picked.includes(t.id)) || {}).price || "").replace(/[^0-9.]/g, "")) || 0 : null; return (l.max * rate) / DAY_HOURS; };
  const paid = lines.filter((l) => !l.free && costOf(l) !== null).map((l) => ({ l, cost: costOf(l) })).sort((a, b) => b.cost - a.cost);
  const free = lines.filter((l) => l.free);
  if (paid.length < 3) return null;
  const total = paid.reduce((t, x) => t + x.cost, 0);
  const upTo = (share, min, max) => { let n = 0, sum = 0; while (n < paid.length && (n < min || sum < total * share)) sum += paid[n++].cost; return Math.min(Math.max(n, min), max); };
  const nB = upTo(0.4, 1, paid.length - 2), nS = upTo(0.7, nB + 1, paid.length - 1);
  const tierOf = Object.fromEntries(paid.map((x, n) => [x.l.key, set[x.l.key] in TIER_RANK ? set[x.l.key] : n < nB ? "bronze" : n < nS ? "silver" : "gold"]));
  const upToTier = (r) => paid.filter((x) => TIER_RANK[tierOf[x.l.key]] <= r);
  const r50 = (v) => Math.round(v / 50) * 50, sum = (xs) => xs.reduce((t, x) => t + x.cost, 0);
  const b = upToTier(0), sv = upToTier(1);
  const bronze = r50(sum(b)), silverFull = sum(sv), goldFull = total;
  const set$ = (v) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Math.max(0, Number(v)) : null);
  const silverSave = set$(savings.silver) ?? Math.max(0, silverFull - Math.max(bronze + 50, r50(bronze * SILVER_OVER_BRONZE)));
  const silver = silverFull - silverSave;
  const goldSave = set$(savings.gold) ?? Math.max(0, goldFull - Math.max(silver + 50, r50(goldFull * (1 - GOLD_OFF))));
  const gold = goldFull - goldSave;
  return {
    bronze: { lines: b.map((x) => x.l), price: bronze, full: bronze },
    silver: { lines: sv.map((x) => x.l), price: silver, full: silverFull },
    gold: { lines: paid.map((x) => x.l), price: gold, full: goldFull },
    free,
    monthly: lines.filter((l) => !l.free && costOf(l) === null), // monthly packages (SEO, PPC): offered as extras on top
    tierOf,
    costOf: (l) => paid.find((x) => x.l === l)?.cost || 0,
  };
}

// Days to sell: the top of the range plus a quarter for feedback, testing and launch, rounded up.
export const daysFor = (lines) => Math.max(1, Math.ceil((totals(lines).max * 1.25) / DAY_HOURS));

// Reusable retainer selling points (Settings → Proposals). "always" ones are ticked for every client.
export const RETAINER_DEFAULTS = [
  { id: "local", title: "Local to you", text: "We're based in Richmond, so we can meet in person whenever it helps.", always: false },
  { id: "network", title: "Trusted by over 100 clients", text: "We look after websites for over 100 businesses and organisations, so we know what works.", always: true },
  { id: "services", title: "Lots of services under one roof", text: "Design, development, SEO, PPC, content, video and branding, all from one team.", always: true },
  { id: "team", title: "One team, one contact", text: "A dedicated account manager and the same people who know your site.", always: true },
  { id: "flexible", title: "Flexible by design", text: "Choose the time that suits each month; nothing is wasted.", always: true },
  { id: "built", title: "We built your site", text: "We know your website inside out, so changes are quick and safe.", always: false },
];
export const normalisePoints = (v) => (Array.isArray(v?.items) ? v.items : RETAINER_DEFAULTS).filter((p) => p && p.title).map((p, n) => ({ id: String(p.id || `p${n}`), title: String(p.title), text: String(p.text || ""), always: !!p.always }));

export function proposalPrompt({ client, website, lines, notes = "", points = [], packages = [], keep = null, prices = true }) {
  const hourLines = lines.filter((l) => !isPackageLine(l));
  const t = totals(hourLines);
  const days = daysFor(hourLines);
  const list = lines.map((l, n) => `${n + 1}. [${l.key}] ${l.title}${l.issue ? `\n   Issue: ${l.issue}` : ""}${l.solution ? `\n   Solution: ${l.solution}` : ""}${!l.issue && !l.solution && l.why ? `: ${l.why}` : ""}${(l.links || []).length ? `\n   Pages: ${l.links.join(", ")}` : ""}\n   (${l.service}; ${packageFor(l, packages) ? `priced by the ${packageFor(l, packages).name} package, so no hours` : `${range(l.min, l.max)} hrs${l.free ? ", free of charge: a goodwill extra, say so on its slide" : ""}`}; ${TEAMS.filter(([k]) => l.team.includes(k)).map(([, name]) => name).join(", ")})`).join("\n");
  return `You're writing the copy for a short proposal slide deck from ICL Digital, a web agency in Richmond, London, to an existing client.

Client: ${client}
Website: ${website || "unknown"}
Never name anyone at ICL (no account manager or staff names): say "your dedicated account manager" or "our team".
${hourLines.length && prices ? `Total estimate: ${range(t.min, t.max)} hours, sold as ${days} day${days === 1 ? "" : "s"} of work (the extra covers feedback, testing and launch).\n` : ""}${!prices ? `This deck has no prices or hours: never mention any price, cost, fee, rate, saving, package price, hours, days or time estimate anywhere.${packages.length ? ` Packages may be named (${packages.map((g) => g.name).join(", ")}) but never priced.` : ""}\n` : packages.length ? `Packages we're proposing (use these exact prices; don't invent others):\n${packagesPromptLines(packages)}\nMention them where they fit: fixed-price ones on the matching idea slide, monthly ones in the retainer blocks.\n` : ""}${notes ? `Notes from the account team: ${notes}\n` : ""}
The improvements we're proposing (keep each [key] exactly):
${list}

First look at their website so the copy is specific and true. Then write:
- background: 4 short blocks setting the scene (e.g. when/how the site was built if you can tell, what has changed in what visitors expect, that this is a focused set of improvements rather than a rebuild, the aim). Never invent facts; if you can't confirm something, leave it out.
- wins: up to 4 themes the improvements fall into, each a 1–3 word title and one sentence.
- ideas: one entry per improvement above, same keys, in the same order: a title that is as descriptive as possible but concise (3 to 6 words, naming exactly what we'll add or change, e.g. "Case studies filtered by sector" rather than "Case studies", "Online booking for site visits" rather than "Booking"; no vague words like "improvements", "refresh" or "enhancements" on their own), one intro sentence, 2 to 5 short bullet points of what we'll do (one idea per bullet; a simple, self-explanatory idea gets 2), and a one-line closing benefit (always). Use the issue, solution and pages given for each idea (open the pages) so the slide is specific. Focus the copy on the impact for ${client}, above all how it makes or saves them money: more enquiries or sales, bigger or faster deals, more repeat business, fewer lost leads, less staff time. The intro names the issue and what it costs them today; the closing benefit says the commercial result in their terms. Never invent figures or promise numbers you can't back up. A homepage idea is a full restructure of the page (a new opening plus the new features from the other ideas), not just a copy rewrite. Blog, news and insight ideas are writing by our content team only. Our hours come from the team who will do the work and are usually right: repeat them in "hours". Only give a different figure if the slide promises work the estimate clearly can't cover, and say why in hours_note. Never pad an estimate.
${HOURS_SCALE}
- screenshot: only when the idea changes something that already exists and can be seen on their site: the full address of that page (e.g. the brick library page for a filter idea). Use "" for anything new that isn't on the site yet (a testimonials section, a booking system, a new page), for behind-the-scenes work, and whenever you're unsure. Never fall back to the homepage.
- screenshot_selector: when there's a screenshot, a CSS selector from that page's HTML for the exact part to capture (e.g. "#brick-library", "section.product-grid", "header"), so the picture shows just that part; "" for the top of the page. Prefer a whole section over a small crop, and never a part that would cut through someone's face.
- The idea priced by the SEO package (if there is one) is always the last idea slide and is text only (screenshot and stock both ""). Its bullets are five non-brand search terms people would use to find ${client} (no company or brand names), each checked on real Google UK (google.co.uk), page 1 only: give the position when they're on page 1, otherwise say "not on page 1".
- stock: when there's no screenshot, 2 to 4 words to search a stock photo library for a fitting picture (e.g. "business team meeting"); "" when there's a screenshot.
- retainer: 4 short blocks for the "Next: a support retainer" slide. It comes straight after a month-by-month roadmap slide the app builds from these ideas, so don't describe a roadmap, name months or say how many months it takes. Say why a support retainer suits ${client}${points.length ? `, using these selling points where they fit (keep the facts as given, shape the wording, merge if needed): ${points.map((p) => `"${p.title}: ${p.text}"`).join("; ")}` : " (one team and contact, flexible hours, the same people who know their site)"}. No generic filler.

House style: British English (UK spelling), plain, concise and human, no hype, no exclamation marks, short sentences. Never use em dashes. Keep slide text short. Write to the client ("your website", "your candidates").
${keep ? `\nAlready edited by hand: keep every one of these word for word in your JSON (same text, same order). Only write the parts not listed here.\n${keepText(keep)}\n` : ""}
Reply with ONLY one JSON code block, no other text:
\`\`\`json
{ "proposal": {
  "deck_title": "WEBSITE REFRESH PROPOSAL",
  "background": [ { "title": "BUILT IN 2021", "text": "one or two sentences" } ],
  "wins": [ { "title": "First impressions", "text": "one sentence" } ],
  "ideas": [ { "key": "copy it exactly", "title": "Homepage refresh", "intro": "one sentence", "bullets": ["…"], "closing": "", "screenshot": "", "screenshot_selector": "", "stock": "", "hours": 5, "hours_note": "" } ],
  "retainer": [ { "title": "We built your site", "text": "one or two sentences" } ]
} }
\`\`\``;
}

// ---- Hand edits in the review step ----
// What Claude wrote is kept as copy.original; anything changed since then is a hand edit. Those edits go into
// the prompt as "keep word for word", and are put back over any new reply, so a re-run never loses them.
const TEXT_OF = (i) => ({ title: i.title, intro: i.intro, bullets: i.bullets || [], closing: i.closing || "" });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function copyEdits(copy) {
  const o = copy?.original;
  if (!copy || !o) return null;
  const out = { ideas: {} };
  if (copy.deckTitle !== o.deckTitle) out.deckTitle = copy.deckTitle;
  for (const k of ["background", "wins", "retainer"]) if (!same(copy[k] || [], o[k] || [])) out[k] = copy[k] || [];
  const was = Object.fromEntries((o.ideas || []).map((i) => [i.key, TEXT_OF(i)]));
  for (const i of copy.ideas || []) if (was[i.key] && !same(TEXT_OF(i), was[i.key])) out.ideas[i.key] = TEXT_OF(i);
  return Object.keys(out).length > 1 || Object.keys(out.ideas).length ? out : null;
}
function keepText(k) {
  const lines = [];
  if (k.deckTitle) lines.push(`- deck_title: ${JSON.stringify(k.deckTitle)}`);
  for (const s of ["background", "wins", "retainer"]) if (k[s]) lines.push(`- ${s}: ${JSON.stringify(k[s])}`);
  for (const [key, v] of Object.entries(k.ideas || {})) lines.push(`- idea ${key}: ${JSON.stringify(v)}`);
  return lines.join("\n");
}
// A fresh reply with the hand edits laid back over it. The result's original is Claude's new text.
export function withEdits(reply, edits) {
  const original = JSON.parse(JSON.stringify({ deckTitle: reply.deckTitle, background: reply.background, wins: reply.wins, retainer: reply.retainer, ideas: reply.ideas }));
  if (!edits) return { ...reply, original };
  const out = { ...reply, original };
  if (edits.deckTitle) out.deckTitle = edits.deckTitle;
  for (const k of ["background", "wins", "retainer"]) if (edits[k]) out[k] = edits[k];
  out.ideas = reply.ideas.map((i) => (edits.ideas?.[i.key] ? { ...i, ...edits.ideas[i.key] } : i));
  // Hand edits on an idea Claude has dropped this time are kept as long as the idea is still in the deck.
  return out;
}

export function parseProposalReply(text) {
  const t = String(text || "");
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : t;
  let d;
  try { d = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw new Error("The reply isn't valid JSON. Ask Claude for the JSON block only, then paste it again."); }
  // House style: never an em dash (a comma reads the same).
  const p = JSON.parse(JSON.stringify(d.proposal || d).replace(/\s*\u2014\s*/g, ", "));
  const blocks = (a, n) => (Array.isArray(a) ? a : []).filter((x) => x && x.title).slice(0, n).map((x) => ({ title: String(x.title).trim(), text: String(x.text || "").trim() }));
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    deckTitle: String(p.deck_title || "WEBSITE PROPOSAL").trim().toUpperCase(),
    background: blocks(p.background, 4), wins: blocks(p.wins, 4), retainer: blocks(p.retainer, 4),
    ideas: (Array.isArray(p.ideas) ? p.ideas : []).filter((x) => x && x.key).map((x) => ({
      key: String(x.key), title: String(x.title || "").trim(), intro: String(x.intro || "").trim(),
      bullets: (Array.isArray(x.bullets) ? x.bullets : []).map((b) => String(b).trim()).filter(Boolean).slice(0, 6),
      closing: String(x.closing || "").trim(), shot: /^https?:\/\//i.test(String(x.screenshot || "")) ? String(x.screenshot).trim() : "", shotSel: String(x.screenshot_selector || "").trim().slice(0, 120), stock: String(x.stock || "").trim().slice(0, 60), min: num(x.hours ?? x.max ?? x.min), max: num(x.hours ?? x.max ?? x.min), hoursNote: String(x.hours_note || "").trim(),
    })),
  };
}
