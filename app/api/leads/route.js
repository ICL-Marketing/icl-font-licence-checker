import { searchUsage, hunterUsage, applyTradingAddress, leadsConfigured, leadsSearch, worthEnriching, inArea, leadsEnrich, checkWebsite, findEmail, findContacts, seoCheck, leadsRefresh, licenceRisks, scoreLead, draftOutreach, AREA_PRESETS, SECTOR_PRESETS } from "@/lib/leads";

export const dynamic = "force-dynamic";
export const maxDuration = 50;

export async function GET(request) {
  // ?volume=<search> tests the Keyword Planner connection.
  const vq = new URL(request.url).searchParams.get("volume");
  if (vq) {
    try { const { searchVolumes, keywordsConfigured } = await import("@/lib/keywords"); if (!keywordsConfigured()) return Response.json({ ok: false, error: "Google Ads variables are not all set." }); const v = await searchVolumes([vq]); return Response.json({ ok: true, volume: v[vq.toLowerCase()] || 0 }); }
    catch (e) { return Response.json({ ok: false, error: String(e?.message || e) }); }
  }
  let usage = { used: 0, cap: 0 }, hunter = { used: 0, cap: 0, configured: false };
  try { usage = await searchUsage(); } catch {}
  try { hunter = await hunterUsage(); } catch {}
  return Response.json({ configured: leadsConfigured(), brave: Boolean(process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY), hunter: Boolean(process.env.HUNTER_API_KEY), hunterUsage: hunter, usage, areas: Object.fromEntries(Object.entries(AREA_PRESETS).map(([k, v]) => [k, v.label])), sectors: Object.fromEntries(Object.entries(SECTOR_PRESETS).map(([k, v]) => [k, v.label])) });
}

