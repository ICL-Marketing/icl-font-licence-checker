/**
 * Font & stock-image licence scanner (server side).
 *
 * Scans one site: homepage + a few internal pages, every stylesheet and
 * @font-face, downloads self-hosted font files and reads the licence /
 * copyright / manufacturer strings embedded in them, then classifies each
 * font as PROBLEM / CHECK / OK. Also flags images whose filename or embedded
 * metadata points at a stock library.
 */

import * as cheerio from "cheerio";
import * as fontkit from "fontkit";
import exifr from "exifr";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ICL-font-licence-check";
const TIMEOUT_MS = 15000;
const MAX_CSS = 40;
const MAX_FONT_FILES = 40;
const MAX_IMAGES = 40;
const FONT_EXT = [".woff2", ".woff", ".ttf", ".otf", ".eot", ".svg"];
const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

export const OK = "OK";
export const CHECK = "CHECK";
export const PROBLEM = "PROBLEM";
export const SYSTEM = "SYSTEM";
export const UNREACHABLE = "UNREACHABLE"; // site could not be fetched or scan failed
export const RANK = { SYSTEM: 0, OK: 1, UNREACHABLE: 2, CHECK: 3, PROBLEM: 4 };

const SERVICES = [
  ["fonts.googleapis.com", "Google Fonts", OK, "Free, open-source fonts (OFL/Apache). Fine to use."],
  ["fonts.gstatic.com", "Google Fonts", OK, "Free, open-source fonts (OFL/Apache). Fine to use."],
  ["fonts.bunny.net", "Bunny Fonts", OK, "GDPR-friendly mirror of Google Fonts. Free."],
  ["use.typekit.net", "Adobe Fonts (Typekit) kit", OK,
    "Loaded via the Adobe Fonts kit, covered by ICL's Creative Cloud subscription. Fine as long as the font files are not also uploaded to the server."],
  ["p.typekit.net", "Adobe Fonts (Typekit) kit", OK, "Loaded via the Adobe Fonts kit, covered by ICL's Creative Cloud subscription."],
  ["use.fontawesome.com", "Font Awesome CDN", OK, "Font Awesome Free (OFL + MIT). Fine unless Pro icons are used.", true],
  ["kit.fontawesome.com", "Font Awesome Kit", CHECK, "Kit may be Free or Pro. If Pro icons are used, confirm an active Font Awesome Pro licence for the domain."],
  ["fast.fonts.net", "Monotype / fonts.com web font service", CHECK, "Commercial subscription (Monotype). Confirm the project ID is paid for and the domain is registered against it."],
  ["fonts.com", "Monotype / fonts.com", CHECK, "Commercial subscription. Confirm active licence."],
  ["cloud.typography.com", "Hoefler&Co cloud.typography", CHECK, "Commercial subscription (Gotham etc). Confirm active licence."],
  ["webfonts.fontstand.com", "Fontstand", CHECK, "Commercial. Confirm active licence."],
  ["f.fontdeck.com", "Fontdeck (service closed)", PROBLEM, "Fontdeck shut down in 2017. Fonts will not load; replace."],
  ["webfont.fontspring.com", "Fontspring", CHECK, "Commercial. Confirm licence."],
  ["fonts.typotheque.com", "Typotheque", CHECK, "Commercial. Confirm licence."],
  ["webfonts.creativecloud.com", "Adobe Fonts", OK, "Loaded via Adobe Fonts, covered by ICL's Creative Cloud subscription."],
];

const FREE_LICENCE_PATTERNS = [
  /SIL Open Font Licen[cs]e/i, /\bOFL\b/, /openfontlicense/i, /scripts\.sil\.org\/OFL/i,
  /Apache Licen[cs]e/i, /Ubuntu Font Licen[cs]e/i, /\bMIT Licen[cs]e\b/i, /GNU General Public/i,
  /\bGPL\b/, /public domain/i, /CC0/, /Unlicense/i, /free for (personal and )?commercial use/i, /free to use/i,
];

