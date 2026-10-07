// Constants shared by the Website Leads UI and server code (no Node-only imports here).
export const LEAD_STATUSES = [
  ["new", "New", "Low likelihood, decide whether to pursue"], ["qualified", "Qualified", "Worth contacting"], ["contacted", "Contacted", "Email sent, waiting"], ["cold", "Cold", "No reply after chasing"], ["replied", "Replied", "They answered"], ["meeting", "Meeting", "Call or visit booked"],
  ["won", "Won", "Signed up"], ["lost", "Lost", "Said no"], ["not-pursuing", "Not pursuing", "Our call: not worth it"],
];
export const PROBLEMS = ["No website", "Parked domain", "Dead/broken site", "Broken SSL", "Dated template", "Stale copyright", "Licence risk"];

// Keep in step with DRAFT_VERSION in lib/leads.js (that file cannot be imported by the browser).
export const DRAFT_VERSION = 9;
