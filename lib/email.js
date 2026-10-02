// Client-friendly emails. One for fonts, one for stock images. Each returns
// null when the site has nothing the client needs to answer. Pure functions,
// safe in the browser.

function pagePath(url) {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    return p ? p : "the home page";
  } catch {
    return "";
  }
}
function pageLabel(url) {
  const p = pagePath(url);
  if (!p) return "";
  return p === "the home page" ? p : `the ${p} page`;
}
function fileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()); } catch { return url; }
}
export function isFreeLib(flag) {
  return /free/i.test(flag || "");
}
function foundryName(f) {
  const m = f.meta?.manufacturer || "";
  return m.replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|the|co)\b\.?/gi, "").replace(/[\s.,]+$/g, "").replace(/\s*,\s*$/, "").replace(/\s+/g, " ").trim();
}
function altFromFix(fix) {
  const m = /Free alternative on Google Fonts: ([^.]+)\./.exec(fix || "");
  return m ? m[1].trim() : "";
}

// Strip style/weight words so "FSAlbertPro-Bold" and "FS Albert Pro Light" merge into one point.
function familyKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\b(regular|bold|semibold|semi bold|demibold|extrabold|extra bold|ultrabold|black|heavy|light|extralight|extra light|ultralight|thin|hairline|medium|book|italic|oblique|condensed|cond|narrow|wide|extended|display|text|web|webfont|pro|std|lt|mt|\d{3})\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fontPoint(f) {
  const where = f.foundOn?.length ? pageLabel(f.foundOn[0]) : "";
  const whereTxt = where ? ` (used on ${where}${f.foundOn?.length > 1 ? " and other pages" : ""})` : "";
  const foundry = foundryName(f);
  const alt = altFromFix(f.fix);
  const isFaPro = /font awesome/i.test(f.family) && /pro/i.test(f.note || f.family);
  if (isFaPro) {
    return `• Font Awesome Pro icons${whereTxt} – the site uses the paid Pro version of the Font Awesome icon set. If you have a Font Awesome Pro subscription, or one was set up by a previous developer, please send us the details. If not, we can switch to the free version, which looks the same for almost all uses.`;
  }
  if (f.status === "PROBLEM") {
    const base = `• ${f.family}${whereTxt} – a paid typeface${foundry ? ` from ${foundry}` : ""}, installed directly on the website. If you, or a designer who worked with you previously, hold a web licence for it, please send us a copy or the purchase receipt.`;
    if (f.adobe === "yes") return `${base} If not, this font is available through our Adobe Fonts subscription, so we can switch it over at no cost and the site will look exactly the same.`;
    if (f.adobe === "no") return `${base} If not, the options are a web licence for the font or a very similar free alternative${alt ? ` such as ${alt}` : ""}; we can advise and handle either.`;
    return `${base} If not, we will check whether it is available through our Adobe Fonts subscription (no cost to you); failing that, the options are a web licence or a very similar free alternative${alt ? ` such as ${alt}` : ""}.`;
  }
  return `• ${f.family}${whereTxt} – installed directly on the website, but we could not identify who owns it or where it came from. Could you let us know whether it was supplied by you, by a designer, or as part of your brand guidelines, and send over any paperwork you have for it?`;
}

export function buildFontEmail(r) {
  if (!r || r.status === "RUNNING" || r.status === "UNREACHABLE") return null;
  const raw = (r.fonts || []).filter((f) => f.status === "PROBLEM" || f.status === "CHECK");
  if (!raw.length) return null;
  // Merge different styles of the same family into one point.
  const byKey = new Map();
  for (const f of raw) {
    const k = familyKey(f.family) || f.family;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { ...f, foundOn: [...(f.foundOn || [])] });
    else {
      if (f.status === "PROBLEM" && cur.status !== "PROBLEM") Object.assign(cur, f, { foundOn: cur.foundOn });
      for (const p of f.foundOn || []) if (!cur.foundOn.includes(p)) cur.foundOn.push(p);
    }
  }
  const fonts = [...byKey.values()];
  const n = fonts.length;
  const one = n === 1;
  const body =
`Hi there,

As part of our ongoing website maintenance, we have recently carried out a font licence check across your website.

With the increased use of automated tools and AI, font foundries and type designers are now using technology to identify where their fonts are being used online. This can sometimes result in businesses being contacted directly regarding font licensing or payment.

Following our check, we have identified ${n} font${one ? "" : "s"} currently in use on your website (${r.site}) that may have outstanding licensing requirements. We wanted to flag ${one ? "this" : "these"} with you in advance, as you may be contacted by the font owner or foundry in the future.

Please could you take a look at the details below and let us know whether you have ${one ? "an existing licence for this font" : "existing licences for these fonts"}, or if you would like us to investigate the licensing requirements further.

${fonts.map(fontPoint).join("\n\n")}

Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.

Kind regards,

[Your name]
ICL Digital`;
  return {
    site: r.site, count: n, kind: "fonts",
    subject: `${r.site} – font licence check (${n} font${one ? "" : "s"} to confirm)`,
    body,
  };
}

export function buildImageEmail(r) {
  if (!r || r.imgStatus !== "DONE") return null;
  const images = (r.images || []).filter((i) => i.flag && !isFreeLib(i.flag));
  if (!images.length) return null;
  const n = images.length;
  const one = n === 1;
  const points = images.map((i) => {
    const onPage = i.page ? ` (on ${pageLabel(i.page)})` : "";
    const credit = i.meta ? ` The file also carries a credit tag (${i.meta.slice(0, 80)}).` : "";
    return `• ${fileName(i.url)}${onPage} – the file name suggests this image came from ${i.flag}.${credit} If you have the purchase record or licence for it (a receipt, order number, or the account it was bought under), please send it over. If not, we can replace it with a licensed or free alternative, or buy a licence for it.`;
  });
  const body =
`Hi there,

As part of our ongoing website maintenance, we have recently carried out a stock image licence check across your website.

With the increased use of automated tools and AI, stock photo agencies are now using technology to identify where their images are being used online. This can sometimes result in businesses being contacted directly regarding image licensing or payment.

Following our check, we have identified ${n} image${one ? "" : "s"} currently in use on your website (${r.site}) that may have outstanding licensing requirements. We wanted to flag ${one ? "this" : "these"} with you in advance, as you may be contacted by the image owner or agency in the future.

Please could you take a look at the details below and let us know whether you have ${one ? "an existing licence for this image" : "existing licences for these images"}, or if you would like us to investigate the licensing requirements further.

${points.join("\n\n")}

Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.

Kind regards,

[Your name]
ICL Digital`;
  return {
    site: r.site, count: n, kind: "images",
    subject: `${r.site} – stock image licence check (${n} image${one ? "" : "s"} to confirm)`,
    body,
  };
}
