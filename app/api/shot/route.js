// A screenshot of a web page for proposal slides, from WordPress's free mShots service (no key needed).
// mShots returns a "generating" placeholder the first time, so we wait and ask again until the real image is ready.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function GET(request) {
  const url = new URL(request.url).searchParams.get("url") || "";
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) return Response.json({ error: "url required" }, { status: 400 });
  const shot = `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?vpw=1440&vph=900&w=1440&h=900`; // a full desktop-width viewport, not mShots' narrower default
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(shot, { cache: "no-store", redirect: "follow" });
      const type = r.headers.get("content-type") || "";
      const buf = Buffer.from(await r.arrayBuffer());
      // The placeholder is a small GIF; the finished shot is a JPEG.
      if (r.ok && /jpe?g|png/.test(type) && buf.length > 15000) return new Response(buf, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
    } catch {}
    await sleep(3000);
  }
  return Response.json({ error: "The screenshot isn't ready yet. Try again in a minute, or add your own." }, { status: 504 });
}
