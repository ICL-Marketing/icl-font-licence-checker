// A screenshot of a web page for proposal slides, from WordPress's free mShots service (no key needed).
// mShots returns a "generating" placeholder the first time, so we wait and ask again until the real image is ready.
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Just one part of the page: a real headless browser loads it and photographs the element matching the
// CSS selector Claude picked from the HTML (free: @sparticuz/chromium on Vercel, the local Chromium elsewhere).
// Anything that goes wrong falls back to the whole-page shot below.
async function partShot(url, sel) {
  let browser;
  try {
    const { default: puppeteer } = await import("puppeteer-core");
    let executablePath = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args = ["--no-sandbox", ...String(process.env.CHROME_ARGS || "").split(" ").filter(Boolean)];
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) { const { default: chromium } = await import("@sparticuz/chromium"); executablePath = await chromium.executablePath(); args = chromium.args; }
    browser = await puppeteer.launch({ executablePath, args, headless: true, defaultViewport: { width: 1440, height: 900 } });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await sleep(800);
    const el = await page.$(sel).catch(() => null);
    if (!el) return null;
    await el.scrollIntoView().catch(() => {});
    await sleep(600); // lazy images and scroll animations
    const box = await el.boundingBox();
    if (!box || box.width < 50 || box.height < 30) return null;
    // The full width of the page around the element, with a little room above and below, so a small
    // element (a heading, a form) is seen in context; a tall section is shown from its top, at most
    // a screen and a half deep.
    const top = Math.max(0, box.y - 40), clip = { x: 0, y: top, width: 1440, height: Math.min(Math.max(box.y - top + box.height + 40, 640), 1350) };
    const buf = await page.screenshot({ type: "jpeg", quality: 85, clip, captureBeyondViewport: true });
    return new Response(Buffer.from(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
  } catch { return null; } finally { await browser?.close().catch(() => {}); }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const url = q.get("url") || "", sel = (q.get("sel") || "").trim().slice(0, 120);
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) return Response.json({ error: "url required" }, { status: 400 });
  if (sel) { const part = await partShot(url, sel); if (part) return part; }
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
