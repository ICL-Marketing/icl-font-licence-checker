import { familyKey } from "@/lib/scanner";
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

function joinNames(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

// Fonts that need the same reply share one bullet, so nothing is repeated.
function groupKey(f) {
  if (/font awesome/i.test(f.family) && /pro/i.test(f.note || f.family)) return "fapro";
  if (/demo/i.test(f.note || "")) return "demo";
  if (/no licence info|base64|redistribution/i.test(f.note || "") || f.status === "CHECK") return "unknown";
  if (f.status === "PROBLEM") {
    if ((f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || ""))) return "adobe";
    if (f.google === "yes") return "google";
    if (f.freeVersion?.isFree) return "freeversion";
    return f.adobe === "no" ? "licence" : "maybe";
  }
  return "unknown";
}

function nameWithFoundry(f) {
  const foundry = foundryName(f);
  return foundry ? `${f.family} (${foundry})` : f.family;
}

function fontBullet(key, fonts) {
  const one = fonts.length === 1;
  const names = joinNames(fonts.map(nameWithFoundry));
  const it = one ? "it" : "them";
  const thisFont = one ? "this font" : "these fonts";
  if (key === "fapro") {
    return `* The site uses the paid Pro version of the Font Awesome icon set, installed directly on the website. If you have a Font Awesome Pro subscription, or one was set up by a previous developer, please send us the details. If not, we can switch to the free version, which looks the same for almost all uses.`;
  }
  if (key === "demo") {
    return `* ${names} ${one ? "is a demo (personal-use) version of a font" : "are demo (personal-use) versions of fonts"}, installed directly on the website. Demo fonts are not licensed for commercial websites. If you have bought the full version, please send us a copy of the licence or the purchase receipt. If not, the options are to either buy a web licence, or we can suggest ${one ? "a suitable free font" : "suitable free fonts"} to replace ${it} that ${one ? "keeps" : "keep"} the look of the site.`;
  }
  if (key === "unknown") {
    return `* ${names} ${one ? "is" : "are"} installed directly on the website, but we could not identify who owns ${it} or where ${it} came from. Could you let us know whether ${thisFont} ${one ? "was" : "were"} supplied by you, by a designer, or as part of your brand guidelines, and send over any paperwork you have?`;
  }
  const intro = `* ${names} ${one ? "is a paid typeface" : "are paid typefaces"} installed directly on the website. If you hold ${one ? "a web licence" : "web licences"} for ${it}, please send us ${one ? "a copy or the purchase receipt" : "copies or the purchase receipts"}.`;
  if (key === "adobe") {
    return `${intro} If not, ${thisFont} ${one ? "is" : "are"} available through our Adobe Fonts subscription, so we can switch ${it} over at no cost and the site will look exactly the same.`;
  }
  if (key === "google") {
    return `${intro} If not, ${thisFont} ${one ? "is" : "are"} available free through Google Fonts, so we can switch ${it} over at no cost and the site will look exactly the same.`;
  }
  if (key === "freeversion") {
    return `${intro} If not, a free version of ${thisFont} is available from the original designer, so we can switch ${it} over at no cost with no visible change to the site.`;
  }
  if (key === "licence") {
    return `${intro} If not, the options are to either buy ${one ? "a web licence" : "web licences"} for ${thisFont}, or we can suggest ${one ? "a suitable free font" : "suitable free fonts"} to replace ${it} that ${one ? "keeps" : "keep"} the look of the site.`;
  }
  return `${intro} If not, we will check whether ${thisFont} ${one ? "is" : "are"} available through our Adobe Fonts subscription at no cost to you; failing that, the options are to either buy ${one ? "a web licence" : "web licences"}, or we can suggest ${one ? "a suitable free font" : "suitable free fonts"} to replace ${it} that ${one ? "keeps" : "keep"} the look of the site.`;
}

