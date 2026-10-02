import { scanSite, normaliseSite, UNREACHABLE } from "@/lib/scanner";

// One site per request so each call stays well inside serverless limits.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const site = normaliseSite(body.site);
  const pages = Math.min(Math.max(Number(body.pages) || 4, 1), 10);
  const mode = ["fonts", "images"].includes(body.mode) ? body.mode : "both";
  if (!site || !site.includes(".")) {
    return Response.json({ error: "Invalid site" }, { status: 400 });
  }
  const started = Date.now();
  try {
    // Hard stop a little under maxDuration so the client always gets a row back.
    const result = await Promise.race([
      scanSite(site, { pages, mode }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Scan timed out after 50s")), 50_000)),
    ]);
    result.seconds = Math.round((Date.now() - started) / 10) / 100;
    return Response.json(result);
  } catch (e) {
    return Response.json({
      site, status: UNREACHABLE, http: 0, finalUrl: "", platform: "", fonts: [], images: [], pages: [],
      familiesInCss: [], error: /timed out/i.test(String(e?.message)) ? "Scan timed out (site very slow or very large). Try Re-scan with fewer pages." : `Scanner error: ${e?.message || e}`,
      fix: "Press Re-scan with Pages per site set to 1. If it still times out, check the fonts by hand (DevTools → Network → Font).",
      seconds: Math.round((Date.now() - started) / 10) / 100, scannedAt: new Date().toISOString(),
    });
  }
}
