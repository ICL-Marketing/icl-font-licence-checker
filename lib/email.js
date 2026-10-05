// Client-friendly emails, one for fonts and one for stock images.
//
// Each email is built as a list of segments. Fixed template wording is a plain
// string; anything that changes per site (the domain, counts, and each bullet)
// is an object { id, v } so the app can highlight and edit it.
//
// Only issues the client has to answer are included. Everything we fix ourselves
// at no cost (Adobe / Google relink, free version, Font Awesome icon swaps,
// fonts loaded from a redistribution site) is left out.

import { issueLabel, isEmbeddedIconFont, isFreeFontAwesome, mergeImageSizes } from "@/lib/fontlink";

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
  return m.replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|the|co)\b\.?/gi, "").replace(/[\s.,]+$/g, "").replace(/\s+/g, " ").trim();
}
function joinNames(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}
// Styles of one family collapse into one name ("FoundrySterling-Bold" -> "foundry sterling").
function familyKey(name) {
  return String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\b(regular|bold|semibold|demibold|demi|extrabold|black|heavy|light|extralight|thin|medium|book|italic|oblique|condensed|extra|web|\d{3})\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Statuses that need the client, in the order their bullets appear.
export const CLIENT_STATUSES = ["Licence Not Found", "Demo Font", "Subscription To Confirm", "Licence Info Missing"];

export function clientFonts(r) {
  if (!r || r.status === "RUNNING" || r.status === "UNREACHABLE") return [];
  const raw = (r.fonts || []).filter((f) =>
    (f.status === "PROBLEM" || f.status === "CHECK") &&
    !isEmbeddedIconFont(f) && !isFreeFontAwesome(f) &&
    CLIENT_STATUSES.includes(issueLabel(f)));
  const byKey = new Map();
  for (const f of raw) {
    const k = familyKey(f.family) || f.family;
    if (!byKey.has(k)) byKey.set(k, f);
  }
  return [...byKey.values()];
}

function nameWithFoundry(f) {
  const foundry = foundryName(f);
  return foundry ? `${f.family} (${foundry})` : f.family;
}

function fontBullet(label, fonts) {
  const one = fonts.length === 1;
  const names = joinNames(fonts.map(nameWithFoundry));
  const it = one ? "it" : "them";
  const thisFont = one ? "this font" : "these fonts";
  const swap = `we can suggest ${one ? "a suitable free font" : "suitable free fonts"} to replace ${it} that ${one ? "keeps" : "keep"} the look of the site`;
  switch (label) {
    case "Licence Not Found":
      return `* ${names} ${one ? "is a paid typeface" : "are paid typefaces"} installed directly on the website. If you hold ${one ? "a web licence" : "web licences"} for ${it}, please send us ${one ? "a copy or the purchase receipt" : "copies or the purchase receipts"}. If not, the options are to either buy ${one ? "a web licence" : "web licences"} for ${thisFont}, or ${swap}.`;
    case "Demo Font":
      return `* ${names} ${one ? "is a demo (personal-use) version of a font" : "are demo (personal-use) versions of fonts"}, installed directly on the website. Demo fonts are not licensed for commercial websites. If you have bought the full version, please send us a copy of the licence or the purchase receipt. If not, the options are to either buy a web licence, or ${swap}.`;
    case "Subscription To Confirm":
      return `* The website loads ${one ? "a font" : "fonts"} through ${names}, which is a paid subscription. Could you confirm the subscription is still active and covers this website? If it has lapsed, ${swap}.`;
    default: // Licence Info Missing
      return `* ${names} ${one ? "is" : "are"} installed directly on the website, but we could not identify who owns ${it} or where ${it} came from. Could you let us know whether ${thisFont} ${one ? "was" : "were"} supplied by you, by a designer, or as part of your brand guidelines, and send over any paperwork you have?`;
  }
}

export function segmentsToText(segments, edits = {}) {
  return segments.map((s) => (typeof s === "string" ? s : (edits[s.id] ?? s.v))).join("");
}

export function buildFontEmail(r) {
  const fonts = clientFonts(r);
  if (!fonts.length) return null;
  const n = fonts.length;
  const one = n === 1;
  const groups = new Map();
  for (const f of fonts) {
    const l = issueLabel(f);
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(f);
  }
  const bullets = CLIENT_STATUSES.filter((l) => groups.has(l)).map((l, i) => ({ id: `b${i}`, v: fontBullet(l, groups.get(l)) }));

  const segments = [
    "Hi there,\n\nAs part of our ongoing website maintenance, we have recently carried out a font licence check across your website.\n\n",
    "With the increased use of automated tools and AI, font foundries and type designers are now using technology to identify where their fonts are being used online. This can sometimes result in businesses being contacted directly regarding font licensing or payment.\n\n",
    "Following our check, we have identified ",
    { id: "count", v: `${n} font${one ? "" : "s"}` },
    " currently in use on your website (",
    { id: "site", v: r.site },
    ") that may have outstanding licensing requirements. We wanted to flag ",
    { id: "this", v: one ? "this" : "these" },
    " with you in advance, as you may be contacted by the font owner or foundry in the future.\n\n",
    "Please could you take a look at the details below and let us know whether you have ",
    { id: "ask", v: one ? "an existing licence for this font" : "existing licences for these fonts" },
    ", or if you would like us to investigate the licensing requirements further.\n\n",
  ];
  bullets.forEach((b, i) => { segments.push(b); segments.push(i < bullets.length - 1 ? "\n\n" : "\n\n"); });
  segments.push("Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.\n\nKind regards,");

  return {
    site: r.site, count: n, kind: "fonts",
    subject: `${r.site} – font licence check (${n} font${one ? "" : "s"} to confirm)`,
    segments,
    body: segmentsToText(segments),
  };
}

function cleanImageName(url) {
  return fileName(url).replace(/-\d+x\d+(?=\.[a-z]+$)/i, "").replace(/-scaled(?=\.[a-z]+$)/i, "");
}
function shortPage(url) {
  try { const p = new URL(url).pathname.replace(/\/$/, ""); return p || "home page"; } catch { return ""; }
}

export function buildImageEmail(r) {
  if (!r || r.imgStatus !== "DONE") return null;
  const images = mergeImageSizes((r.images || []).filter((i) => i.flag && !isFreeLib(i.flag)));
  if (!images.length) return null;
  const n = images.length;
  const one = n === 1;
  const byLib = new Map();
  for (const i of images) {
    if (!byLib.has(i.flag)) byLib.set(i.flag, []);
    byLib.get(i.flag).push(i);
  }
  const segments = [
    "Hi there,\n\nAs part of our ongoing website maintenance, we have recently carried out a stock image licence check across your website.\n\n",
    "With the increased use of automated tools and AI, stock photo agencies are now using technology to identify where their images are being used online. This can sometimes result in businesses being contacted directly regarding image licensing or payment.\n\n",
    "Following our check, we have identified ",
    { id: "count", v: `${n} image${one ? "" : "s"}` },
    " currently in use on your website (",
    { id: "site", v: r.site },
    ") that may have outstanding licensing requirements. We wanted to flag ",
    { id: "this", v: one ? "this" : "these" },
    " with you in advance, as you may be contacted by the image owner or agency in the future.\n\n",
  ];
  let k = 0;
  for (const [lib, list] of byLib) {
    segments.push({ id: `lib${k}`, v: `${list.length === 1 ? "This image appears" : "These images appear"} to come from ${lib}:` });
    segments.push("\n");
    list.forEach((i, j) => {
      const page = i.pages?.[0] ? shortPage(i.pages[0]) : "";
      const more = i.pages?.length > 1 ? ` and ${i.pages.length - 1} other page${i.pages.length === 2 ? "" : "s"}` : "";
      segments.push("• ");
      segments.push({ id: `img${k}_${j}`, v: cleanImageName(i.url), href: i.url });
      if (page) segments.push({ id: `pg${k}_${j}`, v: ` (on ${page}${more})` });
      segments.push("\n");
    });
    segments.push("\n");
    k++;
  }
  segments.push(
    "Please could you let us know whether you have ",
    { id: "ask", v: one ? "a licence for this image" : "licences for these images" },
    " (a receipt, order number, or the account ",
    { id: "they", v: one ? "it was" : "they were" },
    " bought under). If not, we can replace ",
    { id: "them", v: one ? "it" : "them" },
    " with licensed or free alternatives, or buy a licence.\n\n",
    "Once we hear back from you, we will make any changes required free of charge. If you are not sure about any of this, just let us know and we will take it from there.\n\nKind regards,",
  );
  return {
    site: r.site, count: n, kind: "images",
    subject: `${r.site} – stock image licence check (${n} image${one ? "" : "s"} to confirm)`,
    segments,
    body: segmentsToText(segments),
  };
}

function esc(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// HTML version for pasting into an email client, so image names stay as links.
export function segmentsToHtml(segments, edits = {}) {
  const body = segments.map((s) => {
    if (typeof s === "string") return esc(s);
    const v = esc(edits[s.id] ?? s.v);
    return s.href ? `<a href="${esc(s.href)}">${v}</a>` : v;
  }).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${body.replace(/\n/g, "<br>")}</div>`;
}