export function buildFontEmail(r) {
  if (!r || r.status === "RUNNING" || r.status === "UNREACHABLE") return null;
  // Fonts we can fix ourselves at no cost (Adobe Fonts relink, Google Fonts,
  // a free version, or Font Awesome Free) are handled quietly: no email.
  const hasFreeFix = (f) =>
    (f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) || f.google === "yes" || !!f.freeVersion?.isFree ||
    (/font awesome/i.test(f.family) && /pro/i.test(f.note || f.family));
  const raw = (r.fonts || []).filter((f) => (f.status === "PROBLEM" || f.status === "CHECK") && !hasFreeFix(f));
  if (!raw.length) return null;
  // Merge different styles of the same family into one entry.
  const byKey = new Map();
  for (const f of raw) {
    const k = familyKey(f.family) || f.family;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { ...f });
    else if (f.status === "PROBLEM" && cur.status !== "PROBLEM") byKey.set(k, { ...f });
  }
  const fonts = [...byKey.values()];
  const n = fonts.length;
  const one = n === 1;
  // One bullet per kind of reply, in a sensible order.
  const order = ["adobe", "google", "freeversion", "licence", "maybe", "demo", "unknown", "fapro"];
  const groups = new Map();
  for (const f of fonts) {
    const k = groupKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const bullets = order.filter((k) => groups.has(k)).map((k) => fontBullet(k, groups.get(k)));
  const body =
`Hi there,

As part of our ongoing website maintenance, we have recently carried out a font licence check across your website.

With the increased use of automated tools and AI, font foundries and type designers are now using technology to identify where their fonts are being used online. This can sometimes result in businesses being contacted directly regarding font licensing or payment.

Following our check, we have identified ${n} font${one ? "" : "s"} currently in use on your website (${r.site}) that may have outstanding licensing requirements. We wanted to flag ${one ? "this" : "these"} with you in advance, as you may be contacted by the font owner or foundry in the future.

Please could you take a look at the details below and let us know whether you have ${one ? "an existing licence for this font" : "existing licences for these fonts"}, or if you would like us to investigate the licensing requirements further.

${bullets.join("\n\n")}

Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.

Kind regards,`;
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
  const byLib = new Map();
  for (const i of images) {
    if (!byLib.has(i.flag)) byLib.set(i.flag, []);
    byLib.get(i.flag).push(i);
  }
  const bullets = [...byLib.entries()].map(([lib, list]) => {
    const single = list.length === 1;
    const names = joinNames(list.map((i) => `${fileName(i.url)}${i.page ? ` (on ${pageLabel(i.page)})` : ""}`));
    const them = single ? "it" : "them";
    return `* ${names} appear${single ? "s" : ""} to come from ${lib}. If you hold ${single ? "a licence" : "licences"} for ${single ? "this image" : "these images"} (a receipt, order number, or the account ${single ? "it was" : "they were"} bought under), please send ${single ? "it" : "them"} over. If not, we can replace ${them} with licensed or free alternatives, or buy ${single ? "a licence" : "licences"} for ${them}.`;
  });
  const body =
`Hi there,

As part of our ongoing website maintenance, we have recently carried out a stock image licence check across your website.

With the increased use of automated tools and AI, stock photo agencies are now using technology to identify where their images are being used online. This can sometimes result in businesses being contacted directly regarding image licensing or payment.

Following our check, we have identified ${n} image${one ? "" : "s"} currently in use on your website (${r.site}) that may have outstanding licensing requirements. We wanted to flag ${one ? "this" : "these"} with you in advance, as you may be contacted by the image owner or agency in the future.

Please could you take a look at the details below and let us know whether you have ${one ? "an existing licence for this image" : "existing licences for these images"}, or if you would like us to investigate the licensing requirements further.

${bullets.join("\n\n")}

Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.

Kind regards,`;
  return {
    site: r.site, count: n, kind: "images",
    subject: `${r.site} – stock image licence check (${n} image${one ? "" : "s"} to confirm)`,
    body,
  };
}
