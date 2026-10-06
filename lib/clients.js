// Client list (from the Web Clients spreadsheet): who the account manager is and
// which email addresses client emails go to. Plain JavaScript, no framework code.

export const CLIENT_FIELDS = ["name", "websites", "manager", "poc", "emails", "phone", "type", "notes"];
const GENERIC_MAIL = /gmail|googlemail|hotmail|outlook|live\.|yahoo|icloud|btinternet|aol\.|me\.com|mac\.com|protonmail|msn\.|sky\.com|talktalk|virginmedia|ntlworld|blueyonder/i;

export const hostKey = (h) => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
export const squash = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const splitList = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;|]+/)).map((x) => x.trim()).filter(Boolean);

// Accepts rows from the spreadsheet, the editor or the shared store.
export function normaliseClients(list) {
  const out = [];
  let n = 0;
  for (const c of list || []) {
    const name = String(c?.name ?? c?.Client ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    out.push({
      id: c.id || `c${Date.now().toString(36)}${++n}`,
      name,
      type: String(c.type ?? c.Type ?? "").trim(),
      manager: String(c.manager ?? c["Account Manager"] ?? "").trim(),
      poc: String(c.poc ?? c.POC ?? "").replace(/\s+/g, " ").trim(),
      emails: [...new Set(splitList(c.emails ?? c["Email Address"]).map((e) => e.toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(e)))],
      phone: String(c.phone ?? c["Contact No"] ?? "").trim(),
      notes: String(c.notes ?? c.Notes ?? "").trim(),
      websites: [...new Set(splitList(c.websites ?? c.Websites ?? c.Website).map(hostKey).filter((h) => h.includes(".")))],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// Which client owns this site: listed website, then company email domain, then name.
export function clientForSite(clients, site) {
  const host = hostKey(site);
  if (!host) return null;
  const base = host.split(".")[0];
  for (const c of clients || []) if (c.websites.some((w) => w === host || host.endsWith("." + w) || w.endsWith("." + host))) return c;
  for (const c of clients || []) if (c.emails.some((e) => { const d = e.split("@")[1]; return !GENERIC_MAIL.test(d) && (d === host || d.split(".")[0] === base); })) return c;
  const sb = squash(base);
  if (sb.length >= 5) for (const c of clients || []) { const k = squash(c.name); if (k === sb || k.startsWith(sb) || sb.startsWith(k)) return c; }
  return null;
}

// "Davaldo G" in the sheet -> "Davaldo" in the team list.
export function teamMemberForManager(team, manager) {
  const first = squash(String(manager || "").split(/\s+/)[0]);
  if (!first) return null;
  return (team || []).find((m) => squash(m.name) === first) || (team || []).find((m) => squash(m.name).startsWith(first) || first.startsWith(squash(m.name))) || null;
}
