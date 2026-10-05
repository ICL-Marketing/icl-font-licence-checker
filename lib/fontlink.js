// Link for a font name: the page of the foundry (or service) the font belongs to.
// Pure function, safe in the browser and on the server; works on saved results.

const FOUNDRIES = [
  [/hoefler|frere-jones|typography\.com/i, "https://www.typography.com"],
  [/paratype/i, "https://www.paratype.com"],
  [/fontsmith/i, "https://www.fontsmith.com"],
  [/grilli/i, "https://www.grillitype.com"],
  [/monotype/i, "https://www.monotype.com"],
  [/linotype/i, "https://www.linotype.com"],
  [/\bitc\b|international typeface/i, "https://www.monotype.com"],
  [/font bureau/i, "https://fontbureau.typenetwork.com"],
  [/commercial type/i, "https://commercialtype.com"],
  [/klim/i, "https://klim.co.nz"],
  [/colophon/i, "https://www.colophon-foundry.org"],
  [/lineto/i, "https://lineto.com"],
  [/dinamo/i, "https://abcdinamo.com"],
  [/dalton maag/i, "https://www.daltonmaag.com"],
  [/foundry types|the foundry/i, "https://www.foundrytypes.co.uk"],
  [/exljbris|jos buivenga/i, "https://www.exljbris.com"],
  [/fontfabric/i, "https://www.fontfabric.com"],
  [/tinkov|radomir/i, "https://www.tinkov.info"],
  [/mark simonson/i, "https://www.marksimonson.com"],
  [/h&co|hfj/i, "https://www.typography.com"],
  [/oh no type|ohno/i, "https://ohnotype.co"],
  [/pangram/i, "https://pangrampangram.com"],
  [/displaay/i, "https://displaay.net"],
  [/typemates/i, "https://www.type-mates.com"],
  [/type-together|typetogether/i, "https://www.type-together.com"],
  [/zetafonts/i, "https://www.zetafonts.com"],
  [/latinotype/i, "https://www.latinotype.com"],
  [/atipo/i, "https://www.atipofoundry.com"],
  [/swiss typefaces/i, "https://www.swisstypefaces.com"],
  [/production type/i, "https://www.productiontype.com"],
  [/sharp type/i, "https://sharptype.co"],
  [/adobe/i, "https://fonts.adobe.com"],
  [/google/i, "https://fonts.google.com"],
  [/bitstream/i, "https://www.myfonts.com/collections/bitstream-foundry"],
  [/emigre/i, "https://www.emigre.com"],
  [/house industries/i, "https://houseind.com"],
  [/indian type foundry|\bitf\b/i, "https://www.indiantypefoundry.com"],
  [/fontshare/i, "https://www.fontshare.com"],
];

// Families with a well-known home when the file carries no maker info.
const FAMILY_HOMES = [
  [/\bgt\s/i, "https://www.grillitype.com"],
  [/\bfs\s/i, "https://www.fontsmith.com"],
  [/foundry sterling|foundry gridnik|foundry monoline/i, "https://www.foundrytypes.co.uk"],
  [/messina|nantes|luxerie/i, "https://luzi-type.ch"],
  [/sneak/i, "https://www.myfonts.com/search?query=sneak"],
  [/obviously|degular|swear|covik/i, "https://ohnotype.co"],
  [/gilroy/i, "https://www.tinkov.info"],
  [/museo/i, "https://www.exljbris.com"],
  [/nexa|mont\b/i, "https://www.fontfabric.com"],
  [/archer|gotham|whitney|mercury|sentinel|tungsten|knockout|verlag|chronicle|ideal sans|operator/i, "https://www.typography.com"],
  [/circe/i, "https://www.paratype.com"],
  [/proxima nova/i, "https://www.marksimonson.com"],
  [/font awesome/i, "https://fontawesome.com"],
];

