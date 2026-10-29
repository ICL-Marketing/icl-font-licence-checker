// What goes on each standard slide of the proposal deck, worked out once: the .pptx builder (app/proposalDeck.js)
// draws it, and the review step shows the same content as slide previews, so what you see is what downloads.
import { TEAMS, range, split, totals, DAY_RATE, lineValue, tierPlan, tierOptions, salePrice, slideOff } from "@/lib/proposal";
import { pickedPackages, packageFor, packagesOf, hourTeams } from "@/lib/packages";

// Template slides never used in client proposal decks (an existing client already knows who else we work for).
export const NOT_IN_CLIENT_DECKS = /^\s*our clients\b/i; // the slide titled "Our clients", not any slide that mentions them
// Teams in one fixed order (Design, Development, SEO…), e.g. "Design, Development".
export const teamList = (team = []) => TEAMS.filter(([k]) => team.includes(k)).map(([, name]) => name).join(", ");
export const hrs = (a, b) => `${range(a, b)} hr${a === b && a === 1 ? "" : "s"}`;
const money = (n) => `£${Math.round(n).toLocaleString("en-GB")}`;
const cap = (s) => String(s || "").replace(/^./, (c) => c.toUpperCase());

export const LINKEDIN_BLOCKS = (posts, prices) => [
  { title: "Company page refresh", text: "A refreshed company page that matches your website, so it looks current and is easy to trust." },
  { title: "Partner profiles", text: "People engage with people, not companies. We bring each partner's profile up to date so it shows their experience." },
  { title: "Content roadmap", text: `${posts} posts per month. We strategise, write and schedule the content, put it on the website and design social banners, working with our Head of Marketing.` },
  { title: "LinkedIn Automations", text: `We scrape data for your ideal customers and use AI automation to connect with and nurture each one through personalised messaging.${prices ? " From £650 per month (ex VAT) per team member." : ""}` },
];
// The support packages table (the template's page 11). The client's own plan is headed CURRENT PLAN.
export const supportTable = (supportPlan = "") => ({
  heads: ["bronze", "silver", "gold"].map((k) => (supportPlan === k ? "CURRENT PLAN" : `${k.toUpperCase()} SUPPORT`)),
  rows: [
    ["Included:", "All maintenance tasks needed to ensure your app or website is safe and secure. Plus reactive and proactive support as needed.", ["Bronze plus:", " Weekly conference call with dedicated service delivery manager and monthly strategic meetings."], ["Silver plus:", " half a day per month on-site visit and complimentary managed hosting."]],
    ["Support hours:", "9am – 5pm, Mon-Fri", "9am – 5pm, Mon-Fri", "9am – 5pm, Mon-Fri, plus emergency out of hours."],
    ["Contractual SLA:", "8 Hour Resolution", "6 Hour Resolution", "4 Hour Resolution"],
    ["Min time included (with flex):", "1 Hour", "Half a day", "One day"],
    ["Out of Hours Support Available:", "Additional Cost £80 per hour", "Included as needed.", "Included as needed."],
    ["On-Going Rate:", "£80 per hour", "£80 per hour", "£80 per hour"],
    ["Discount?", "n/a", "Yes 10% Discount", "Yes 15% Discount"],
  ],
  cost: ["£100.00 ex vat", "£375.00 ex vat", "£750.00 ex vat"],
});
// The service retainer slide: staggered rows of service names (x positions in px of a 1900px-wide slide).
export const SERVICE_ROWS = [
  [333, [[273, "PLATFORMS"], [576, "APPS"], [862, "WEBSITES"], [1137, "SEO"], [1420, "BRANDING"], [1702, "PPC"]]],
  [480, [[284, "ANIMATION\nDESIGN"], [670, "BROCHURE\nDESIGN"], [1056, "CONTENT\nCREATION"], [1490, "PRESENTATION\nTEMPLATES"]]],
  [635, [[391, "HOSTING\nSOLUTIONS"], [786, "SOCIAL MEDIA\nGRAPHICS"], [1184, "CAMPAIGN\nSTRATEGY"], [1602, "COMPETITOR\nRESEARCH"]]],
  [798, [[265, "APP\nSUPPORT"], [597, "WEBSITE\nSUPPORT"], [941, "PLATFORM\nSUPPORT"], [1317, "EMAIL\nCAMPAIGNS"], [1682, "DIGITAL\nSTRATEGY"]]],
  [953, [[226, "POSTER\nDESIGN"], [657, "VIDEOGRAPHY &\nPHOTOGRAPHY"], [1156, "SOCIAL MEDIA\nCAMPAIGNS"], [1627, "SOFTWARE\nMANAGEMENT"]]],
];

