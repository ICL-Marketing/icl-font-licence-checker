// The morning lead scan: the Website Leads Companies House searches (New businesses, Rebrands & new directors,
// All companies) run on the server before the working day, with the same steps and rules as the buttons:
// the team's scan area, companies checked in the last 90 days skipped, the £20k net assets floor, the licence
// check, and new leads saved straight to the shared board (the page picks them up when it opens).
// Started by /api/cron (a daily schedule) or Settings → Leads → Run now. Google Maps and job ads stay manual.
import { leadsSearch, worthEnriching, inArea, leadsEnrich, leadTriggers, setPatchOutcodes } from "@/lib/leads";
import { licenceStep } from "@/lib/leadSteps";
import { getSetting, setSetting, getResults, getResult, setResult, getClients, cacheGet, cacheSet, pushActivity } from "@/lib/store";
import { mergeDoc } from "@/lib/merge";
import { slimLead } from "@/lib/slimLead";
import { isFrozen } from "@/lib/leadsShared";

export const MORNING_MODES = [["new", "New businesses"], ["triggers", "Rebrands & new directors"], ["all", "All companies"]];
const SEEN_DAYS = 90, PAGES = 5, LOCK = "morning-scan:running";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (w) => String(w || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const day = () => new Date().toISOString().slice(0, 10);

export async function morningConfig() {
  const v = await getSetting("morning-scan-config").catch(() => null);
  const modes = Array.isArray(v?.modes) ? v.modes.filter((m) => MORNING_MODES.some(([k]) => k === m)) : MORNING_MODES.map(([k]) => k);
  return { on: v?.on !== false, modes };
}
export const morningRunning = async () => Boolean(await cacheGet(LOCK).catch(() => null));

// Runs every mode in turn until done or out of time; one run at a time. The summary is saved as "morning-scan".
export async function runMorningScan({ modes, by = "Morning scan", maxMinutes = 55 } = {}) {
  if (await morningRunning()) return { skipped: "A scan is already running." };
  await cacheSet(LOCK, { at: new Date().toISOString(), by }, maxMinutes * 60 + 300);
  const deadline = Date.now() + maxMinutes * 60000, late = () => Date.now() > deadline;
  const s = { startedAt: new Date().toISOString(), by, modes, checked: 0, found: 0, parked: 0, tagged: 0, newLeads: [], errors: [], stoppedEarly: false };
  const note = async () => { await setSetting("morning-scan", { ...s, running: true }).catch(() => {}); };
  try {
    const area = await getSetting("lead-area");
    if (!area?.outcodes?.length || !area?.places?.length) throw new Error("No scan area: set the towns and radius on Website Leads first.");
    setPatchOutcodes(area.outcodes);
    const postcodes = area.outcodes.map((x) => String(x).toUpperCase());
    const links = (await getSetting("lead-links")) || {};
    const FLOOR = Number((await getSetting("lead-floor").catch(() => null))?.value) || 20000; // Settings → Lead maintenance
    const leads = await getResults("leads");
    const known = new Set(Object.keys(leads));
    const seen = (await getSetting("leads-seen")) || {};
    const recently = (n) => seen[n] && (Date.now() - new Date(seen[n].at).getTime()) / 86400000 < SEEN_DAYS;
    const knownSites = new Set((await getClients().catch(() => [])).flatMap((c) => c.websites || []).map(host));
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const save = async (lead) => {
      const cur = await getResult("leads", lead.id).catch(() => null);
      const data = slimLead(cur ? mergeDoc(cur, lead) : lead);
      await setResult("leads", lead.id, data);
      if (!cur) await pushActivity({ at: new Date().toISOString(), who: by, area: "leads", item: String(lead.id), label: String(lead.business || "").slice(0, 120), changes: ["Added by the morning scan"] }).catch(() => {});
    };
    const done = [];
    for (const mode of modes) {
      if (late()) { s.stoppedEarly = true; break; }
      // 1. Companies House search across the area's towns, sifted as on the page.
      let candidates = [];
      for (const pl of area.places) {
        if (late()) break;
        let start = 0;
        for (let page = 0; page < PAGES; page++) {
          let res;
          try { res = await leadsSearch({ place: pl, sics: [], startIndex: start, size: 100, incorporatedFrom: mode === "new" ? since : "" }); }
          catch (e) { if (/rate|429/i.test(String(e?.message))) { await sleep(60000); page--; continue; } s.errors.push(`${pl}: ${e.message}`); break; }
          for (const c of res.items.filter((x) => worthEnriching(x, { minAgeYears: mode === "new" ? 0 : 2 }) && inArea(x, { postcodes, town: "" }))) {
            if (mode === "triggers") { if (!candidates.some((x) => x.companyNumber === c.companyNumber)) candidates.push(c); continue; }
            if (known.has(c.companyNumber)) continue;
            known.add(c.companyNumber);
            if (recently(c.companyNumber)) continue;
            candidates.push(mode === "new" ? { ...c, source: "New business", triggerKind: "new", trigger: `Set up on ${new Date(c.incorporated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`, triggerAt: c.incorporated } : c);
          }
          start += 100;
          if (start >= res.total || res.items.length < 100) break;
          await sleep(300);
        }
      }
      // 2. Rebrands and new people: one Companies House call per company (paced at about 2 a second, remembered 14 days).
      if (mode === "triggers") {
        const out = [];
        for (let i = 0; i < candidates.length && !late(); i += 6) {
          const batch = candidates.slice(i, i + 6), t0 = Date.now();
          await Promise.all(batch.map(async (c) => {
            let t = await cacheGet(`trig:${c.companyNumber}`).catch(() => null);
            if (!t) { try { t = await leadTriggers(c.companyNumber, { months: 6 }); await cacheSet(`trig:${c.companyNumber}`, t, 14 * 86400); } catch { t = []; } }
            const first = t?.[0];
            if (!first) return;
            const why = { source: "Rebrand / new people", trigger: first.text, triggerKind: first.kind, triggerAt: first.date };
            const have = leads[c.companyNumber];
            if (have) { if (have.triggerAt !== first.date && !isFrozen(have)) { await save({ ...have, trigger: first.text, triggerKind: first.kind, triggerAt: first.date }); s.tagged++; } return; }
            if (!recently(c.companyNumber)) out.push({ ...c, ...why });
          }));
          const wait = 3000 - (Date.now() - t0); if (wait > 0) await sleep(wait);
        }
        candidates = out;
      }
      await note();
      // 3. Check each company: accounts, website, contacts, licences; save the ones worth pitching.
      for (const c of candidates) {
        if (late()) { s.stoppedEarly = true; break; }
        const why = c.trigger ? { source: c.source, trigger: c.trigger, triggerKind: c.triggerKind, triggerAt: c.triggerAt } : {};
        try {
          let lead = { ...(await leadsEnrich({ ...c, links }, { minAssets: FLOOR, knownSites })), ...why };
          const tooSmall = lead.netAssets !== null && lead.netAssets !== undefined && lead.netAssets < FLOOR;
          if (!tooSmall && lead.website && lead.problem !== "Parked domain" && lead.problem !== "Dead/broken site") { try { lead = await licenceStep(lead, links); } catch {} }
          lead = { ...lead, morningScanAt: new Date().toISOString() };
          s.checked++;
          let outcome;
          if (lead.problem && !tooSmall) { await save(lead); outcome = lead.status; if (["new", "qualified"].includes(lead.status)) { s.found++; s.newLeads.push({ id: lead.id, business: lead.business, problem: lead.problem }); } else s.parked++; }
          else if (lead.problem) { await save({ ...lead, status: "not-pursuing" }); outcome = "too-small"; s.parked++; }
          else if (lead.maintenance) { await save(lead); outcome = "maintenance"; s.found++; s.newLeads.push({ id: lead.id, business: lead.business, problem: "Maintenance" }); }
          else { await save({ ...lead, status: "not-pursuing" }); outcome = "site-fine"; s.parked++; }
          seen[c.companyNumber] = { at: day(), outcome };
        } catch (e) { s.checked++; s.errors.push(`${c.name}: ${e.message}`); }
        if (s.checked % 10 === 0) { await setSetting("leads-seen", seen).catch(() => {}); await note(); }
      }
      await setSetting("leads-seen", seen).catch(() => {});
      if (!late()) done.push({ mode, what: "", centres: area.centres || [], miles: area.miles || 10, at: new Date().toISOString(), by });
    }
    // The page's "searches done" list, so the team can see the morning's sweep alongside their own.
    if (done.length) { const prev = await getSetting("searches-done").catch(() => null); await setSetting("searches-done", { items: [...(Array.isArray(prev?.items) ? prev.items : []), ...done].slice(-200) }).catch(() => {}); }
  } catch (e) { s.errors.push(String(e?.message || e)); }
  finally {
    s.finishedAt = new Date().toISOString();
    s.errors = s.errors.slice(0, 20); s.newLeads = s.newLeads.slice(0, 100);
    await setSetting("morning-scan", s).catch(() => {});
    await cacheSet(LOCK, null, 1).catch(() => {});
  }
  return s;
}