const COMMERCIAL_FOUNDRIES = [
  "paratype", "monotype", "linotype", "itc ", "international typeface", "hoefler", "h&co", "hfj",
  "fontsmith", "dalton maag", "commercial type", "klim type", "colophon", "lineto", "grilli", "dinamo",
  "swiss typefaces", "type network", "font bureau", "fontfont", "fsi fonts", "letraset", "bitstream",
  "urw", "zetafonts", "mark simonson", "radomir tinkov", "tinkov", "latinotype", "fenotype", "typetype",
  "fontfabric", "myfonts", "typodermic", "exljbris", "laura worthington", "sudtipos", "positype",
  "process type", "schick toikka", "typejockeys", "fontsite", "berthold", "elsner+flake", "emigre",
  "house industries", "mvb fonts", "neufville", "ourtype", "parachute", "porchez", "sharp type",
  "the designers foundry", "adobe systems", "adobe fonts", "typekit", "cstype", "type-together",
  "typetogether", "rosetta", "indian type foundry", "connary fagen", "fontspring", "typemates",
  "jeremy tankard", "northern block", "a2-type", "studio feixen", "newlyn", "mota italic",
  "letters from sweden", "milieu grotesque", "displaay", "pangram pangram", "atipo", "blaze type",
  "stawix", "carnoky", "canada type", "typeunion", "bureau roffa",
];

const COMMERCIAL_FAMILIES = [
  "circe", "proxima nova", "proxima-nova", "proximanova", "gotham", "helvetica", "avenir", "futura",
  "gilroy", "circular", "gt walsheim", "gt-walsheim", "brandon grotesque", "brandon-grotesque",
  "brandontext", "gill sans", "gillsans", "frutiger", "univers", "din next", "din pro", "dinpro",
  "trade gothic", "akzidenz", "neue haas", "neuehaas", "sofia pro", "sofiapro", "mont ", "aeonik",
  "graphik", "calibre", "founders grotesk", "söhne", "sohne", "soehne", "museo sans", "museosans",
  "museo slab", "museo ", "myriad", "minion", "garamond premier", "ff din", "ff-din", "ffdin",
  "bebas neue pro", "sf pro", "sfpro", "segoe", "effra", "freight", "tiempos", "canela", "apercu",
  "maison neue", "nexa", "cera pro", "cerapro", "visby", "gibson", "harmonia sans", "neo sans",
  "neosans", "avant garde", "avantgarde", "optima", "palatino", "bodoni", "didot", "clarendon",
  "rockwell", "stolzl", "basis grotesque", "hk grotesk pro", "monument extended", "neue montreal",
  "neue machina", "ppneue", "pp neue", "roc grotesk", "object sans", "sharp grotesk", "sharp sans",
  "styrene", "halyard", "larsseit", "euclid", "neue plak", "neueplak", "value sans", "formular",
  "halvar", "px grotesk", "suisse", "untitled sans", "national 2", "signifier",
];

const FREE_FAMILIES = [
  "open sans", "opensans", "roboto", "lato", "montserrat", "poppins", "raleway", "nunito", "inter",
  "work sans", "worksans", "playfair", "oswald", "rubik", "barlow", "source sans", "sourcesans",
  "source serif", "merriweather", "pt sans", "ptsans", "pt serif", "noto", "ubuntu", "dm sans",
  "dmsans", "dm serif", "libre", "fira", "josefin", "quicksand", "mulish", "muli", "karla", "cabin",
  "archivo", "manrope", "outfit", "jost", "lexend", "plus jakarta", "plusjakarta", "sora", "urbanist",
  "figtree", "red hat", "redhat", "space grotesk", "spacegrotesk", "bebas neue", "bebasneue", "anton",
  "lora", "cormorant", "eb garamond", "ebgaramond", "crimson", "titillium", "exo", "kanit", "prompt",
  "heebo", "hind", "cairo", "tajawal", "arimo", "tinos", "cousine", "ibm plex", "ibmplex", "public sans",
  "publicsans", "atkinson", "satoshi", "general sans", "clash", "switzer", "cabinet grotesk", "syne",
  "epilogue", "be vietnam", "chivo", "catamaran", "overpass", "inconsolata",
];

