// Photos for idea slides that have nothing on the client's site to screenshot yet. Google Images first (through
// Serper, SERPER_API_KEY: 2,500 free searches), then the free libraries: Pixabay (PIXABAY_API_KEY), Pexels
// (PEXELS_API_KEY), Unsplash (UNSPLASH_ACCESS_KEY) and public-domain Openverse. Each search is remembered for a
// week so trying photos again doesn't use up searches.
//   ?q=words&list=1  -> { photos: [{ thumb, full, from }] } for the picker
//   ?q=words&n=2     -> the nth photo, resized for the slide (the automatic pick, and Retry)
//   ?src=<full url>&thumb=<preview url> -> that photo, resized for the slide (picked in the picker); the preview
//                       when the site won't let the full-size one download
import { cacheGet, cacheSet } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const stockConfigured = () => Boolean(process.env.SERPER_API_KEY || process.env.PIXABAY_API_KEY || process.env.PEXELS_API_KEY || process.env.UNSPLASH_ACCESS_KEY);
// Picture libraries that stamp a watermark across their previews: no use on a slide.
const WATERMARKED = /shutterstock|istockphoto|gettyimages|alamy|dreamstime|123rf|depositphotos|adobestock|stock\.adobe|bigstockphoto|canstockphoto|vectorstock|pond5|agefotostock|superstock|masterfile/i;

const get = async (url, opts = {}) => {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store", redirect: "follow" }); } finally { clearTimeout(t); }
};

async function google(q) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const r = await get("https://google.serper.dev/images", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ q, gl: "gb", hl: "en" }) });
  if (!r.ok) return [];
  const all = ((await r.json()).images || []).filter((x) => x.imageUrl && /^https:/i.test(x.imageUrl) && !WATERMARKED.test(`${x.domain} ${x.imageUrl}`) && (x.imageWidth || 0) >= 800);
  // Landscape photos first: they fill the slide's picture box without much cropping.
  const wide = (x) => (x.imageWidth || 0) >= (x.imageHeight || 0) * 1.15;
  return [...all.filter(wide), ...all.filter((x) => !wide(x))].map((x) => ({ thumb: x.thumbnailUrl || x.imageUrl, full: x.imageUrl, from: x.domain || "Google" }));
}
async function pexels(q) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const r = await get(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=12`, { headers: { authorization: key } });
  if (!r.ok) return [];
  return ((await r.json()).photos || []).filter((p) => p.src?.large).map((p) => ({ thumb: p.src.medium || p.src.large, full: p.src.large2x || p.src.large, from: "Pexels" }));
}
async function pixabay(q) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const r = await get(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=12`);
  if (!r.ok) return [];
  return ((await r.json()).hits || []).filter((h) => h.largeImageURL || h.webformatURL).map((h) => ({ thumb: h.webformatURL || h.previewURL, full: h.largeImageURL || h.webformatURL, from: "Pixabay" }));
}
async function unsplash(q) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const r = await get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=landscape&per_page=12`, { headers: { authorization: `Client-ID ${key}` } });
  if (!r.ok) return [];
  return ((await r.json()).results || []).filter((p) => p.urls?.regular).map((p) => ({ thumb: p.urls.small || p.urls.regular, full: p.urls.regular, from: "Unsplash" }));
}
async function openverse(q) {
  const r = await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&aspect_ratio=wide&mature=false&page_size=12`);
  if (!r.ok) return [];
  return ((await r.json()).results || []).filter((x) => x.url).map((x) => ({ thumb: x.thumbnail || x.url, full: x.url, from: "Openverse" }));
}

// Every source at once, Google's first; Openverse only when nothing else is set up or found.
async function search(q) {
  const ck = `stock:${q.toLowerCase()}`;
  const hit = await cacheGet(ck).catch(() => null);
  if (Array.isArray(hit) && hit.length) return hit;
  const lists = await Promise.all([google, pixabay, pexels, unsplash].map((f) => f(q).catch(() => [])));
  let photos = lists.flat();
  if (!photos.length) photos = await openverse(q).catch(() => []);
  const seen = new Set();
  photos = photos.filter((p) => !seen.has(p.full) && seen.add(p.full)).slice(0, 60);
  if (photos.length) await cacheSet(ck, photos, 7 * 86400).catch(() => {});
  return photos;
}

// Only ordinary public web addresses (never this server's own network).
const publicUrl = (u) => {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(x.hostname) && !x.hostname.endsWith(".internal") ? x.href : ""; } catch { return ""; }
};
async function slidePhoto(u) {
  // Like a browser on the picture's own site: some sites refuse pictures asked for from anywhere else.
  const r = await get(u, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", referer: `${new URL(u).origin}/` } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sharp = (await import("sharp")).default;
  return sharp(buf).rotate().resize(1600, 1000, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
const jpeg = (out) => new Response(out, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const src = publicUrl(sp.get("src") || ""), thumb = publicUrl(sp.get("thumb") || "");
  if (sp.get("src")) {
    if (!src) return Response.json({ error: "Bad picture address" }, { status: 400 });
    for (const u of [src, thumb].filter(Boolean)) { try { return jpeg(await slidePhoto(u)); } catch {} }
    return Response.json({ error: "That picture wouldn't download. Pick another." }, { status: 502 });
  }
  const q = (sp.get("q") || "").trim().slice(0, 80), n = Math.max(0, Number(sp.get("n")) || 0); // n: which result (Retry moves on to the next)
  if (!q) return Response.json({ error: "q required" }, { status: 400 });
  const photos = await search(q);
  if (sp.get("list")) return Response.json({ photos, google: Boolean(process.env.SERPER_API_KEY) });
  const k = n % (photos.length || 1);
  for (const p of [...photos.slice(k), ...photos.slice(0, k)].slice(0, 6)) {
    for (const u of [p.full, p.thumb]) { try { return jpeg(await slidePhoto(u)); } catch {} }
  }
  return Response.json({ error: stockConfigured() ? "No photo found. Add your own." : "No photo: add a free Serper key in Settings, or add your own." }, { status: 404 });
}
