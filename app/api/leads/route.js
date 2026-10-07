import { leadsConfigured, leadsSearch, worthEnriching, leadsEnrich, checkWebsite, findEmail, scoreLead, draftOutreach, AREA_PRESETS, SECTOR_PRESETS } from "@/lib/leads";

export const dynamic = "force-dynamic";
export const maxDuration = 50;

export async function GET() {
  return Response.json({ configured: leadsConfigured(), areas: Object.fromEntries(Object.entries(AREA_PRESETS).map(([k, v]) => [k, v.label])), sectors: Object.fromEntries(Object.entries(SECTOR_PRESETS).map(([k, v]) => [k, v.label])) });
}

// Steps, each one short request:
//   search  {place, sectors[], startIndex}      -> candidates worth enriching
//   enrich  {company, knownSites[]}             -> one finished lead
//   recheck {website, business, ...lead}        -> re-run the website check and redraft
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  try {
    if (b.step === "redraft") {
      // Fresh subject, pitch and email from the lead as it stands (works without a website).
      const lead = { ...b.lead };
      if (!lead.problem) return Response.json({ error: "Nothing to pitch: the site is marked as current." }, { status: 400 });
      const d = draftOutreach(lead);
      return Response.json({ lead: { ...lead, subject: d.subject, pitch: d.pitch, email: d.email } });
    }
    if (b.step === "recheck") {
      const lead = { ...b.lead };
      if (!lead.website) return Response.json({ error: "No website on this lead." }, { status: 400 });
      const w = await checkWebsite(lead.website);
      Object.assign(lead, { problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "" });
      if (!lead.emailAddress) lead.emailAddress = await findEmail(lead.website, "").catch(() => "");
      if (lead.problem) { Object.assign(lead, scoreLead(lead)); if (!lead.email || b.redraft) { const d = draftOutreach(lead); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email }); } }
      else { lead.likelihood = "Low"; lead.likelihoodWhy = "Site is current; no outreach planned"; }
      lead.checkedAt = new Date().toISOString();
      return Response.json({ lead });
    }
    if (!leadsConfigured()) return Response.json({ error: "Companies House is not set up. Add COMPANIES_HOUSE_API_KEY in Vercel (free key from developer.company-information.service.gov.uk) and redeploy." }, { status: 400 });
    if (b.step === "search") {
      const place = String(b.place || "").slice(0, 60);
      const sics = [...new Set((Array.isArray(b.sectors) ? b.sectors : []).flatMap((k) => SECTOR_PRESETS[k]?.sics || []))];
      if (!place || !sics.length) return Response.json({ error: "place and sectors required" }, { status: 400 });
      const { items, total } = await leadsSearch({ place, sics, startIndex: Number(b.startIndex) || 0, size: 100 });
      const minAge = Number(b.minAgeYears) || 2;
      return Response.json({ total, candidates: items.filter((c) => worthEnriching(c, { minAgeYears: minAge })), scanned: items.length });
    }
    if (b.step === "enrich") {
      if (!b.company?.companyNumber) return Response.json({ error: "company required" }, { status: 400 });
      const lead = await leadsEnrich(b.company, { knownSites: new Set((Array.isArray(b.knownSites) ? b.knownSites : []).map((s) => String(s).toLowerCase().replace(/^www\./, ""))) });
      return Response.json({ lead });
    }
    return Response.json({ error: "unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