// Icon / UI-toolkit fonts bundled with themes, sliders and page builders.
// All free (MIT/OFL). They need no licence check, so they are dropped from
// the results entirely and only counted. Matched against family name AND
// the font file URL.
const IGNORED_FAMILIES = [
  "fontawesome", "font awesome", "font-awesome", "fa-", "dashicons", "eicons", "elementor",
  "themify", "icomoon", "genericons", "slick", "flaticon", "bootstrap-icons", "glyphicons",
  "material icons", "materialicons", "material-icons", "linearicons", "simple-line-icons",
  "ionicons", "feather", "woocommerce", "wpb", "revicons", "pe-icon", "et-line", "stroke-gap",
  "fontello", "wpforms", "icon", "revslider", "swiper", "jetpack", "wp-", "nicon", "divi",
  "etmodules", "avada", "fusion", "owl", "lightgallery", "lg.", "fancybox", "magnific", "tablepress",
  "ninja", "gravity", "wpml", "yoast", "rank-math", "ultimate", "uikit", "foundation-icons",
  "typicons", "entypo", "octicons", "weather-icons", "socicon", "iconsmind", "line-awesome",
  "lineicons", "boxicons", "remixicon", "tabler", "heroicons", "phosphor", "unicons", "zmdi",
  "mdi", "material design icons", "fab-", "emoji", "vc_", "js_composer", "siteorigin", "bricks",
  "oxygen", "breakdance", "kadence", "astra", "generatepress", "oceanwp", "hestia", "neve",
  "jupiter", "enfold", "salient", "bridge", "the7", "betheme", "x-icon", "cs-icon", "flexslider",
  "bxslider", "royalslider", "layerslider", "soliloquy", "metaslider", "smartslider", "contact-form",
  "cf7", "wpcf7", "woo", "edd", "bbpress", "buddypress", "learndash", "tutor", "elementskit",
  "ekit", "jet-", "jetelements", "happy-icon", "premium-addons", "powerpack", "essential-addons",
  "eael", "uael", "wpforms", "fluentform", "formidable", "quiz", "slider", "carousel", "glyph",
];

const STOCK_IMAGE_PATTERNS = [
  [/shutterstock[_-]?\d+/, "Shutterstock"],
  [/istock[_-]?\d+/, "iStock"],
  [/gettyimages[_-]?\d*/, "Getty Images"],
  [/adobestock[_-]?\d+/, "Adobe Stock"],
  [/depositphotos[_-]?\d+/, "Depositphotos"],
  [/dreamstime/, "Dreamstime"],
  [/123rf/, "123RF"],
  [/alamy/, "Alamy"],
  [/bigstock/, "Bigstock"],
  [/fotolia[_-]?\d+/, "Fotolia (now Adobe Stock)"],
  [/stock-photo/, "Stock photo (generic)"],
  [/unsplash/, "Unsplash (free)"],
  [/pexels/, "Pexels (free)"],
  [/pixabay/, "Pixabay (free)"],
  [/freepik/, "Freepik (attribution/licence needed)"],
];

// ---------------------------------------------------------------------------

function makeFetcher() {
  const cache = new Map();
  return async function get(url, maxBytes = 6_000_000) {
    if (cache.has(url)) return cache.get(url);
    let res;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*" },
        redirect: "follow",
        signal: ctrl.signal,
        cache: "no-store",
      });
      const buf = Buffer.from(await r.arrayBuffer());
      clearTimeout(t);
      res = {
        status: r.status,
        url: r.url || url,
        body: buf.subarray(0, maxBytes),
        type: r.headers.get("content-type") || "",
      };
    } catch (e) {
      res = { status: 0, url, body: Buffer.alloc(0), type: "", error: String(e?.message || e) };
    }
    cache.set(url, res);
    return res;
  };
}

function ext(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i) : "";
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function abs(base, u) {
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

function serviceFor(url) {
  for (const [frag, label, status, note, ignored] of SERVICES) {
    if (url.includes(frag)) return { frag, label, status, note, ignored: !!ignored };
  }
  return null;
}

const FONT_FACE_RE = /@font-face\s*\{([^}]*)\}/gis;
const URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const FAMILY_RE = /font-family\s*:\s*['"]?([^;'"}]+)/i;
const IMPORT_RE = /@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/gi;
const FONT_FAMILY_ANY_RE = /font-family\s*:\s*([^;}]+)/gi;

