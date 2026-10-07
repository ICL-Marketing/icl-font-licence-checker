// Constants shared by the Website Leads UI and server code (no Node-only imports here).
export const LEAD_STATUSES = [
  ["new", "To assess", "Low likelihood: decide whether to pursue or park"], ["qualified", "Qualified", "Worth contacting"], ["contacted", "Contacted", "Email sent, waiting"], ["cold", "Cold", "No reply after chasing"], ["replied", "Replied", "They answered"], ["meeting", "Meeting", "Call or visit booked"],
  ["won", "Won", "Signed up"], ["lost", "Lost", "Said no"], ["not-pursuing", "Not pursuing", "Our call: not worth it"],
];
export const PROBLEMS = ["No website", "Parked domain", "Dead/broken site", "Broken SSL", "Dated template", "Stale copyright", "Licence risk"];

// Keep in step with DRAFT_VERSION in lib/leads.js (that file cannot be imported by the browser).
export const DRAFT_VERSION = 14;

// Bump when the contact-finding logic improves, so parked leads can be retried once more.
export const CONTACTS_VERSION = 2;

// Short follow-up for a lead that has gone quiet: a nudge, the one thing that matters to them, the offer.
export function draftFollowUp(l) {
  const first = l.contactName ? l.contactName.split(" ")[0] : "";
  const hi = first ? `Hi ${first},` : "Hi there,";
  const year = l.year ? ` (the footer still says ${l.year})` : "";
  const hook = {
    "No website": "I still can't find a website for you, and the people searching locally are landing on your competitors instead.",
    "Parked domain": "Your domain is still pointing at a parking page, so anyone who finds you online gets nothing.",
    "Dead/broken site": "The site is still down as I write this, so customers are landing on an error.",
    "Broken SSL": "The security warning is still showing on the site, and it's a quick fix if you'd like it sorted.",
    "Stale copyright": `The site hasn't changed since I last looked${year}, and a refresh would make a real difference to how you come across.`,
    "Dated template": "The template is still holding the site back, and a design built around your brand would stand out straight away.",
    "Licence risk": "The licensing issue I mentioned is still live on the site, and it's cheaper to fix now than if the library chases you for it.",
  }[l.problem] || "The points I mentioned are still there, and I'd happily talk any of them through.";
  const body = `${hi}\n\nJust nudging this to the top of your inbox in case it got buried. ${hook}\n\nHappy to put a couple of ideas together and show you what they'd look like, no charge and no pressure either way.`;
  return { subject: `Re: ${l.subject || "your website"}`, body };
}
