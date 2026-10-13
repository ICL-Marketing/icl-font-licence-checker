// ICL's packages, from the price sheets (Hosting & Support, SEO, PPC, Videography). Picked per proposal:
// each picked group gets its own slide, and Claude is told about them so the copy matches.
// "fixed" groups are a set price for a set amount of work: no hourly rates or hours are mentioned.
export const PACKAGE_GROUPS = [
  {
    id: "support", name: "Hosting & support", title: "Support packages", monthly: true,
    intro: "Starting points only: depending on your needs, we'll put together a custom package.",
    footnote: "All costs exclude VAT. Extra work at £80 per hour.",
    tiers: [
      { id: "hosting", name: "Baseline hosting", price: "£49", period: "per month", best: "Hosting, security and maintenance", items: ["Fast UK hosting, backed up daily", "Proactive maintenance and security patches", "Support by phone and email", "SSL certificate and a single point of contact"] },
      { id: "bronze", name: "Bronze support", price: "£100", period: "per month", best: "Keep your site safe and secure", items: ["All maintenance to keep your site safe and secure", "Reactive and proactive support", "9am – 5pm, Mon–Fri; 8 hour resolution", "1 hour included each month (with flex)"] },
      { id: "silver", name: "Silver support", price: "£375", period: "per month", best: "Regular contact and planning", items: ["Everything in Bronze", "Weekly call with your service delivery manager", "Monthly strategy meetings; 6 hour resolution", "Half a day included each month; 10% off extra work"] },
      { id: "gold", name: "Gold support", price: "£750", period: "per month", best: "A true digital partner", items: ["Everything in Silver", "Half a day on site each month", "Complimentary managed hosting; 4 hour resolution", "One day included each month; 15% off extra work"] },
    ],
  },
  {
    id: "seo", name: "SEO", title: "SEO packages", monthly: true,
    intro: "Ongoing SEO that builds visibility month by month, with clear monthly reporting.",
    footnote: "All prices exclude VAT.",
    tiers: [
      { id: "bronze", name: "Bronze: Strong foundations", price: "£599", period: "per month", best: "Starting your SEO journey", items: ["Search terms, website and competitor analysis", "Meta data, sitemap and Search Console set up", "Ongoing blog content and Google Business Profile activity", "Link profile checks and monthly reports"] },
      { id: "silver", name: "Silver: Growth & momentum", price: "£1,299", period: "per month", best: "Ready to compete and generate regular leads", items: ["Everything in Bronze", "A dedicated account manager", "More content and link building", "Load-speed and security improvements; stronger local visibility"] },
      { id: "gold", name: "Gold: Scale & leadership", price: "£1,999", period: "per month", best: "Established businesses looking to lead their market", items: ["Everything in Silver", "Aggressive content and link-building strategy", "Content for blogs and press opportunities", "Maximum exposure across high-value searches"] },
    ],
  },
  {
    id: "ppc", name: "PPC", title: "PPC packages", monthly: true,
    intro: "Google Ads managed for you: set up in month one, then optimised every week.",
    footnote: "ICL's monthly management fee plus your Google ad spend (paid to Google). All prices exclude VAT.",
    tiers: [
      { id: "bronze", name: "Bronze", price: "£580", period: "per month + £1,000 ad spend", best: "Local businesses testing paid search", items: ["Setup: 2 Google ad sets, conversion tracking, keyword research", "Weekly bid and budget adjustments", "1 ad copy test a month; negative keywords", "Monthly KPI report and a check-in call"] },
      { id: "silver", name: "Silver", price: "£1,160", period: "per month + £2,500 ad spend", best: "Established advertisers ready to scale", items: ["Everything in Bronze, with 4 ad sets", "Full audit, audience targeting and remarketing", "Weekly optimisation; 2 ad tests a month", "Looker Studio reporting; 60 minutes of calls a month"] },
      { id: "gold", name: "Gold", price: "£1,740", period: "per month + £5,000 ad spend", best: "Ambitious brands scaling quickly", items: ["Everything in Silver, with 6 ad sets", "Competitor analysis and landing page CRO advice", "Performance Max and advanced bidding", "Weekly insights and a custom dashboard"] },
    ],
  },
  {
    id: "video", name: "Videography", title: "Videography", fixed: true,
    intro: "From short social clips to brand films: everything from filming on location to professional editing and delivery in every format you need.",
    footnote: "A set price for a set amount of work. Prices exclude VAT.",
    tiers: [
      { id: "day", name: "Videography package", price: "From £1,999", period: "for a 1 day shoot", best: "A complete video project", items: ["Ideation workshop and storyboarding", "A day's shoot on site or on location, with professional kit", "Editing, colour grading, sound and music", "Feedback round and delivery in every format you need"] },
      { id: "custom", name: "Custom production", price: "Quoted", period: "to fit your goals", best: "Bigger or more complex projects", items: ["Extra shoot days", "Second videographer or a photographer", "Actors, creative director and producer", "Music licensing"] },
    ],
  },
];
export const groupOf = (id) => PACKAGE_GROUPS.find((g) => g.id === id);
// Picked packages are stored as "group:tier".
export function pickedPackages(ids = []) {
  const out = [];
  for (const g of PACKAGE_GROUPS) {
    const tiers = g.tiers.filter((t) => ids.includes(`${g.id}:${t.id}`));
    if (tiers.length) out.push({ ...g, picked: tiers.map((t) => t.id) });
  }
  return out;
}
// A line done entirely by a fixed-price package's team (e.g. a video) is priced by the package, not by the hour.
const FIXED_TEAM = { video: "video" };
export const packageFor = (line, picked) => {
  if (line.team.length !== 1) return null;
  const gid = FIXED_TEAM[line.team[0]];
  return gid ? picked.find((g) => g.id === gid && g.fixed) || null : null;
};
export function packagesPromptLines(picked) {
  if (!picked.length) return "";
  return picked.map((g) => {
    const tiers = g.tiers.filter((t) => g.picked.includes(t.id)).map((t) => `${t.name} at ${t.price} ${t.period} (${t.items.join("; ")})`).join(" or ");
    return `- ${g.name}${g.fixed ? " (a set price for a set amount of work: never mention hourly rates or hours for this)" : g.monthly ? " (monthly)" : ""}: ${tiers}`;
  }).join("\n");
}