function extractFontFaces(css, base) {
  const faces = [];
  for (const m of css.matchAll(FONT_FACE_RE)) {
    const block = m[1];
    const fam = FAMILY_RE.exec(block);
    const family = fam ? fam[1].trim().replace(/^['"]|['"]$/g, "") : "?";
    const urls = [];
    let dataUri = false;
    for (const u of block.matchAll(URL_RE)) {
      const v = u[1].trim();
      if (v.startsWith("data:")) dataUri = true;
      else {
        const a = abs(base, v);
        if (a) urls.push(a);
      }
    }
    faces.push({ family, urls, dataUri, css: base });
  }
  return faces;
}

function nameRec(font, key) {
  try {
    const r = font.name?.records?.[key];
    if (!r) return "";
    if (typeof r === "string") return r.trim();
    return String(r.en || Object.values(r)[0] || "").trim();
  } catch {
    return "";
  }
}

function readFontMeta(buf) {
  try {
    let font = fontkit.create(buf);
    if (font.fonts) font = font.fonts[0]; // collection
    let vendorId = "";
    try {
      vendorId = (font["OS/2"]?.vendorID || "").trim();
    } catch {}
    return {
      family: nameRec(font, "preferredFamily") || nameRec(font, "fontFamily") || font.familyName || "",
      fullName: nameRec(font, "fullName"),
      copyright: nameRec(font, "copyright"),
      trademark: nameRec(font, "trademark"),
      manufacturer: nameRec(font, "manufacturer"),
      designer: nameRec(font, "designer"),
      vendorUrl: nameRec(font, "manufacturerURL"),
      licence: nameRec(font, "license"),
      licenceUrl: nameRec(font, "licenseURL"),
      vendorId,
    };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 120) };
  }
}

// Free Google Fonts look-alikes for common commercial typefaces.
const FREE_ALTERNATIVES = [
  ["circe", "Nunito or Montserrat"], ["proxima", "Montserrat or Inter"], ["gotham", "Montserrat"],
  ["helvetica", "Inter or Arimo"], ["avenir", "Nunito Sans"], ["futura", "Jost"],
  ["gilroy", "Outfit or Poppins"], ["circular", "DM Sans or Inter"], ["walsheim", "Outfit"],
  ["brandon", "Josefin Sans"], ["gill", "Lato or Cabin"], ["frutiger", "Hind or Open Sans"],
  ["univers", "Roboto"], ["din", "Barlow or Roboto Condensed"], ["trade gothic", "Oswald"],
  ["akzidenz", "Work Sans"], ["neue haas", "Inter"], ["neuehaas", "Inter"], ["sofia", "Mulish"],
  ["museo slab", "Zilla Slab"], ["museo", "Nunito"], ["myriad", "PT Sans"], ["minion", "Crimson Pro"],
  ["garamond", "EB Garamond"], ["segoe", "Open Sans"], ["effra", "Rubik"], ["graphik", "Work Sans"],
  ["calibre", "Inter"], ["aeonik", "Manrope"], ["nexa", "Outfit"], ["cera", "Outfit"],
  ["visby", "Lexend"], ["gibson", "Mulish"], ["bodoni", "Playfair Display"], ["didot", "Playfair Display"],
  ["clarendon", "Arvo"], ["rockwell", "Roboto Slab"], ["optima", "Marcellus"], ["palatino", "Lora"],
  ["avant", "Jost"], ["freight", "Lora"], ["tiempos", "Source Serif 4"], ["canela", "Cormorant"],
  ["apercu", "Figtree"], ["maison", "Inter"], ["söhne", "Inter"], ["sohne", "Inter"], ["soehne", "Inter"],
  ["suisse", "Inter"], ["euclid", "Inter"], ["mont", "Montserrat"], ["sf pro", "Inter"], ["sfpro", "Inter"],
  ["harmonia", "Nunito Sans"], ["neo sans", "Exo 2"], ["bebas", "Bebas Neue (free version)"],
  ["founders", "Work Sans"], ["styrene", "Space Grotesk"], ["halyard", "Mulish"], ["larsseit", "DM Sans"],
  ["monument", "Anton"], ["neue montreal", "Inter"], ["neue machina", "Space Grotesk"],
  ["object sans", "Outfit"], ["sharp", "Inter"], ["basis", "Work Sans"], ["hk grotesk", "Hanken Grotesk"],
  ["stolzl", "Outfit"], ["roc", "Outfit"],
];

function freeAlternative(fam) {
  const f = (fam || "").toLowerCase();
  const hit = FREE_ALTERNATIVES.find(([k]) => f.includes(k));
  return hit ? hit[1] : "";
}