function cleanName(fam) {
  return String(fam || "").replace(/\b(fontspring|myfonts|fontshop)\b/gi, "").replace(/\b(demo|trial)\b/gi, "").replace(/\s+/g, " ").trim();
}
function slug(fam) {
  return cleanName(fam).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function fontLink(f) {
  if (!f) return "";
  const fam = f.family || "";
  const m = f.meta || {};
  if ((f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || ""))) return `https://fonts.adobe.com/fonts/${slug(fam)}`;
  if (f.google === "yes") return `https://fonts.google.com/specimen/${encodeURIComponent(fam).replace(/%20/g, "+")}`;
  const vendor = m.vendorUrl || "";
  if (/^https?:\/\//i.test(vendor)) return vendor;
  if (/^www\./i.test(vendor)) return "https://" + vendor;
  const who = [m.manufacturer, m.designer, m.copyright, m.trademark].filter(Boolean).join(" ");
  const hit = FOUNDRIES.find(([re]) => re.test(who));
  if (hit) return hit[1];
  const urlInText = /(https?:\/\/[^\s)"']+|www\.[^\s)"']+)/i.exec(who + " " + (m.licenceUrl || ""));
  if (urlInText) return urlInText[1].startsWith("http") ? urlInText[1] : "https://" + urlInText[1];
  const home = FAMILY_HOMES.find(([re]) => re.test(fam));
  if (home) return home[1];
  if (f.freeVersion?.url) return f.freeVersion.url;
  return "https://www.myfonts.com/search?query=" + encodeURIComponent(fam);
}

// Clean-ups applied to saved results, so older scans match current rules.
export function isEmbeddedIconFont(f) {
  return f && f.kind === "Embedded (data URI)";
}
export function fixedFix(f) {
  if (f && /demo/i.test(f.note || "") && onAdobe(f)) {
    return "Embed it via an Adobe Fonts kit (add to a web project, paste the kit <link>, point the CSS at it) and delete the demo font files from the server.";
  }
  if (f && /onlinewebfonts/i.test(f.family || "") && f.kind === "Hosted service") {
    return "Find which font the site is loading from there (check the CSS font-family), then embed it properly: Adobe Fonts or Google Fonts if available, otherwise licence it or swap it.";
  }
  return f?.fix || "";
}

// Short, specific issue label for a font row (works on saved results).
// Font Awesome Brands / Free styles are free, even if an older scan flagged them.
export function isFreeFontAwesome(f) {
  const fam = f?.family || "";
  return /font ?awesome/i.test(fam) && /\b(brands|free)\b/i.test(fam) && !/\bpro\b/i.test(fam);
}
function onAdobe(f) {
  return f.adobe === "yes" || /^Adobe font installed as files|on Adobe Fonts/.test(f.note || "");
}
export function issueLabel(f) {
  if (!f) return "";
  const note = f.note || "";
  const fam = f.family || "";
  if (/onlinewebfonts/i.test(fam) || /redistribut/i.test(note)) return "Unlicensed Font Source";
  if (Array.isArray(f.faIcons)) return f.faIcons.some((i) => !i.free) ? "Icons Need Changing" : "Switch To Free Icons";
  if (/font awesome/i.test(fam) && /pro/i.test(note || fam)) return "Font Awesome Pro";
  if (f.kind !== "Hosted service" && onAdobe(f)) return "Adobe Font Not Linked";
  if (/demo/i.test(note)) return "Demo Font";
  if (f.kind === "Hosted service") return "Subscription To Confirm";
  if (f.google === "yes") return "Google Font Not Linked";
  if (f.freeVersion?.isFree) return "Free Version Available";
  if (/no licence info|could not be read|base64/i.test(note)) return "Licence Info Missing";
  return "Licence Not Found";
}
// Insertion order is the tracker's sort order: free fixes first.
export const ISSUE_FILL = {
  "Adobe Font Not Linked": "FFD4EDDA",
  "Google Font Not Linked": "FFD4EDDA",
  "Free Version Available": "FFD4EDDA",
  "Icons Need Changing": "FFD4EDDA",
  "Switch To Free Icons": "FFD4EDDA",
  "Demo Font": "FFF8D7DA",
  "Licence Info Missing": "FFFFF3CD",
  "Subscription To Confirm": "FFFFF3CD",
  "Licence Not Found": "FFF8D7DA",
  "Font Awesome Pro": "FFF8D7DA",
  "Unlicensed Font Source": "FFF8D7DA",
};

// The font's page on Adobe Fonts / Google Fonts, or the maker's free download
// page, for linking from the suggested fix.
export function freeRouteLink(f) {
  if (!f) return "";
  const fam = f.family || "";
  if (onAdobe(f)) return `https://fonts.adobe.com/fonts/${slug(fam)}`;
  if (f.google === "yes") return `https://fonts.google.com/specimen/${encodeURIComponent(cleanName(fam)).replace(/%20/g, "+")}`;
  if (f.freeVersion?.isFree && f.freeVersion.url) return f.freeVersion.url;
  return "";
}

// Severity of each label: green = we can fix it free, amber = needs checking, red = needs a licence.
export const ISSUE_TONE = {
  "Adobe Font Not Linked": "green", "Google Font Not Linked": "green", "Free Version Available": "green",
  "Icons Need Changing": "green", "Switch To Free Icons": "green",
  "Subscription To Confirm": "amber", "Licence Info Missing": "amber",
  "Licence Not Found": "red", "Demo Font": "red", "Font Awesome Pro": "red", "Unlicensed Font Source": "red",
};

function iconName(name) {
  const t = String(name || "").replace(/-/g, " ").replace(/\balt\b/g, "").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : name;
}
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

// One sentence per Pro-only icon, e.g.
// "Credit card: change fal fa-credit-card (Light, Pro only, 55 pages) to fas fa-credit-card."
export function faIconLines(f) {
  const change = (f?.faIcons || []).filter((i) => !i.free);
  if (!change.length) {
    return `No Pro-only icons found on ${plural(f?.faPagesChecked || 0, "page")}. Switch the site to Font Awesome Free.`;
  }
  return change.map((i) => {
    const to = /^No free version/.test(i.changeTo) ? "a similar free icon (no free version exists)" : i.changeTo;
    return `${iconName(i.icon)}: change ${i.cls} (${i.style}, Pro only, ${plural(i.uses, "page")}) to ${to}.`;
  }).join("\n");
}

// Free-route cell text: short, "N/A" when there is no free route.
export function freeRouteLabel(f) {
  if (!f || f.kind === "Hosted service") return "N/A";
  if (Array.isArray(f.faIcons)) return "Font Awesome Free";
  if (f.status !== "PROBLEM") return "N/A";
  if (onAdobe(f)) return "Adobe Fonts";
  if (f.google === "yes") return "Google Fonts";
  if (f.freeVersion?.isFree) return "Free version";
  return "N/A";
}

// "Adobe Embed/Next Action" cell: left blank where we paste the embed link
// ourselves (Adobe / Google), icon changes for Font Awesome, else the next step.
export function nextAction(f) {
  if (!f) return "";
  if (Array.isArray(f.faIcons)) return faIconLines(f);
  const route = freeRouteLabel(f);
  if (route === "Adobe Fonts" || route === "Google Fonts") return "";
  if (route === "Free version") return f.freeVersion.note;
  return fixedFix(f);
}

// Same image at different sizes: WordPress "-300x200", "-scaled", "@2x" and
// "-1" duplicate suffixes, or a stock library ID in the name.
export function imageKey(url, flag) {
  let name = "";
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop()); } catch { name = String(url || ""); }
  name = name.toLowerCase().replace(/\.(jpe?g|png|webp|gif|avif)$/, "");
  const id = /(\d{6,})/.exec(name);
  if (flag && id) return `${String(flag).toLowerCase()}|${id[1]}`;
  return name.replace(/@\dx$/, "").replace(/-\d+x\d+$/, "").replace(/-scaled$/, "").replace(/-\d$/, "");
}

