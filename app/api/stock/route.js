// A stock photo for an idea slide that has nothing on the client's site to screenshot yet.
// Pexels when PEXELS_API_KEY is set (free key, free for commercial use, no credit needed); otherwise
// Openverse, limited to public-domain (CC0) pictures so no credit is needed either.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const get = async (url, opts = {}) => {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store", redirect: "follow" }); } finally { clearTimeout(t); }
};

async function pexels(q) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const r = await get(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=5`, { headers: { authorization: key } });
  if (!r.ok) return [];
  return ((await r.json()).photos || []).map((p) => p.src?.large2x || p.src?.large).filter(Boolean);
}
async function openverse(q) {
  const r = await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&aspect_ratio=wide&mature=false&page_size=5`);
  if (!r.ok) return [];
  return ((await r.json()).results || []).map((x) => x.url).filter(Boolean);
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) return Response.json({ error: "q required" }, { status: 400 });
  let urls = [];
  try { urls = await pexels(q); } catch {}
  if (!urls.length) try { urls = await openverse(q); } catch {}
  for (const u of urls) {
    try {
      const r = await get(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const sharp = (await import("sharp")).default;
      const out = await sharp(buf).rotate().resize(1600, 1000, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      return new Response(out, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
    } catch {}
  }
  return Response.json({ error: process.env.PEXELS_API_KEY ? "No stock photo found. Add your own." : "No stock photo: add a free Pexels key in Settings, or add your own." }, { status: 404 });
}