function fixFor(kind, fam) {
  const alt = freeAlternative(fam);
  const swap = alt ? ` Free alternative on Google Fonts: ${alt}.` : " Or swap to a similar free Google Font.";
  switch (kind) {
    case "adobe-selfhosted":
      return "Add this font to an Adobe Fonts web project (fonts.adobe.com), paste the kit <link> into the site header, point the CSS font-family at the kit, then delete the font files from the server. Keep a screenshot of the kit as proof.";
    case "commercial-selfhosted":
      return "1) Check fonts.adobe.com: if this font is on Adobe Fonts, load it via a kit and delete the files from the server. 2) If not, buy a web font licence for this domain from the foundry or MyFonts and keep the receipt." + swap;
    case "fa-kit":
      return "Open the kit at fontawesome.com. If it is a Free kit, no action. If it uses Pro icons, confirm an active Pro licence covers this domain.";
    case "commercial-service":
      return "Log in to the service and confirm the subscription is active and this domain is registered. If it has lapsed, move the fonts to Adobe Fonts or Google Fonts.";
    case "data-uri":
      return "Find the font-family name in the CSS, then check that family by hand. If it is a commercial font, licence it or swap it; if it is a Google font, no action.";
    case "unknown-file":
      return "Find out where the file came from (theme, page builder, previous developer). If it is a Google font, no action. If it is commercial, licence it for this domain or swap to a free Google Font. Converting to .woff2 is also tidier than raw .otf/.ttf." ;
    case "fontdeck":
      return "Fontdeck closed in 2017. Replace with Google Fonts or Adobe Fonts.";
    default:
      return "No action needed.";
  }
}

function classifyFileFont(url, familyCss, meta) {
  const e = ext(url);
  const fam = (meta.family || familyCss || "").toLowerCase();
  const strings = ["copyright", "trademark", "manufacturer", "designer", "licence", "licenceUrl", "vendorUrl", "vendorId"]
    .map((k) => String(meta[k] || ""))
    .join(" ")
    .toLowerCase();
  const raw = e === ".otf" || e === ".ttf";

  let urlName = "";
  try { urlName = decodeURIComponent(new URL(url).pathname).toLowerCase(); } catch { urlName = url.toLowerCase(); }
  const ignoredBy = IGNORED_FAMILIES.find((c) => fam.includes(c) || urlName.includes("/" + c) || urlName.split("/").pop().includes(c));
  if (ignoredBy && !COMMERCIAL_FOUNDRIES.some((f) => strings.includes(f))) {
    return [OK, `Icon / UI font ('${ignoredBy}'). Free, no licence check needed.`, true, "No action needed."];
  }

  const free = FREE_LICENCE_PATTERNS.some((p) => p.test(strings));
  const foundry = COMMERCIAL_FOUNDRIES.find((f) => strings.includes(f));
  const commFamily = COMMERCIAL_FAMILIES.find((c) => fam.includes(c));
  const freeFamily = FREE_FAMILIES.find((c) => fam.includes(c));

  if (strings.includes("typekit") || strings.includes("adobe fonts") || strings.includes("adobe systems")) {
    return [PROBLEM, "File metadata references Adobe/Typekit. Adobe Fonts may NOT be self-hosted; they must load via the Adobe Fonts kit.", false, fixFor("adobe-selfhosted", fam)];
  }
  if (foundry && !free) {
    return [PROBLEM, `File metadata names commercial foundry '${foundry.trim()}'.` +
      (raw ? " Raw desktop font format (.otf/.ttf) uploaded to the server, usually a desktop licence, not a web licence." : "") +
      " Need proof of a web font licence covering this domain.", false, fixFor("commercial-selfhosted", fam)];
  }
  if (commFamily && !free) {
    return [PROBLEM, `'${commFamily.trim()}' is a commercial typeface.` +
      (raw ? " Raw desktop font format (.otf/.ttf) on server." : "") +
      " Need proof of a web font licence covering this domain.", false, fixFor("commercial-selfhosted", fam)];
  }
  if (free) return [OK, "Font file carries an open licence (OFL/Apache/MIT/GPL).", false, "No action needed."];
  if (freeFamily) return [OK, `Known free/open font or icon set ('${freeFamily}').`, false, "No action needed."];
  if (meta.error || !Object.keys(meta).length) {
    return [CHECK, raw
      ? "Could not read font metadata. Raw .otf/.ttf on server, check who owns it."
      : "Could not read font metadata (file missing, blocked or not a font).", false, fixFor("unknown-file", fam)];
  }
  if (raw) return [CHECK, "Raw desktop font format (.otf/.ttf) on server with no licence text in the file. Find out where it came from.", false, fixFor("unknown-file", fam)];
  return [CHECK, "No licence text in file and family not recognised. Find out where it came from.", false, fixFor("unknown-file", fam)];
}

