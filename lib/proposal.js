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
// Hours go in quarter hours.
export const quarter = (n) => Math.max(0.25, Math.round(n * 4) / 4);

// Content that needs a new page or section on the site (news, blog, guides) takes design and development as well as writing.
const NEW_SECTION = /\b(section|page|pages|hub|blog|news|insights|articles|guides?|resources|case studies)\b/i;
const teamFor = (i, service) => (["Content", "Social media"].includes(service) && NEW_SECTION.test(`${i.title} ${i.why || ""}`) ? ["design", "dev", "content"] : TEAM_FOR[service] || ["dev"]);
// A proposal line from a Client Ideas idea: hours as a range, the team that would do it.
export function lineFromIdea(i) {
  const h = hoursFor(i); // one set figure: min and max stay equal
  const service = i.service || serviceFor(i.title);
  return { key: i.key, title: i.title, why: i.why || "", service, min: quarter(h), max: quarter(h), team: withDesign(teamFor(i, service)), ai: !!i.ai, custom: false };
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
  for (const k of ht) out[k] = quarter(Number.isFinite(line.hrs?.[k]) ? line.hrs[k] : (line.max * w(k)) / total); // always in quarter hours
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
// (about 40% of the value), Silver adds a few more (about 70%), Gold has everything. Priced so Silver is
// only a little more than Bronze (about 20%), and Gold is the full total less 5%. Monthly packages are
// left out (they run alongside); free work comes with every tier. Needs at least three paid ideas.
// Bronze / Silver / Gold from the paid ideas. Each idea sits in one tier (auto: the biggest in Bronze, the rest
// spread to roughly 40% and 70% of the total), and `set` overrides that per idea key. Higher tiers include the lower ones.
const TIER_RANK = { bronze: 0, silver: 1, gold: 2 };
export function tierPlan(lines, picked = [], rate = DAY_RATE, set = {}) {
  const costOf = (l) => { const g = packagesOf(l, picked)[0]; if (isPackageLine(l)) return g?.fixed ? Number(String((g.tiers.find((t) => g.picked.includes(t.id)) || {}).price || "").replace(/[^0-9.]/g, "")) || 0 : null; return (l.max * rate) / DAY_HOURS; };
  const paid = lines.filter((l) => !l.free && costOf(l) !== null).map((l) => ({ l, cost: costOf(l) })).sort((a, b) => b.cost - a.cost);
  const free = lines.filter((l) => l.free);
  if (paid.length < 3) return null;
  const total = paid.reduce((t, x) => t + x.cost, 0);
  const upTo = (share, min, max) => { let n = 0, sum = 0; while (n < paid.length && (n < min || sum < total * share)) sum += paid[n++].cost; return Math.min(Math.max(n, min), max); };
  const nB = upTo(0.4, 1, paid.length - 2), nS = upTo(0.7, nB + 1, paid.length - 1);
  const tierOf = Object.fromEntries(paid.map((x, n) => [x.l.key, set[x.l.key] in TIER_RANK ? set[x.l.key] : n < nB ? "bronze" : n < nS ? "silver" : "gold"]));
  const upToTier = (r) => paid.filter((x) => TIER_RANK[tierOf[x.l.key]] <= r);
  const r50 = (v) => Math.ceil(v / 50) * 50, sum = (xs) => xs.reduce((t, x) => t + x.cost, 0);
  const b = upToTier(0), sv = upToTier(1);
  const bronze = r50(sum(b)), silverFull = r50(sum(sv)), goldFull = r50(total);
  const silver = Math.max(bronze + 50, Math.min(silverFull, r50(bronze * 1.2)));
  const gold = Math.max(silver + 50, r50(goldFull * 0.95));
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

export function proposalPrompt({ client, website, lines, notes = "", points = [], packages = [], manager = "" }) {
  const am = String(manager || "").trim().split(/\s+/)[0];
  const hourLines = lines.filter((l) => !isPackageLine(l));
  const t = totals(hourLines);
  const days = daysFor(hourLines);
  const list = lines.map((l, n) => `${n + 1}. [${l.key}] ${l.title}${l.why ? `: ${l.why}` : ""} (${l.service}; ${packageFor(l, packages) ? `priced by the ${packageFor(l, packages).name} package, so no hours` : `${range(l.min, l.max)} hrs${l.free ? ", free of charge: a goodwill extra, say so on its slide" : ""}`}; ${TEAMS.filter(([k]) => l.team.includes(k)).map(([, name]) => name).join(", ")})`).join("\n");
  return `You're writing the copy for a short proposal slide deck from ICL Digital, a web agency in Richmond, London, to an existing client.

Client: ${client}
Website: ${website || "unknown"}
${am ? `Their account manager at ICL: ${am}. Whenever the copy mentions the account manager, name them, e.g. "your dedicated account manager, ${am}".\n` : ""}${hourLines.length ? `Total estimate: ${range(t.min, t.max)} hours, sold as ${days} day${days === 1 ? "" : "s"} of work (the extra covers feedback, testing and launch).\n` : ""}${packages.length ? `Packages we're proposing (use these exact prices; don't invent others):\n${packagesPromptLines(packages)}\nMention them where they fit: fixed-price ones on the matching idea slide, monthly ones in the retainer blocks.\n` : ""}${notes ? `Notes from the account team: ${notes}\n` : ""}
The improvements we're proposing (keep each [key] exactly):
${list}

First look at their website so the copy is specific and true. Then write:
- background: 4 short blocks setting the scene (e.g. when/how the site was built if you can tell, what has changed in what visitors expect, that this is a focused set of improvements rather than a rebuild, the aim). Never invent facts; if you can't confirm something, leave it out.
- wins: up to 4 themes the improvements fall into, each a 1–3 word title and one sentence.
- ideas: one entry per improvement above, same keys, in the same order: a short title (max 5 words), one intro sentence, up to 4 short bullet points of what we'll do (match the detail to the idea: a simple, self-explanatory one such as a testimonials section gets one plain intro sentence and no more than 2 bullets, or none; don't explain the obvious), and an optional one-line closing benefit. Our hours come from the team who will do the work and are usually right: repeat them in "hours". Only give a different figure if the slide promises work the estimate clearly can't cover, and say why in hours_note. Never pad an estimate.
${HOURS_SCALE}
- screenshot: only when the idea changes something that already exists and can be seen on their site: the full address of that page (e.g. the brick library page for a filter idea). Use "" for anything new that isn't on the site yet (a testimonials section, a booking system, a new page), for behind-the-scenes work, and whenever you're unsure. Never fall back to the homepage.
- screenshot_selector: when there's a screenshot, a CSS selector from that page's HTML for the exact part to capture (e.g. "#brick-library", "section.product-grid", "header"), so the picture shows just that part; "" for the top of the page.
- retainer: 4 short blocks for the "Next: a support retainer" slide. It comes straight after a month-by-month roadmap slide the app builds from these ideas, so don't describe a roadmap, name months or say how many months it takes. Say why a support retainer suits ${client}${points.length ? `, using these selling points where they fit (keep the facts as given, shape the wording, merge if needed): ${points.map((p) => `"${p.title}: ${p.text}"`).join("; ")}` : " (one team and contact, flexible hours, the same people who know their site)"}. No generic filler.

House style: British English, plain and confident, no hype, no exclamation marks, short sentences. Write to the client ("your website", "your candidates").

Reply with ONLY one JSON code block, no other text:
\`\`\`json
{ "proposal": {
  "deck_title": "WEBSITE REFRESH PROPOSAL",
  "background": [ { "title": "BUILT IN 2021", "text": "one or two sentences" } ],
  "wins": [ { "title": "First impressions", "text": "one sentence" } ],
  "ideas": [ { "key": "copy it exactly", "title": "Homepage refresh", "intro": "one sentence", "bullets": ["…"], "closing": "", "screenshot": "", "screenshot_selector": "", "hours": 5, "hours_note": "" } ],
  "retainer": [ { "title": "We built your site", "text": "one or two sentences" } ]
} }
\`\`\``;
}

export function parseProposalReply(text) {
  const t = String(text || "");
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : t;
  let d;
  try { d = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw new Error("The reply isn't valid JSON. Ask Claude for the JSON block only, then paste it again."); }
  const p = d.proposal || d;
  const blocks = (a, n) => (Array.isArray(a) ? a : []).filter((x) => x && x.title).slice(0, n).map((x) => ({ title: String(x.title).trim(), text: String(x.text || "").trim() }));
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    deckTitle: String(p.deck_title || "WEBSITE PROPOSAL").trim().toUpperCase(),
    background: blocks(p.background, 4), wins: blocks(p.wins, 4), retainer: blocks(p.retainer, 4),
    ideas: (Array.isArray(p.ideas) ? p.ideas : []).filter((x) => x && x.key).map((x) => ({
      key: String(x.key), title: String(x.title || "").trim(), intro: String(x.intro || "").trim(),
      bullets: (Array.isArray(x.bullets) ? x.bullets : []).map((b) => String(b).trim()).filter(Boolean).slice(0, 6),
      closing: String(x.closing || "").trim(), shot: /^https?:\/\//i.test(String(x.screenshot || "")) ? String(x.screenshot).trim() : "", shotSel: String(x.screenshot_selector || "").trim().slice(0, 120), min: num(x.hours ?? x.max ?? x.min), max: num(x.hours ?? x.max ?? x.min), hoursNote: String(x.hours_note || "").trim(),
    })),
  };
}