// Collapse size variants of one image into a single entry: the original
// (or largest) file, with the number of sizes and every page it is on.
export function mergeImageSizes(images) {
  const map = new Map();
  const area = (u) => { const m = /-(\d+)x(\d+)\.[a-z]+$/i.exec(u || ""); return m ? +m[1] * +m[2] : Infinity; };
  for (const i of images || []) {
    const k = imageKey(i.url, i.flag);
    const cur = map.get(k);
    const pg = i.pages?.length ? i.pages : i.page ? [i.page] : [];
    if (!cur) { map.set(k, { ...i, sizes: 1, pages: [...pg] }); continue; }
    cur.sizes += 1;
    for (const p of pg) if (!cur.pages.includes(p)) cur.pages.push(p);
    if (area(i.url) > area(cur.url)) { cur.url = i.url; }
    if (!cur.meta && i.meta) cur.meta = i.meta;
  }
  return [...map.values()];
}

// Keep only credit/copyright fields from an image's embedded metadata
// (older scans stored every camera field: exposure, lens, serial number...).
const CREDIT_KEYS = /^(copyright|copyrightnotice|artist|credit|rights|creator|byline|source|webstatement|usageterms)$/i;
export function creditOnly(meta) {
  return String(meta || "").split(" | ")
    .filter((part) => CREDIT_KEYS.test((part.split(":")[0] || "").trim()))
    .join(" | ");
}

// Where to find an image in the site's admin. WordPress: the Media Library
// searched by file name. Otherwise the image file itself.
export function imageAdminLink(url) {
  try {
    const u = new URL(url);
    if (u.pathname.includes("/wp-content/uploads/")) {
      const base = decodeURIComponent(u.pathname.split("/").pop())
        .replace(/\.(jpe?g|png|webp|gif|avif)$/i, "")
        .replace(/-\d+x\d+$/, "").replace(/-scaled$/, "");
      const root = u.pathname.split("/wp-content/")[0];
      return `${u.origin}${root}/wp-admin/upload.php?mode=list&search=${encodeURIComponent(base)}`;
    }
  } catch {}
  return url;
}