function detectPlatform(html) {
  const low = html.toLowerCase();
  if (low.includes("wp-content")) {
    let p = "WordPress";
    if (low.includes("elementor")) p += " + Elementor";
    if (low.includes("et_pb") || low.includes("/divi/")) p += " + Divi";
    return p;
  }
  if (low.includes("shopify")) return "Shopify";
  if (low.includes("squarespace")) return "Squarespace";
  if (low.includes("wixstatic") || low.includes("wix.com")) return "Wix";
  if (low.includes("webflow")) return "Webflow";
  if (low.includes("_next/")) return "Next.js";
  return "";
}

/**
 * Scan one site. `site` is a bare domain like "example.co.uk".
 */
export async function scanSite(site, { pages = 4 } = {}) {
  const get = makeFetcher();
  const rec = {
    site, status: SYSTEM, http: 0, finalUrl: "", error: "", platform: "",
    fonts: [], images: [], pages: [], cssCount: 0, familiesInCss: [], scannedAt: new Date().toISOString(),
  };

  // --- homepage
  let html = "", home = null;
  const bare = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  for (const u of [`https://${bare}`, `https://www.${bare}`, `http://${bare}`, `http://www.${bare}`]) {
    const r = await get(u);
    rec.http = r.status;
    if (r.status && r.status < 400 && r.body.length) {
      html = r.body.toString("utf8");
      home = r.url;
      rec.error = "";
      break;
    }
    if (r.error) rec.error = r.error;
  }
  if (!html) {
    rec.error = rec.http
      ? `Could not fetch homepage (HTTP ${rec.http}). The site may be blocking automated requests; check it by hand.`
      : `Could not reach the site (${rec.error || "no response"}). It may be down, or the domain may have changed.`;
    rec.status = UNREACHABLE;
    rec.fix = rec.http
      ? "Open the site in a normal browser. If it loads, it is blocking bots: check fonts by hand (DevTools → Network → Font) or whitelist the checker. If it does not load, the site is down."
      : "Open the site in a browser. If it does not load, confirm the domain is still live and remove it from the list if the site has gone.";
    return rec;
  }
  rec.finalUrl = home;
  rec.platform = detectPlatform(html);
  const host = hostOf(home);

  // --- pages
  const $home = cheerio.load(html);
  const pageList = [[home, $home]];
  const seen = new Set([home.replace(/\/$/, "")]);
  for (const a of $home("a[href]").toArray()) {
    if (pageList.length >= pages) break;
    const u = abs(home, $home(a).attr("href"))?.split("#")[0];
    if (!u || hostOf(u) !== host) continue;
    if ([...IMG_EXT, ".pdf", ".zip"].some((x) => u.toLowerCase().endsWith(x))) continue;
    if (seen.has(u.replace(/\/$/, "")) || u.includes("wp-login") || u.includes("?")) continue;
    seen.add(u.replace(/\/$/, ""));
    const r = await get(u);
    if (r.status && r.status < 400 && r.type.includes("html")) {
      pageList.push([r.url, cheerio.load(r.body.toString("utf8"))]);
    }
  }
  rec.pages = pageList.map((p) => p[0]);

  const fonts = new Map();
  const cssUrls = new Map();
  const inlineCss = [];
  const imgUrls = [];

  function addFont(key, props) {
    if (!fonts.has(key)) fonts.set(key, { foundOn: [], meta: {}, ...props });
    return fonts.get(key);
  }
  function addService(svc, src, foundOn) {
    const fixKind = svc.status === OK ? "ok" : svc.frag.includes("fontawesome") ? "fa-kit" : svc.frag.includes("fontdeck") ? "fontdeck" : "commercial-service";
    const fr = addFont("svc:" + svc.label, { kind: "Hosted service", family: svc.label, source: src, status: svc.status, note: svc.note, ignored: svc.ignored, fix: fixFor(fixKind) });
    if (src.includes("typekit")) {
      const m = /typekit\.net\/([a-z0-9]+)\.(?:css|js)/.exec(src);
      if (m) fr.family = `${svc.label} (kit ${m[1]})`;
    }
    if (src.includes("fonts.googleapis.com")) {
      const fams = [...src.matchAll(/family=([^&:]+)/g)].map((x) => decodeURIComponent(x[1]).replace(/\+/g, " "));
      if (fams.length) fr.family = "Google Fonts: " + fams.slice(0, 8).join(", ");
    }
    if (!fr.foundOn.includes(foundOn)) fr.foundOn.push(foundOn);
  }

  for (const [pageUrl, $] of pageList) {
    for (const el of $("link, script, iframe").toArray()) {
      const t = $(el);
      const raw = t.attr("href") || t.attr("src") || "";
      if (!raw) continue;
      const u = abs(pageUrl, raw);
      if (!u) continue;
      const svc = serviceFor(u);
      if (svc) addService(svc, u, pageUrl);
      const rel = (t.attr("rel") || "").toLowerCase();
      const asAttr = (t.attr("as") || "").toLowerCase();
      const clean = u.split("?")[0].toLowerCase();
      if (el.tagName === "link" && (rel.includes("stylesheet") || clean.endsWith(".css"))) {
        if (!cssUrls.has(u)) cssUrls.set(u, pageUrl);
      }
      if (el.tagName === "link" && (asAttr === "font" || FONT_EXT.some((x) => clean.endsWith(x))) && !svc) {
        const fr = addFont("file:" + u.split("?")[0], { kind: "Font file", family: "(preload)", source: u, status: CHECK, note: "", css: "" });
        if (!fr.foundOn.includes(pageUrl)) fr.foundOn.push(pageUrl);
      }
    }
    for (const st of $("style").toArray()) inlineCss.push([pageUrl, $(st).text()]);
    for (const img of $("img").toArray()) {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      if (!src || src.startsWith("data:")) continue;
      const u = abs(pageUrl, src);
      if (u) imgUrls.push(u);
    }
    for (const m of $.html().matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp))/gi)) {
      const u = abs(pageUrl, m[1]);
      if (u) imgUrls.push(u);
    }
  }

  // --- CSS
  const cssTexts = inlineCss.map(([p, t]) => [p, t, p]);
  const queue = [...cssUrls.entries()];
  let n = 0;
  while (queue.length && n < MAX_CSS) {
    const [cu, foundOn] = queue.shift();
    n++;
    const r = await get(cu);
    if (!r.body.length) continue;
    const text = r.body.toString("utf8");
    cssTexts.push([r.url, text, foundOn]);
    for (const m of text.matchAll(IMPORT_RE)) {
      const iu = abs(r.url, m[1]);
      if (!iu) continue;
      const svc = serviceFor(iu);
      if (svc) addService(svc, iu, foundOn);
      else if (!cssUrls.has(iu) && n < MAX_CSS) {
        cssUrls.set(iu, foundOn);
        queue.push([iu, foundOn]);
      }
    }
  }
  rec.cssCount = cssTexts.length;

  const famsInUse = new Set();
  for (const [base, text, foundOn] of cssTexts) {
    for (const m of text.matchAll(FONT_FAMILY_ANY_RE)) {
      for (let f of m[1].split(",")) {
        f = f.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
        if (f && !["inherit", "initial", "unset", "sans-serif", "serif", "monospace", "system-ui", "cursive", "none"].includes(f) && !f.startsWith("var(")) {
          famsInUse.add(f.slice(0, 60));
        }
      }
    }
    for (const face of extractFontFaces(text, base)) {
      if (face.dataUri && !face.urls.length) {
        const fr = addFont("data:" + face.family, {
          kind: "Embedded (data URI)", family: face.family, source: base, status: CHECK, css: base,
          note: "Font embedded inside CSS as base64. Cannot read licence; identify the family manually.",
          fix: fixFor("data-uri", face.family),
        });
        if (!fr.foundOn.includes(foundOn)) fr.foundOn.push(foundOn);
      }
      for (const u of face.urls) {
        const clean = u.split("?")[0].split("#")[0];
        if (!FONT_EXT.some((x) => clean.toLowerCase().endsWith(x))) continue;
        const svc = serviceFor(u);
        if (svc) {
          addService(svc, u, foundOn);
          continue;
        }
        const fr = addFont("file:" + clean, { kind: "Font file", family: face.family, source: u, status: CHECK, note: "", css: base });
        if (fr.family === "(preload)") fr.family = face.family;
        if (!fr.foundOn.includes(foundOn)) fr.foundOn.push(foundOn);
      }
    }
  }
  rec.familiesInCss = [...famsInUse].sort().slice(0, 80);

  // --- Download font files and read metadata
  const fileKeys = [...fonts.entries()].filter(([, v]) => v.kind === "Font file").map(([k]) => k);
  const picked = [];
  const seenSig = new Set();
  for (const k of fileKeys) {
    const v = fonts.get(k);
    const e = ext(v.source);
    if (e === ".eot" || e === ".svg") continue;
    const sig = v.family.toLowerCase() + "|" + e;
    if (seenSig.has(sig) && fileKeys.length > MAX_FONT_FILES) continue;
    seenSig.add(sig);
    picked.push(k);
  }
  const chosen = picked.slice(0, MAX_FONT_FILES);
  await Promise.all(chosen.map(async (k) => {
    const v = fonts.get(k);
    const r = await get(v.source);
    v.http = r.status;
    const srcHost = hostOf(r.url);
    const same = srcHost === host || srcHost.endsWith("." + host);
    v.hostedOn = same ? "own server" : srcHost;
    if (r.status && r.status < 400 && r.body.length) {
      v.meta = readFontMeta(r.body);
      v.bytes = r.body.length;
    } else {
      v.meta = { error: `HTTP ${r.status}` };
    }
    [v.status, v.note, v.ignored, v.fix] = classifyFileFont(r.url, v.family, v.meta);
    if (v.family === "(preload)") {
      v.family = v.meta.family || (() => { try { return new URL(r.url).pathname.split("/").pop(); } catch { return r.url; } })();
    }
  }));
  for (const k of fileKeys) {
    if (!chosen.includes(k)) {
      const v = fonts.get(k);
      v.status = CHECK;
      v.note = "Not downloaded (site has many font files). Same family as another row.";
    }
  }

  // --- Images
  const imgs = [];
  const seenImg = new Set();
  for (const u of imgUrls) {
    const clean = u.split("?")[0];
    if (seenImg.has(clean) || !IMG_EXT.some((x) => clean.toLowerCase().endsWith(x))) continue;
    seenImg.add(clean);
    let name = "";
    try { name = decodeURIComponent(new URL(clean).pathname.split("/").pop()).toLowerCase(); } catch { name = clean.toLowerCase(); }
    const hit = STOCK_IMAGE_PATTERNS.find(([p]) => p.test(name));
    imgs.push({ url: u, flag: hit ? hit[1] : "", meta: "" });
  }
  const toCheck = imgs.filter((i) => /\.(jpe?g|png|webp)$/i.test(i.url.split("?")[0])).slice(0, MAX_IMAGES);
  await Promise.all(toCheck.map(async (entry) => {
    const r = await get(entry.url, 3_000_000);
    if (!r.body.length) return;
    try {
      const data = await exifr.parse(r.body, {
        tiff: true, exif: false, gps: false, xmp: true, iptc: true, icc: false,
        pick: ["Copyright", "Artist", "ImageDescription", "rights", "creator", "WebStatement", "Credit", "Source", "CopyrightNotice", "Byline", "description"],
      });
      if (!data) return;
      const bits = [];
      for (const [k, v] of Object.entries(data)) {
        if (v == null) continue;
        const s = typeof v === "object" ? (v.value ?? JSON.stringify(v)) : String(v);
        const txt = String(s).replace(/\s+/g, " ").trim();
        if (txt) bits.push(`${k}: ${txt.slice(0, 120)}`);
      }
      entry.meta = bits.join(" | ");
      if (!entry.flag && entry.meta) {
        const low = entry.meta.toLowerCase();
        const hit = STOCK_IMAGE_PATTERNS.find(([p, lab]) => p.test(low) || low.includes(lab.split(" ")[0].toLowerCase()));
        if (hit) entry.flag = hit[1];
        else if (low.includes("getty") || low.includes("©") || low.includes("copyright")) entry.flag = "Has copyright metadata";
      }
    } catch {}
  }));
  rec.images = imgs.filter((i) => i.flag || i.meta);
  rec.imagesChecked = imgs.length;

  const all = [...fonts.values()];
  const ignored = all.filter((f) => f.ignored);
  rec.fonts = all.filter((f) => !f.ignored);
  rec.ignoredFonts = [...new Set(ignored.map((f) => f.family))];
  rec.status = rec.fonts.length ? rec.fonts.reduce((w, f) => (RANK[f.status] > RANK[w] ? f.status : w), SYSTEM) : SYSTEM;
  return rec;
}

export function normaliseSite(s) {
  return String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
