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

function slug(fam) {
  return String(fam || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  if (f && /onlinewebfonts/i.test(f.family || "") && f.kind === "Hosted service") {
    return "Find which font the site is loading from there (check the CSS font-family), then embed it properly: Adobe Fonts or Google Fonts if available, otherwise licence it or swap it.";
  }
  return f?.fix || "";
}

// Short, specific issue label for a font row (works on saved results).
export function issueLabel(f) {
  if (!f) return "";
  const note = f.note || "";
  const fam = f.family || "";
  if (/onlinewebfonts/i.test(fam) || /redistribut/i.test(note)) return "Unlicensed Font Source";
  if (/font awesome/i.test(fam) && /pro/i.test(note || fam)) return "Font Awesome Pro";
  if (/demo/i.test(note)) return "Demo Font";
  if (f.kind === "Hosted service") return "Subscription To Confirm";
  if (f.adobe === "yes" || /^Adobe font installed as files/.test(note)) return "Adobe Font Not Linked";
  if (f.google === "yes") return "Google Font Not Linked";
  if (f.freeVersion?.isFree) return "Free Version Available";
  if (/no licence info|could not be read|base64/i.test(note)) return "Licence Info Missing";
  return "Licence Not Found";
}
export const ISSUE_FILL = {
  "Adobe Font Not Linked": "FFD4EDDA",
  "Google Font Not Linked": "FFD4EDDA",
  "Free Version Available": "FFD4EDDA",
  "Subscription To Confirm": "FFFFF3CD",
  "Licence Info Missing": "FFFFF3CD",
  "Licence Not Found": "FFF8D7DA",
  "Demo Font": "FFF8D7DA",
  "Font Awesome Pro": "FFF8D7DA",
  "Unlicensed Font Source": "FFF8D7DA",
};

// The font's page on Adobe Fonts / Google Fonts, or the maker's free download
// page, for linking from the suggested fix.
export function freeRouteLink(f) {
  if (!f) return "";
  const fam = f.family || "";
  if (f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) return `https://fonts.adobe.com/fonts/${slug(fam)}`;
  if (f.google === "yes") return `https://fonts.google.com/specimen/${encodeURIComponent(fam).replace(/%20/g, "+")}`;
  if (f.freeVersion?.isFree && f.freeVersion.url) return f.freeVersion.url;
  return "";
}
