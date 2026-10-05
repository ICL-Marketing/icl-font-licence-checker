import { markerConfigured, projectIdFromLink, monitorOverview, monitorElements, monitorGuide, monitorScanTrigger, monitorScanGet } from "@/lib/marker";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Marker.io accessibility monitoring for one project: overview, elements of a check, fix guide, scan trigger/status.
export async function POST(request) {
  if (!markerConfigured()) return Response.json({ ok: false, configured: false, error: "Marker.io is not set up." });
  const b = await request.json().catch(() => ({}));
  const projectId = projectIdFromLink(b.project || "");
  if (!projectId) return Response.json({ ok: false, error: "Marker.io project link missing." });
  try {
    if (b.action === "elements") return Response.json({ ok: true, elements: await monitorElements(projectId, String(b.checkId)) });
    if (b.action === "guide") return Response.json({ ok: true, guide: await monitorGuide(projectId, String(b.checkId)) });
    if (b.action === "scan") return Response.json({ ok: true, ...(await monitorScanTrigger(projectId)) });
    if (b.action === "scan-status") return Response.json({ ok: true, ...(await monitorScanGet(projectId, b.scanId)) });
    return Response.json(await monitorOverview(projectId));
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) });
  }
}
