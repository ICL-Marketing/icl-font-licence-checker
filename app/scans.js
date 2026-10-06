"use client";

// Font and stock-image licence scans for one site, shared by the Font/Image
// Licenses tabs and the launch checks. `post` sends JSON; `patch` receives
// progress and results as plain fields; `shouldStop` ends an image sweep early.

export const MAX_PAGES = 500;

export async function scanFonts(post, site, patch) {
  patch({ status: "RUNNING", fonts: [], error: "" });
  try {
    const d = await post("/api/scan", { site, pages: 4, mode: "fonts" });
    patch({
      status: d.status, fonts: d.fonts || [], ignoredFonts: d.ignoredFonts || [], error: d.error || "", fix: d.fix || "",
      finalUrl: d.finalUrl, platform: d.platform, cssCount: d.cssCount, fontPages: d.pages?.length || 0, seconds: d.seconds, fontsScannedAt: d.scannedAt,
    });
  } catch (e) {
    patch({ status: "UNREACHABLE", fonts: [], error: `Request failed: ${e.message}` });
  }
}

export async function scanImages(post, site, patch, shouldStop = () => false) {
  patch({ imgStatus: "RUNNING", images: [], imgError: "", imgProgress: "reading sitemap", imgDone: 0, imgTotal: 0 });
  try {
    const d = await post("/api/scan", { site, pages: 4, mode: "images" });
    if (d.status === "UNREACHABLE") { patch({ imgStatus: "UNREACHABLE", imgError: d.error || "", imgFix: d.fix || "", imgProgress: undefined }); return; }
    const queue = [...(d.pageQueue || [])];
    const visited = new Set([...(d.pages || []), ...queue].map((u) => u.replace(/\/$/, "")));
    const images = [...(d.images || [])];
    const seenImg = new Set(images.map((i) => i.url.split("?")[0]));
    let scanned = d.pages?.length || 0;
    let imagesChecked = d.imagesChecked || 0;
    let total = scanned + queue.length;
    patch({ imgProgress: `page ${scanned} of ${total}`, imgDone: scanned, imgTotal: total, images });
    while (queue.length && !shouldStop()) {
      const batch = queue.slice(0, 10);
      const out = await post("/api/scan-pages", { site, urls: batch });
      queue.splice(0, batch.length);
      scanned += (out.done || []).length;
      imagesChecked += out.imagesChecked || 0;
      for (const i of out.images || []) {
        const k = i.url.split("?")[0];
        if (!seenImg.has(k)) { seenImg.add(k); images.push(i); continue; }
        const prev = images.find((x) => x.url.split("?")[0] === k);
        if (prev) prev.pages = [...new Set([...(prev.pages || (prev.page ? [prev.page] : [])), ...(i.pages || (i.page ? [i.page] : []))])];
      }
      if (out.remaining?.length) queue.unshift(...out.remaining);
      if (!d.hasSitemap) {
        for (const l of out.links || []) {
          const k = l.replace(/\/$/, "");
          if (!visited.has(k) && visited.size < MAX_PAGES) { visited.add(k); queue.push(l); }
        }
      }
      total = scanned + queue.length;
      patch({ imgProgress: `page ${scanned} of ${total}`, imgDone: scanned, imgTotal: total, images: [...images] });
    }
    patch({ imgStatus: "DONE", images, imagesChecked, pagesScanned: scanned, pagesTotal: total, hasSitemap: !!d.hasSitemap, imgProgress: undefined, imagesScannedAt: d.scannedAt });
  } catch (e) {
    patch({ imgStatus: "UNREACHABLE", imgError: `Request failed: ${e.message}`, imgProgress: undefined });
  }
}