// Steps, each one short request:
//   search  {place, sectors[], startIndex}      -> candidates worth enriching
//   enrich  {company, knownSites[]}             -> one finished lead
//   recheck {website, business, ...lead}        -> re-run the website check and redraft
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const links = b.links && typeof b.links === "object" ? b.links : {};
  try {
    if (b.step === "contacts") {
      const l = b.lead || {};
      if (!l.companyNumber && !l.website) return Response.json({ error: "Needs a company number or a website." }, { status: 400 });
      if (l.companyNumber && !leadsConfigured()) return Response.json({ error: "Companies House is not set up (Settings → Connections), so only the website can be searched." }, { status: 400 });
      const ct = await findContacts({ companyNumber: l.companyNumber, website: l.website, business: l.business, useHunter: !!b.useHunter, forceHunter: !!b.forceHunter });
      const patch = { postcode: l.postcode, area: l.area, caveats: l.caveats || "" };
      applyTradingAddress(patch, ct.tradingAddress, null);
      return Response.json({ ...ct, tradingPostcode: patch.tradingPostcode || "", tradingAddressText: patch.tradingAddress || "", tradesElsewhere: !!patch.tradesElsewhere, caveats: patch.caveats });
    }
    if (b.step === "refresh") {
      if (!b.lead?.business) return Response.json({ error: "lead required" }, { status: 400 });
      const lead = await leadsRefresh({ ...b.lead, links }, { knownSites: new Set((Array.isArray(b.knownSites) ? b.knownSites : []).map((s) => String(s).toLowerCase().replace(/^www\./, ""))) });
      return Response.json({ lead });
    }
    if (b.step === "licence") {
      // Fonts and stock images we are certain are unlicensed; a current site with any becomes a "Licence risk" lead.
      const lead = { ...(b.lead || {}) };
      if (!lead.website) return Response.json({ error: "No website on this lead." }, { status: 400 });
      lead.licence = await licenceRisks(lead.website);
      const any = lead.licence.images.length || lead.licence.fonts.length;
      if (!lead.problem && any) {
        lead.problem = "Licence risk";
        try { if (!lead.contactsTried) { const ct = await findContacts({ companyNumber: lead.companyNumber, website: lead.website, business: lead.business }); lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; lead.contactsTried = true; const best = ct.people.find((p) => p.email); if (best && !lead.emailAddress) { lead.emailAddress = best.email; lead.contactName = lead.contactName || best.name.split(" ")[0]; } } } catch {}
        if (!lead.emailAddress) { lead.contactUnverified = true; lead.status = "no-contact"; } lead.problemDetail = [lead.licence.images.length ? `${lead.licence.images.length} watermarked preview image${lead.licence.images.length === 1 ? "" : "s"}` : "", lead.licence.fonts.length ? `${lead.licence.fonts.length} unlicensed font${lead.licence.fonts.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", "); if (lead.status === "not-pursuing" && /current/i.test(lead.likelihoodWhy || "")) lead.status = "qualified"; }
      if (lead.problem) { Object.assign(lead, scoreLead(lead)); if (!lead.emailEdited) { const d = draftOutreach({ ...lead, links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, draftVersion: d.draftVersion }); } }
      return Response.json({ lead });
    }
    if (b.step === "seo") {
      const l = b.lead || {};
      if (!l.business) return Response.json({ error: "Needs a business name." }, { status: 400 });
      const seo = await seoCheck({ business: l.business, website: l.website, area: l.area, sics: l.sics });
      const lead = { ...l, seo };
      // A current site that is not found for its own trade is a lead in itself: that is business going elsewhere.
      const trade = seo.searches.find((x) => x.kind === "trade" && !x.error);
      if (!lead.problem && lead.website && trade && (trade.position === null || trade.position > 3)) {
        lead.problem = "Low search visibility";
        lead.problemDetail = `${trade.position ? `#${trade.position}` : "Not on page 1"} for "${trade.query}"`;
        try { if (!lead.contactsTried) { const ct = await findContacts({ companyNumber: lead.companyNumber, website: lead.website, business: lead.business }); lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; lead.contactsTried = true; const best = ct.people.find((p) => p.email); if (best && !lead.emailAddress) { lead.emailAddress = best.email; lead.contactName = lead.contactName || best.name.split(" ")[0]; } } } catch {}
        if (!lead.emailAddress) { lead.contactUnverified = true; lead.status = "no-contact"; }
        else if (lead.status === "not-pursuing" && /current/i.test(lead.likelihoodWhy || "")) lead.status = "qualified";
      }
      if (!l.website && seo.foundWebsite) {
        const w = await checkWebsite(seo.foundWebsite);
        Object.assign(lead, { website: seo.foundWebsite, problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "", siteUrl: w.siteUrl || "", caveats: [l.caveats, "Website found by web search, not by name; double-check it is theirs"].filter(Boolean).join("; ") });
        if (!lead.emailAddress) lead.emailAddress = await findEmail(seo.foundWebsite, "").catch(() => "");
      }
      if (lead.problem) { Object.assign(lead, scoreLead(lead)); if (!lead.emailEdited) { const d = draftOutreach({ ...lead, links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, draftVersion: d.draftVersion }); } }
      return Response.json({ seo, lead });
    }
    if (b.step === "redraft-many") {
      // Fresh drafts for several leads at once (no network, so cheap). Hand-edited emails are left alone.
      const leads = (Array.isArray(b.leads) ? b.leads : []).slice(0, 200).map((l) => {
        if (!l.problem || l.emailEdited) return l;
        const d = draftOutreach({ ...l, links });
        return { ...l, emailPrevious: l.email && l.email !== d.email ? l.email : l.emailPrevious, subject: d.subject, pitch: l.source === "Client Matrix v4.1" && l.pitch ? l.pitch : d.pitch, email: d.email, issueId: d.issueId, draftVersion: d.draftVersion };
      });
      return Response.json({ leads });
    }
    if (b.step === "redraft") {
      // Fresh subject, pitch and email from the lead as it stands (works without a website).
      const lead = { ...b.lead };
      if (!lead.problem) return Response.json({ error: "Nothing to pitch: the site is marked as current." }, { status: 400 });
      const d = draftOutreach({ ...lead, links }, b.person || null);
      return Response.json({ lead: { ...lead, subject: d.subject, pitch: d.pitch, email: d.email, issueId: d.issueId, draftVersion: d.draftVersion } });
    }
    if (b.step === "recheck") {
      const lead = { ...b.lead };
      if (!lead.website) return Response.json({ error: "No website on this lead." }, { status: 400 });
      const w = await checkWebsite(lead.website);
      Object.assign(lead, { problem: w.problem, problemDetail: w.detail, platform: w.platform || "", year: w.year || 0, title: w.title || "", siteUrl: w.siteUrl || "" });
      if (!lead.emailAddress) lead.emailAddress = await findEmail(lead.website, "").catch(() => "");
      if (lead.problem) { Object.assign(lead, scoreLead(lead)); if (!lead.email || b.redraft) { const d = draftOutreach({ ...lead, links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, draftVersion: d.draftVersion }); } }
      else { lead.likelihood = "Low"; lead.likelihoodWhy = "Site is current; no outreach planned"; }
      lead.checkedAt = new Date().toISOString();
      return Response.json({ lead });
    }
    if (!leadsConfigured()) return Response.json({ error: "Companies House is not set up. Add COMPANIES_HOUSE_API_KEY in Vercel (free key from developer.company-information.service.gov.uk) and redeploy." }, { status: 400 });
    if (b.step === "search") {
      const place = String(b.place || "").slice(0, 60);
      // No business-type filter: every active company in the place, then the usual sifting (holding and
      // property shells, dormant, too young) before anything is enriched.
      const sics = [...new Set((Array.isArray(b.sectors) ? b.sectors : []).flatMap((k) => SECTOR_PRESETS[k]?.sics || []))];
      if (!place) return Response.json({ error: "place required" }, { status: 400 });
      const { items, total } = await leadsSearch({ place, sics, startIndex: Number(b.startIndex) || 0, size: 100 });
      const minAge = Number(b.minAgeYears) || 2;
      const keys = Array.isArray(b.areas) && b.areas.length ? b.areas : Object.keys(AREA_PRESETS);
      const postcodes = [...new Set(keys.flatMap((k) => AREA_PRESETS[k]?.postcodes || []))];
      const town = "";
      return Response.json({ total, candidates: items.filter((c) => worthEnriching(c, { minAgeYears: minAge }) && inArea(c, { postcodes, town })), scanned: items.length });
    }
    if (b.step === "enrich") {
      if (!b.company?.companyNumber) return Response.json({ error: "company required" }, { status: 400 });
      const lead = await leadsEnrich({ ...b.company, links }, { minAssets: Number(b.minAssets) || 0, knownSites: new Set((Array.isArray(b.knownSites) ? b.knownSites : []).map((s) => String(s).toLowerCase().replace(/^www\./, ""))) });
      return Response.json({ lead });
    }
    return Response.json({ error: "unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
