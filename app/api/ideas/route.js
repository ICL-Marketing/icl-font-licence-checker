import { checkWebsite, fetchPage, licenceRisks, seoCheck, siteAddress, townFromAddress, tradeFromSite, applyTradingAddress } from "@/lib/leads";

export const dynamic = "force-dynamic";
export const maxDuration = 50;

const clean = (w) => String(w || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

// What the homepage (and contact page) show, for the idea rules. Free: plain page fetches.
async function signals(host) {
  let home = await fetchPage(`https://${host}/`);
  if (home.status === 0) home = await fetchPage(`http://${host}/`);
  const html = home.html || "";
  const low = html.toLowerCase();
  const text = low.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hasForm = (h) => /<form[\s\S]*?<\/form>/i.test(h) && /<form(?![^>]*(search|role=["']search))[^>]*>[\s\S]*?(type=["']?(email|tel)|<textarea)/i.test(h);
  let form = hasForm(html) || /wpcf7|gform_|hs-form|hbspt\.forms|typeform|jotform|formspree|wufoo|forminator|ninja-forms|elementor-form|wpforms/i.test(html);
  if (!form) {
    const href = (html.match(/href=["']([^"'#]*contact[^"'#]*)["']/i) || [])[1];
    const paths = [...new Set([href && !/^mailto:/i.test(href) ? href : "", "/contact", "/contact-us"].filter(Boolean))].slice(0, 2);
    for (const pth of paths) {
      const url = /^https?:/i.test(pth) ? pth : `https://${host}${pth.startsWith("/") ? pth : "/" + pth}`;
      const r = await fetchPage(url);
      if (r.status === 200 && (hasForm(r.html || "") || /wpcf7|gform_|hs-form|hbspt\.forms|typeform|jotform|formspree|wufoo|forminator|ninja-forms|elementor-form|wpforms/i.test(r.html || ""))) { form = true; break; }
    }
  }
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  return {
    ok: home.status > 0 && home.status < 400,
    ms: home.ms || 0,
    video: /<video\b|youtube\.com\/embed|youtube-nocookie\.com|player\.vimeo\.com|wistia|vimeo\.com\/video|\.mp4["'?]/i.test(html),
    reviews: /testimonial|trustpilot|feefo|reviews\.io|elfsight|google reviews|what our (clients|customers) say|★★★|5 stars?\b|five star/i.test(text + " " + low),
    form,
    analytics: /gtag\(|googletagmanager\.com|google-analytics\.com|plausible\.io|matomo|clarity\.ms|usefathom|hotjar/i.test(html),
    consent: /cookiebot|cookieyes|onetrust|termly|iubenda|complianz|cookie-law-info|cookie-notice|osano|usercentrics|quantcast|klaro|cookieconsent|cookie_consent|gdpr-cookie|cookiefirst|civic ?cookie|cookie-script/i.test(html),
    metaDescription: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html) || /<meta[^>]+content=["'][^"']{10,}["'][^>]+name=["']description["']/i.test(html),
    ogImage: /<meta[^>]+property=["']og:image["']/i.test(html) || /<meta[^>]+content=["'][^"']+["'][^>]+property=["']og:image["']/i.test(html),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    images: imgs.length,
    imagesNoAlt: imgs.filter((t) => !/\balt\s*=/i.test(t)).length,
    blog: /href=["'][^"']*\/(blog|news|articles|insights|journal|latest|stories|updates)\b/i.test(html),
  };
}

// Steps, one short request each (the browser drives the queue):
//   check   {website}            -> site check + homepage signals
//   licence {website}            -> font and stock image licence risks
//   seo     {website, name, ...} -> where they rank for their trade in their town (one search credit)
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const host = clean(b.website);
  if (!host) return Response.json({ error: "website required" }, { status: 400 });
  try {
    if (b.step === "check") {
      const w = await checkWebsite(host);
      const sg = w.problem === "Dead/broken site" || w.problem === "Parked domain" ? null : await signals(host).catch(() => null);
      return Response.json({ website: host, problem: w.problem || "", problemDetail: w.detail || "", platform: w.platform || "", year: w.year || 0, title: w.title || "", siteDescription: w.description || "", siteHeadings: w.headings || "", siteBody: (w.bodyText || "").slice(0, 1500), signals: sg, checkedAt: new Date().toISOString() });
    }
    if (b.step === "licence") return Response.json({ licence: await licenceRisks(host) });
    if (b.step === "seo") {
      let town = String(b.town || "");
      let address = null;
      if (!town) { try { address = await siteAddress(host); if (address) { const patch = {}; applyTradingAddress(patch, address, null); town = patch.tradingTown || townFromAddress(address.lines || [], address.postcode); } } catch {} }
      const trade = b.trade || tradeFromSite(`${b.title || ""} ${b.siteDescription || ""}`, b.siteHeadings || "", b.siteBody || "");
      if (!trade || !town) return Response.json({ seo: null, town, trade, skipped: !trade ? "Couldn't tell what they do from the site; type it in to search." : "No address on the site; type the town in to search." });
      const seo = await seoCheck({ business: b.name || host, website: host, area: town, trade, siteText: `${b.title || ""} ${b.siteDescription || ""}`, headings: b.siteHeadings || "", body: b.siteBody || "" });
      return Response.json({ seo, town, trade });
    }
    return Response.json({ error: "unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
