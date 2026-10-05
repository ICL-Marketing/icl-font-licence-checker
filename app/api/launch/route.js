import { launchStart, launchPages, checkUrls, psiAudit } from "@/lib/launch";

// Launch checks, one short step per request; the browser drives the sequence.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const strings = (a, n) => (Array.isArray(a) ? a.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, n) : []);
  try {
    if (body.step === "start") {
      return Response.json(await Promise.race([
        launchStart(body.url),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Timed out reading the site")), 50_000)),
      ]));
    }
    if (body.step === "pages") return Response.json(await launchPages(strings(body.urls, 12)));
    if (body.step === "psi") return Response.json(typeof body.url === "string" && /^https?:\/\//.test(body.url) ? await psiAudit(body.url) : { ok: false, error: "url required" });
    if (body.step === "urls") return Response.json(await checkUrls(strings(body.urls, 40)));
    return Response.json({ error: "Unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) });
  }
}
