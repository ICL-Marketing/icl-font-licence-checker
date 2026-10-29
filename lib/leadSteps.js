// Lead steps shared by the browser-driven scans (/api/leads) and the morning scan (lib/morningScan.js).
import { findContacts, licenceRisks, scoreLead, draftOutreach } from "@/lib/leads";

// Fonts and stock images we are certain are unlicensed; a current site with any becomes a "Licence risk" lead.
export async function licenceStep(input, links = {}) {
  const lead = { ...(input || {}) };
  lead.licence = await licenceRisks(lead.website);
  const any = lead.licence.images.length || lead.licence.fonts.length;
  if (!lead.problem && any) {
    lead.problem = "Licence risk";
    try { if (!lead.contactsTried) { const ct = await findContacts({ companyNumber: lead.companyNumber, website: lead.website, business: lead.business }); lead.contacts = ct.people; lead.channels = ct.channels; lead.contactsAt = ct.contactsAt; lead.contactsTried = true; const best = ct.people.find((p) => p.email); if (best && !lead.emailAddress) { lead.emailAddress = best.email; lead.contactName = lead.contactName || best.name.split(" ")[0]; } } } catch {}
    if (!lead.emailAddress) { lead.contactUnverified = true; lead.status = "no-contact"; } lead.problemDetail = [lead.licence.images.length ? `${lead.licence.images.length} watermarked preview image${lead.licence.images.length === 1 ? "" : "s"}` : "", lead.licence.fonts.length ? `${lead.licence.fonts.length} unlicensed font${lead.licence.fonts.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", "); if (lead.status === "not-pursuing" && /current/i.test(lead.likelihoodWhy || "")) lead.status = "new";
  }
  if (lead.problem) { Object.assign(lead, scoreLead(lead)); if (!lead.emailEdited) { const d = draftOutreach({ ...lead, links }); Object.assign(lead, { subject: d.subject, pitch: d.pitch, email: d.email, draftVersion: d.draftVersion }); } }
  return lead;
}
