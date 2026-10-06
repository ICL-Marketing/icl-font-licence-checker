// Client-friendly emails, one for fonts and one for stock images.
//
// Each email is built as a list of segments. Fixed template wording is a plain
// string; anything that changes per site (the domain, counts, and each bullet)
// is an object { id, v } so the app can highlight and edit it.
//
// Only issues the client has to answer are included. Everything we fix ourselves
// at no cost (Adobe / Google relink, free version, Font Awesome icon swaps,
// fonts loaded from a redistribution site) is left out.

import { issueLabel, isEmbeddedIconFont, isFreeFontAwesome, mergeImageSizes, creditOnly, imageAdminLink, stockLibraryLink, stockLicenceSignal, withoutFixed } from "@/lib/fontlink";

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
  return foundry ? `${f.family} (Owned by ${foundry})` : f.family;
}

// One short bullet per font...
function fontBulletLine(label, f, first) {
  const name = nameWithFoundry(f);
  // Later bullets in a group say "also" instead of repeating the full sentence.
  switch (label) {
    case "Licence Not Found":
      return first ? `* ${name} is a paid typeface installed directly on the website.` : `* ${name} is also a paid typeface installed directly on the website.`;
    case "Demo Font":
      return first
        ? `* ${name} is a demo (personal-use) version of a font, installed directly on the website. Demo fonts are not licensed for commercial websites.`
        : `* ${name} is also a demo (personal-use) version of a font, installed directly on the website.`;
    case "Subscription To Confirm":
      return first ? `* The website loads fonts through ${f.family}, which is a paid subscription.` : `* The website also loads fonts through ${f.family}, which is a paid subscription.`;
    default:
      return first
        ? `* ${f.family} is installed directly on the website, but we could not identify who owns it or where it came from.`
        : `* ${f.family} is also installed directly on the website, but we could not identify who owns it or where it came from.`;
  }
}

// ...then one paragraph per group saying what we need, so nothing is repeated.
function groupAsk(label, count) {
  const one = count === 1;
  const it = one ? "it" : "them";
  const thisFont = one ? "this font" : "these fonts";
  const swap = `we can suggest ${one ? "a suitable free font" : "suitable free fonts"} to replace ${it} that ${one ? "keeps" : "keep"} the look of the site`;
  switch (label) {
    case "Licence Not Found":
      return `If you hold ${one ? "a web licence" : "web licences"} for ${it}, please send us ${one ? "a copy or the purchase receipt" : "copies or the purchase receipts"}. If not, the options are to either buy ${one ? "a web licence" : "web licences"} for ${thisFont}, or ${swap}.`;
    case "Demo Font":
      return `If you have bought the full version, please send us a copy of the licence or the purchase receipt. If not, the options are to either buy a web licence, or ${swap}.`;
    case "Subscription To Confirm":
      return `Could you confirm the subscription is still active and covers this website? If it has lapsed, ${swap}.`;
    default:
      return `Could you let us know whether ${thisFont} ${one ? "was" : "were"} supplied by you, by a designer, or as part of your brand guidelines, and send over any paperwork you have?`;
  }
}

export function segmentsToText(segments, edits = {}) {
  return segments.map((s) => (typeof s === "string" ? s : (edits[s.id] ?? s.v))).join("");
}