// extras: the template's extra slides that can be used, as [{ title, after, i }].
export function deckOutline({ lines, copy, packages = [], dayRate = DAY_RATE, tiers = false, savings = {}, prices = true, overhead = null, extras = [] }) {
  const picked = pickedPackages(packages);
  const pkgOf = (l) => packageFor(l, picked);
  const byKey = Object.fromEntries((copy.ideas || []).map((i) => [i.key, i]));
  const name = (l) => byKey[l.key]?.title || l.title;
  const hide = copy.hide || {};
  const off = (k) => slideOff(hide, k);
  const extraOn = (e) => !NOT_IN_CLIENT_DECKS.test(e.title || "") && !hide[`extra:${e.i}`];
  // Ideas priced by a set package (e.g. a video) don't count towards the hours.
  const hourLines = lines.filter((l) => !pkgOf(l)), fixedLines = lines.filter((l) => pkgOf(l)?.fixed);
  const t = totals(hourLines);
  const show = {
    agenda: !off("agenda"),
    linkedin: !off("linkedin"),
    background: copy.background?.length > 0 && !off("background"),
    wins: copy.wins?.length > 0 && !off("wins"),
    summary: prices && !off("effort") && (hourLines.length > 0 || fixedLines.length > 0),
    costs: prices && !off("costs") && (picked.some((g) => !g.fixed) || !off("linkedin")),
    roadmap: !off("roadmap") && lines.length > 1,
    retainer: copy.retainer?.length > 0 && !off("retainer"),
    support: prices && !off("support"),
    services: !off("services"),
    packages: !off("packages"), // shown even in a deck without prices, when switched on
  };
  // Bronze / Silver / Gold: your own split when you've moved ideas between tiers, otherwise three options to choose from
  // (one slide each: keep the one you like and delete the others).
  const plans = !(tiers && prices) ? [] : typeof tiers === "object" && Object.keys(tiers).length ? [tierPlan(lines, picked, dayRate, tiers, savings)].filter(Boolean) : tierOptions(lines, picked, dayRate, savings);
  const plan = plans[0] || null;
  const packageGroups = show.packages ? picked.filter((g) => !g.fixed && g.id !== "support") : [];

  const agenda = [
    ...extras.filter((e) => e.after === "cover" && extraOn(e) && e.title).map((e) => e.title),
    show.linkedin && "LinkedIn suggestions",
    show.background && "Website ideas: the background",
    lines.length && "Your website ideas",
    show.summary && "Investment summary",
    show.costs && "Monthly costs",
    plan && "Choose your one-off package",
    show.roadmap && "Six-month roadmap",
    show.retainer && "Next: a support retainer",
    show.support && "Support packages",
    show.services && "Service retainer offering",
    ...packageGroups.map((g) => g.title),
  ].filter(Boolean);

  // Investment summary: the hourly work, plus one-off packages (videography) at their set price.
  // Design, Dev and Content always get a column (a dash where empty), plus any other team this proposal uses.
  const used = TEAMS.filter(([k]) => ["design", "dev", "content"].includes(k) || t[k][1] > 0);
  // The Team column follows the hours columns: teams with hours, plus any package team.
  const teamsOf = (l) => { const sp = split(l); return teamList((l.team || []).filter((k) => sp[k] || !hourTeams({ team: [k] }).length)); };
  const costOf = (l) => (l.free ? 0 : salePrice(l, dayRate));
  const tierOf = (g) => g.tiers.find((x) => g.picked.includes(x.id)) || g.tiers[0];
  const rows = [];
  for (const l of hourLines) { const sp = split(l); rows.push({ kind: "idea", free: !!l.free, cells: [name(l).toUpperCase(), teamsOf(l), ...used.map(([k]) => (sp[k] && !l.free ? range(...sp[k]) : "–")), l.free ? `FREE (${hrs(l.min, l.max)})` : hrs(l.min, l.max), l.free ? "FREE" : money(costOf(l))] }); }
  for (const l of fixedLines) { const tr = tierOf(pkgOf(l)); rows.push({ kind: "fixed", cells: [name(l).toUpperCase(), teamsOf(l), ...used.map(() => "–"), cap(String(tr.period || "").replace(/^for an? /i, "")), tr.price] }); }
  const oh = overhead?.hours > 0 ? overhead : null;
  if (oh) rows.push({ kind: "pm", cells: ["PROJECT MANAGEMENT", "Project management", ...used.map(() => "–"), hrs(oh.hours, oh.hours), money(oh.price)] });
  const fixedCost = fixedLines.reduce((n, l) => n + (Number(String(tierOf(pkgOf(l)).price).replace(/[^0-9.]/g, "")) || 0), 0), fromPrice = fixedLines.some((l) => /^from/i.test(tierOf(pkgOf(l)).price));
  rows.push({ kind: "total", cells: ["TOTAL HANDS-ON WORK", "", ...used.map(([k]) => (t[k][1] ? range(t[k][0], t[k][1]) : "–")), `${range(t.min + (oh?.hours || 0), t.max + (oh?.hours || 0))} hrs`, `${fromPrice ? "From " : ""}${money(hourLines.reduce((n, l) => n + costOf(l), 0) + fixedCost + (oh?.price || 0))}`] });
  if (!prices) rows.forEach((r) => r.cells.pop()); // no Cost column
  const summary = { heads: ["Improvement", "Team", ...used.map(([, , short]) => short), "Estimate", ...(prices ? ["Cost"] : [])], teams: used.length, rows };

  // Monthly costs: package work (SEO, PPC…) kept apart from the hours; one-off packages are on the investment summary.
  const costRows = [];
  for (const g of picked.filter((x) => !x.fixed)) for (const tr of g.tiers.filter((x) => g.picked.includes(x.id))) {
    const covers = lines.filter((l) => packagesOf(l, picked).some((x) => x.id === g.id)).map(name);
    costRows.push([(tr.name.toLowerCase().includes(g.name.toLowerCase()) ? tr.name : `${g.name} ${tr.name}`).toUpperCase(), covers.length ? covers.join(", ") : tr.best, `${tr.price} ${tr.period}`]);
  }
  if (show.linkedin) costRows.push(["LINKEDIN AUTOMATIONS", "Automated outreach and follow-up with your ideal customers (one team member)", "£650 per month"]);
  const costs = { rows: costRows, note: ["All prices exclude VAT.", picked.some((g) => g.id === "ppc") && "PPC is our monthly management fee plus your Google ad spend, paid to Google."].filter(Boolean).join(" ") };

  // Bronze / Silver / Gold cards: Bronze lists its ideas (and any free extras); Silver and Gold start
  // "Everything in Bronze / Silver, plus" and list only what they add. Monthly packages sit underneath as an extra.
  const priceOf = (g) => g.tiers.filter((x) => g.picked.includes(x.id)).map((x) => `${x.price} ${x.period}`).join(" or ");
  const tierPrice = (l) => { const g = pkgOf(l); return g?.fixed ? String((g.tiers.find((y) => g.picked.includes(y.id)) || g.tiers[0]).price) : ""; };
  const below = { silver: "bronze", gold: "silver" };
  const tierSlides = plans.map((p) => ({
    cards: ["bronze", "silver", "gold"].map((id) => {
      const prev = below[id] ? new Set(p[below[id]].lines.map((l) => l.key)) : null;
      const own = p[id].lines.filter((l) => !prev?.has(l.key)).map(name);
      const from = p[id].lines.some((l) => /^from/i.test(tierPrice(l)));
      return { id, label: cap(id), price: `${from ? "From " : ""}${money(p[id].price)}`, from, tagline: { bronze: "The essentials", silver: "Everything in Bronze, plus", gold: "Everything in Silver, plus" }[id], items: prev ? own : [...own, ...p.free.map((l) => `${name(l)} (free)`)] };
    }),
    extras: [...new Map(p.monthly.map((l) => packagesOf(l, picked)[0]).filter(Boolean).map((g) => [g.id, [`${g.name} package`, priceOf(g)]])).values()],
  }));

  // Roadmap: the ideas spread over the months, most expensive first, one-off packages included, monthly packages
  // running all the way through. Six months (fewer only when there's little to do), in the packages' build order
  // (Bronze ideas first, then Silver, then Gold) when the options slide is on.
  let roadmap = null;
  if (show.roadmap) {
    const valueOf = (l) => lineValue(l, picked, dayRate), rank = (l) => (plan ? { bronze: 0, silver: 1, gold: 2 }[plan.tierOf[l.key]] ?? 3 : 0);
    const items = [...lines].sort((a, b) => rank(a) - rank(b) || valueOf(b) - valueOf(a));
    const monthly = picked.filter((g) => !g.fixed);
    const n = items.length >= 6 || monthly.length ? 6 : items.length, months = Array.from({ length: n }, () => []);
    if (items.length <= n) items.forEach((l, i) => months[i].push(l));
    else { const target = items.reduce((s, l) => s + Math.max(0, valueOf(l)), 0) / n; let m = 0, sum = 0; items.forEach((l, k) => { const left = items.length - k; if (m < n - 1 && months[m].length && (sum >= target || left <= n - 1 - m)) { m++; sum = 0; } months[m].push(l); sum += Math.max(0, valueOf(l)); }); } // every month gets something
    roadmap = {
      title: copy.roadmapTitle || `Too much in one go? Roadmap it over ${n} month${n === 1 ? "" : "s"} with a support retainer`,
      months: months.map((list) => list.map((l) => name(l) + (l.free ? " (free)" : ""))),
      ongoing: monthly.map((g) => { const tid = g.picked[0]; return { tier: tid, text: `${g.name} ${String((g.tiers.find((x) => x.id === tid) || {}).name || "").split(":")[0].replace(new RegExp(`^${g.name}\\s*`, "i"), "")} (ongoing)`.replace(/\s+\(/, " (") }; }),
    };
  }
  return { picked, pkgOf, byKey, hide, off, show, extraOn, hourLines, fixedLines, t, plans, plan, agenda, summary, costs, tierSlides, roadmap, packageGroups, retainerUpsell: show.retainer };
}
