import { fetchPage } from "@/lib/leads";
import { trackingConsent } from "@/lib/consent";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// One site per request: its homepage and Tag Manager container, and whether tracking waits for the cookie banner.
export async function GET(request) {
  const site = String(new URL(request.url).searchParams.get("site") || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return Response.json({ error: "site required" }, { status: 400 });
  let r = await fetchPage(`https://${site}/`);
  if (!r.status) r = await fetchPage(`http://${site}/`);
  const checkedAt = new Date().toISOString();
  if (!r.status || r.status >= 400 || !(r.html || "").trim()) return Response.json({ site, status: "UNREACHABLE", summary: r.status ? `The homepage returned ${r.status}.` : `No response (${r.error || "timed out"}).`, checkedAt });
  const v = await trackingConsent(r.html);
  const status = v.gap ? "GAP" : v.noBanner ? "NO_BANNER" : v.tracking ? "OK" : "NO_TRACKING";
  return Response.json({ site, status, summary: v.summary || "No analytics or tracking tags found on the homepage.", ticket: v.ticket || "", bannerName: v.bannerName || "", ga4: v.ga4 || [], gtm: v.gtm || [], others: v.others || [], checkedAt });
}