// "Hi Ben," when the email goes to one person; "Hi there," when several addresses
// are copied in, when there is no contact name, or when the contact field lists
// several people. Editable in the email.
function greeting(client) {
  const poc = String(client?.poc || "").trim();
  const several = (client?.emails?.length || 0) > 1 || /[\n,&/|]| and /i.test(poc);
  const first = poc.replace(/\s*[-–(].*$/, "").trim().split(/\s+/)[0] || "";
  return { id: "greet", v: !several && /^[A-Za-z][A-Za-z'’-]{1,20}$/.test(first) ? `Hi ${first},` : "Hi there," };
}

export function buildFontEmail(r0, client) {
  const r = withoutFixed(r0); // fonts marked fixed are left out
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

  const segments = [
    greeting(client), "\n\nHope you are well.\n\nWe have recently carried out a font licence check across your website ",
    { id: "site", v: r.site },
    ".\n\n",
    "With the increased use of automated tools and AI, font foundries and type designers are now using technology to identify where their fonts are being used online. This can sometimes result in businesses being contacted directly regarding font licenses to request payment if they have been incorrectly used.\n\n",
    "Following our check, we have identified ",
    { id: "count", v: `${n} font${one ? "" : "s"}` },
    " currently in use on your website that may have outstanding licensing requirements. We wanted to flag ",
    { id: "this", v: one ? "this" : "these" },
    " with you in advance, as you may be contacted by the font owner or foundry in the future.\n\n",
    "Please could you take a look at the details below and let us know whether you have ",
    { id: "ask", v: one ? "an existing web licence for this font" : "existing web licences for these fonts" },
    ", or if you would like us to investigate the licensing requirements further.\n\n",
  ];
  CLIENT_STATUSES.filter((l) => groups.has(l)).forEach((l, g) => {
    const list = groups.get(l);
    list.forEach((f, i) => { segments.push({ id: `b${g}_${i}`, v: fontBulletLine(l, f, i === 0) }); segments.push("\n"); });
    segments.push("\n");
    segments.push({ id: `ask${g}`, v: groupAsk(l, list.length) });
    segments.push("\n\n");
  });
  segments.push(
    "Once we hear back from you, we will make any changes required. If you are not sure about any of this, just let us know and we will take it from there.\n\n",
    "This is a free service we offer, but we hope that you will continue to use us for supporting your business with any digital, creative, technical and marketing needs.",
  );

  return {
    site: r.site, count: n, kind: "fonts",
    subject: `${r.site} – font licence check`,
    segments,
    body: segmentsToText(segments),
  };
}

function cleanImageName(url) {
  return fileName(url).replace(/-\d+x\d+(?=\.[a-z]+$)/i, "").replace(/-scaled(?=\.[a-z]+$)/i, "");
}

// "/" -> "Home", "/about-us/" -> "About us", "/news/some-post" -> "Some post".
function pageName(url) {
  let path = "";
  try { path = new URL(url).pathname; } catch { path = String(url || ""); }
  const last = path.replace(/\/$/, "").split("/").pop();
  if (!last) return "Home";
  const t = decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Home";
}

export const MAX_EMAIL_IMAGES = 10;

export function buildImageEmail(r0, client) {
  const r = withoutFixed(r0); // images marked fixed are left out
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
  const these = one ? "this" : "these";
  const segments = [
    greeting(client), "\n\nHope you are well.\n\nAs part of our ongoing website maintenance, we have recently carried out a stock image licence check across your website ",
    { id: "site", v: r.site },
    ".\n\n",
    "With the increased use of automated tools and AI, we've come to understand that stock photo agencies are now using technology to identify where their images are being used online. This can sometimes result in businesses being contacted directly regarding image licenses to request payment if they have been incorrectly used.\n\n",
    "We've taken it upon ourselves to create a tool that also searches for these, to give us a chance to resolve licensing issues before any payments are requested.\n\n",
    "Following our check, we have identified ",
    { id: "count", v: `${n} image${one ? "" : "s"}` },
    " currently in use on your website that may have outstanding licensing requirements. We’re sure that ",
    { id: "these1", v: one ? "this likely already has" : "these likely already have" },
    " the correct licenses, but we wanted to flag ",
    { id: "these2", v: these },
    " just in case you are contacted by the image owner.\n\n",
  ];
  // More than 10 images: the list goes in an attached spreadsheet instead of the email.
  const attach = n > MAX_EMAIL_IMAGES;
  if (attach) {
    const counts = [...byLib].map(([lib, list]) => `${list.length} from ${lib}`);
    segments.push(
      { id: "attach", v: `Rather than list them all here, we have attached a spreadsheet with every image (${counts.join(", ")}), which pages it appears on, a link to it on the stock library and our assessment of each.` },
      " There is a status column on the sheet: if you could mark each image as licensed, to be replaced, or to be removed and send it back to us, we will make any changes needed.\n\n",
    );
  }
  let k = 0;
  for (const [lib, list] of attach ? [] : byLib) {
    segments.push({ id: `lib${k}`, v: `${list.length === 1 ? "This image appears" : "These images appear"} to come from ${lib}:` });
    segments.push("\n");
    list.forEach((i, j) => {
      segments.push("• ");
      segments.push({ id: `img${k}_${j}`, v: cleanImageName(i.url), href: imageAdminLink(i.url) });
      // Each page name links to that page; up to three, then "and N more".
      const seen = new Set();
      const pages = (i.pages?.length ? i.pages : i.page ? [i.page] : []).filter((u) => {
        const nm = pageName(u);
        if (seen.has(nm)) return false;
        seen.add(nm);
        return true;
      });
      if (pages.length) {
        segments.push(" (");
        pages.slice(0, 3).forEach((u, x) => {
          if (x) segments.push(", ");
          segments.push({ id: `pg${k}_${j}_${x}`, v: pageName(u), href: u, link: true });
        });
        if (pages.length > 3) segments.push(` and ${pages.length - 3} more`);
        segments.push(")");
      }
      // Link to the image on the stock library so it can be checked.
      const lib = stockLibraryLink(i.url, i.flag);
      if (lib) {
        segments.push(" – ");
        segments.push({ id: `lib${k}_${j}`, v: `View on ${i.flag}`, href: lib, link: true });
      }
      const sig = stockLicenceSignal(i).status;
      segments.push({ id: `sig${k}_${j}`, v: sig === "Likely licensed" ? " – likely licensed" : sig === "Possible preview" ? " – may be a watermarked preview, worth checking" : "" });
      segments.push("\n");
    });
    segments.push("\n");
    k++;
  }
  segments.push(
    "If you are not sure about any of this, just let us know and we’ll do our best to help.\n\n",
    "This is a free service we offer, but we hope that you will continue to use us for supporting your business with any digital, creative, technical and marketing needs.",
  );
  return {
    site: r.site, count: n, kind: "images", attach,
    subject: `${r.site} – stock image licence check`,
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
