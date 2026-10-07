import { figmaConfigured, parseFigmaLink, listFrames, fetchFrames, checkFrame, checkDesignFonts } from "@/lib/figma";

export const dynamic = "force-dynamic";
export const maxDuration = 50;

// Browser-driven, like the launch checks: "start" lists the screens in a
// Figma file, then "frames" checks a few of them per request.
// GET ?link=… tests the connection: what Figma says about that file right now.
export async function GET(request) {
  const link = new URL(request.url).searchParams.get("link") || "";
  if (!link) return Response.json({ configured: figmaConfigured() });
  if (!figmaConfigured()) return Response.json({ ok: false, error: "FIGMA_TOKEN is not set in Vercel." });
  const p = parseFigmaLink(link);
  if (!p) return Response.json({ ok: false, error: "That is not a Figma file link." });
  try {
    const { name, frames, lastModified, version } = await listFrames(p.fileKey, p.nodeId);
    return Response.json({ ok: true, fileKey: p.fileKey, nodeId: p.nodeId, name, lastModified, version, frames: frames.length, sample: frames.slice(0, 8).map((f) => `${f.page ? f.page + " / " : ""}${f.name}`) });
  } catch (e) { return Response.json({ ok: false, error: String(e?.message || e) }); }
}

export async function POST(request) {
  if (!figmaConfigured()) return Response.json({ error: "Figma is not set up. Add FIGMA_TOKEN in Vercel (Figma → Settings → Security → Personal access tokens, file read scope) and redeploy." }, { status: 400 });
  const b = await request.json().catch(() => ({}));
  try {
    if (b.step === "start") {
      const p = parseFigmaLink(b.link);
      if (!p) return Response.json({ error: "That is not a Figma file link." }, { status: 400 });
      const { name, frames, lastModified, version } = await listFrames(p.fileKey, p.nodeId);
      if (!frames.length) return Response.json({ error: "No frames found. Link a file, a page or a frame that contains screens." }, { status: 400 });
      return Response.json({ fileKey: p.fileKey, nodeId: p.nodeId, name, lastModified, version, frames: frames.slice(0, 300) });
    }
    if (b.step === "frames") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 6);
      if (!b.fileKey || !ids.length) return Response.json({ error: "fileKey and ids required" }, { status: 400 });
      const docs = await fetchFrames(String(b.fileKey), ids);
      return Response.json({ results: docs.map((d) => checkFrame(d, String(b.fileKey))) });
    }
    if (b.step === "fonts") {
      const fams = [...new Set((Array.isArray(b.families) ? b.families : []).map(String).filter(Boolean))];
      return Response.json({ fonts: await checkDesignFonts(fams) });
    }
    return Response.json({ error: "unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
