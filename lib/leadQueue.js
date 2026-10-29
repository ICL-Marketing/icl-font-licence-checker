// The Claude connector's Check leads job: hands out leads waiting in "To assess" a batch at a time and keeps
// what Claude saves in an inbox for Website Leads to apply (the same as pasting the reply). Leads handed out
// are held for 20 minutes so two runs never take the same ones; leads already in the inbox are skipped.
import { getResults, getResult, setResult, cacheGet, cacheSet } from "@/lib/store";
import { leadCheckPrompt, sicDescription, isFrozen } from "@/lib/leadsShared";

const BATCH = 10, HOLD = 20 * 60;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

// The same leads the Check leads prompt offers by default: To assess, never checked by Claude, not frozen or opted out.
const waiting = (l) => l && (l.status || "new") === "new" && !l.claude && !isFrozen(l) && !l.optedOut;
const itemOf = (l) => ({
  id: l.id, business: l.business, companyNumber: l.companyNumber, address: l.address || l.area, sic: sicDescription(l.sics || []), website: l.website || "",
  issue: [l.problem, l.problemDetail].filter(Boolean).join(": "),
  contacts: (l.contacts || []).slice(0, 5).map((p) => `${p.name} (${p.role}${p.email ? `, ${p.email}` : ""})`).join("; "),
  parked: "", avoid: (l.avoidFindings || []).join(" | "), tracking: l.trackingGap || "",
});

export async function nextLeadsBatch() {
  const [leads, inbox] = await Promise.all([getResults("leads"), getResults("lead-inbox").catch(() => ({}))]);
  const free = [];
  for (const l of Object.values(leads).filter(waiting)) {
    if (inbox[l.id] || (await cacheGet(`claim:lead-check:${l.id}`))) continue;
    free.push(l);
  }
  if (!free.length) return { done: true, text: "All done: there are no leads waiting to be checked. Stop here." };
  const pick = free.slice(0, BATCH), batch = `C-${stamp()}`;
  await Promise.all(pick.map((l) => cacheSet(`claim:lead-check:${l.id}`, batch, HOLD)));
  const left = free.length - pick.length;
  const text = `Batch ${batch}: ${pick.length} lead${pick.length === 1 ? "" : "s"}${left ? ` (${left} more waiting after these)` : " (the last ones)"}.

Research every lead below as the instructions say. Do not stop to ask anything. Split the list between sub-agents if that is quicker.
When finished, do NOT reply with a code block: call save_lead_checks with {"batch": "${batch}", "leads": [ one object per lead, in exactly the JSON shape below ]}. Then call get_next_leads again, and keep going until it says all done.

${leadCheckPrompt(pick.map(itemOf))}`;
  return { done: false, batch, ids: pick.map((l) => l.id), text };
}

export async function saveLeadChecks({ batch = "", leads = [] } = {}) {
  const rows = (Array.isArray(leads) ? leads : []).filter((x) => x && typeof x === "object" && x.lead_id);
  const at = new Date().toISOString();
  let saved = 0; const unknown = [];
  for (const row of rows) {
    const id = String(row.lead_id);
    if (!(await getResult("leads", id))) { unknown.push(id); continue; }
    await setResult("lead-inbox", id, { row, batch: String(batch), at }); // saving the same lead twice replaces it
    await cacheSet(`claim:lead-check:${id}`, null, 1);
    saved++;
  }
  return `Saved ${saved} lead check${saved === 1 ? "" : "s"}${unknown.length ? `; not recognised (left out): ${unknown.join(", ")}` : ""}. Now call get_next_leads for the next ones.`;
}
