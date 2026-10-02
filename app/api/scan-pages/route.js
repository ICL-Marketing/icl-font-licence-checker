import { sweepPages, normaliseSite } from "@/lib/scanner";

// Sweeps a batch of pages on one site for stock images. The browser calls this
// repeatedly until the site's page queue is empty.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const site = normaliseSite(body.site);
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === "string").slice(0, 12) : [];
  if (!site || !urls.length) return Response.json({ error: "site and urls required" }, { status: 400 });
  try {
    const out = await sweepPages(site, urls);
    return Response.json(out);
  } catch (e) {
    return Response.json({ done: [], remaining: urls, images: [], imagesChecked: 0, links: [], error: String(e?.message || e) });
  }
}
