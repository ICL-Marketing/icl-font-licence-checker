// A stock photo for an idea slide that has nothing on the client's site to screenshot yet. Free libraries whose
// photos are free for commercial use with no credit needed, tried in turn: Pixabay (PIXABAY_API_KEY), Pexels
// (PEXELS_API_KEY, new keys currently paused), Unsplash (UNSPLASH_ACCESS_KEY), then public-domain Openverse.
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const stockConfigured = () => Boolean(process.env.PIXABAY_API_KEY || process.env.PEXELS_API_KEY || process.env.UNSPLASH_ACCESS_KEY);

const get = async (url, opts = {}) => {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store", redirect: "follow" }); } finally { clearTimeout(t); }
};

async function pexels(q) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const r = await get(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=12`, { headers: { authorization: key } });
  if (!r.ok) return [];
  return ((await r.json()).photos || []).map((p) => p.src?.large2x || p.src?.large).filter(Boolean);
}
async function pixabay(q) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const r = await get(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=12`);
  if (!r.ok) return [];
  return ((await r.json()).hits || []).map((h) => h.largeImageURL || h.webformatURL).filter(Boolean);
}
async function unsplash(q) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const r = await get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=landscape&per_page=12`, { headers: { authorization: `Client-ID ${key}` } });
  if (!r.ok) return [];
  return ((await r.json()).results || []).map((p) => p.urls?.regular).filter(Boolean);
}
async function openverse(q) {
  const r = await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&aspect_ratio=wide&mature=false&page_size=12`);
  if (!r.ok) return [];
  return ((await r.json()).results || []).map((x) => x.url).filter(Boolean);
}

export async function GET(request) {
  const sp = new URL(request.url).searchParams, q = (sp.get("q") || "").trim().slice(0, 60), n = Math.max(0, Number(sp.get("n")) || 0); // n: which result (Retry moves on to the next)
  if (!q) return Response.json({ error: "q required" }, { status: 400 });
  let urls = [];
  for (const find of [pixabay, pexels, unsplash, openverse]) {
    if (urls.length) break;
    try { urls = await find(q); } catch {}
  }
  for (const u of [...urls.slice(n % (urls.length || 1)), ...urls.slice(0, n % (urls.length || 1))]) {
    try {
      const r = await get(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const sharp = (await import("sharp")).default;
      const out = await sharp(buf).rotate().resize(1600, 1000, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      return new Response(out, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
    } catch {}
  }
  return Response.json({ error: stockConfigured() ? "No stock photo found. Add your own." : "No stock photo: add a free Pixabay key in Settings, or add your own." }, { status: 404 });
}
