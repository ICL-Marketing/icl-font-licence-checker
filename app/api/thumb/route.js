// Small thumbnail of a client's image, fetched server-side. Browsers often
// can't show the original directly (hotlink protection, huge files, mixed
// content), so the app fetches it, shrinks it and serves it from here.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function GET(request) {
  const u = new URL(request.url).searchParams.get("u") || "";
  let target;
  try { target = new URL(u); } catch { return new Response("bad url", { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) return new Response("bad url", { status: 400 });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(target, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return new Response("not found", { status: 404 });
    const type = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return new Response("too big", { status: 413 });
    const headers = { "cache-control": "public, max-age=86400, s-maxage=86400" };
    if (/svg/.test(type) || /\.svg(\?|$)/i.test(target.pathname)) {
      return new Response(buf, { headers: { ...headers, "content-type": "image/svg+xml" } });
    }
    try {
      const sharp = (await import("sharp")).default;
      const out = await sharp(buf, { animated: false }).rotate().resize(168, 120, { fit: "cover", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
      return new Response(out, { headers: { ...headers, "content-type": "image/webp" } });
    } catch {
      return new Response(buf, { headers: { ...headers, "content-type": type.startsWith("image/") ? type : "application/octet-stream" } });
    }
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
