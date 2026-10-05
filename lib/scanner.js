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
  ["onlinewebfonts.com", "onlinewebfonts.com (redistribution site)", PROBLEM,
    "Loaded from onlinewebfonts.com, a site that redistributes fonts without proper licences. Identify the real font and either licence it or replace it; do not keep loading it from there."],
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
  /Free Font Licen[cs]e/i, /ParaType Free/i, /Bitstream Vera/i, /DejaVu/i, /Liberation/i, /Font Awesome Free/i,
  /fontawesome\.com\/license\/free/i, /creativecommons\.org/i, /\bCC BY\b/i, /Open Source/i,
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
  "stawix", "carnoky", "canada type", "typeunion", "bureau roffa", "oh no type", "ohno type", "ohnotype",
  "luzi type", "fontwerk", "optimo", "abc dinamo", "the foundry", "foundry types",
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
  "obviously", "ohno blazeface", "blazeface", "degular", "swear", "covik", "vulf", "nickel", "cheee",
  "messina sans", "messina serif", "nantes", "luxerie", "sneak", "foundry sterling",
  // Foundry prefixes and more commercial families
  "fs", "gt", "ff", "itc", "foundry sterling", "foundry", "neutra", "neutraface", "archer", "whitney",
  "mercury", "chronicle", "sentinel", "tungsten", "knockout", "verlag", "ideal sans", "ringside",
  "operator", "benton", "benton sans", "interstate", "avenir next", "helvetica now", "neue helvetica",
  "aktiv grotesk", "aktiv", "pluto", "bw modelica", "modelica", "intro", "sabon", "ff meta", "scala",
  "thesans", "the sans", "thesis", "dax", "eurostile", "bank gothic", "lubalin", "cooper black",
  "souvenir", "serifa", "glypha", "vag rounded", "century gothic", "franklin gothic", "news gothic",
  "mr eaves", "mrs eaves", "filosofia", "adobe caslon", "adobe garamond", "trajan", "bickham",
  "lust", "domaine", "financier", "austin", "portrait", "marr sans", "druk", "action",
  "ambit", "biennale", "campton", "cocogoose", "gotham rounded", "metropolis pro", "proxima soft",
  "raisonne", "recoleta", "tt norms", "tt commons", "tt hoves", "tt firs",
  "futura pt", "futura now", "neue kabel", "kabel", "brother", "gilroy", "mark pro", "ff mark",
  "museo sans rounded", "museo cyrl", "quasimoda", "visuelt", "silka", "messina", "general grotesque",
  "times new roman", "times", "arial", "verdana", "tahoma", "trebuchet", "georgia", "calibri",
  "cambria", "candara", "consolas", "constantia", "corbel", "segoe ui", "lucida", "book antiqua",
  "comic sans", "impact", "garamond premier pro", "myriad pro", "minion pro",
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
  "opendyslexic", "open dyslexic", "atkinson hyperlegible", "lexie readable", "pt mono", "pt root", "source sans", "source sans pro", "source sans 3", "source serif", "source serif pro",
  "source serif 4", "source code", "source code pro", "aller", "ubuntu", "dejavu", "liberation",
  "bitstream vera", "droid", "cantarell", "oxygen", "asap", "alegreya", "amatic", "arvo", "bitter",
  "bree serif", "comfortaa", "dancing script", "dosis", "fjalla", "francois one", "gloria hallelujah",
  "great vibes", "hanken grotesk", "indie flower", "kaushan", "libre franklin", "libre baskerville",
  "libre caslon", "lobster", "maven pro", "monda", "nanum", "nobile", "noticia", "old standard",
  "pacifico", "patua", "permanent marker", "philosopher", "play", "questrial", "roboto slab",
  "roboto condensed", "roboto mono", "sacramento", "satisfy", "shadows into light", "signika",
  "slabo", "spectral", "tenor sans", "ubuntu mono", "varela", "vollkorn", "yanone", "yantramanav",
  "zilla slab", "abril fatface", "anonymous pro", "cardo", "crete round", "cuprum", "didact gothic",
  "domine", "economica", "fira code", "fira sans", "frank ruhl", "gentium", "glegoo", "istok",
  "kalam", "lustria", "magra", "martel", "merriweather sans", "neuton", "nunito sans", "open sans condensed",
  "oxygen mono", "pontano", "prata", "pridi", "quattrocento", "rajdhani", "rambla", "rokkitt", "rosario",
  "ropa sans", "ruda", "sarala", "scope one", "sintony", "taviraj", "teko", "trirong", "unna",
  "vidaloka", "yrsa", "bebas neue", "league spartan", "league gothic", "ostrich", "raleway dots",
  "junction", "linden hill", "goudy bookletter", "orbitron", "chunk", "blackout", "knewave",
  "sniglet", "fanwood", "prociono", "sorts mill", "inter tight", "inter variable", "geist", "geist mono",
  "space mono", "jetbrains mono", "ibm plex mono", "ibm plex sans", "ibm plex serif", "golos", "onest",
  "unbounded", "wix madefor", "instrument sans", "instrument serif", "bricolage", "gabarito",
  "hedvig", "newsreader", "fraunces", "literata", "crimson pro", "lora", "playfair display",
  "montserrat alternates", "quicksand", "varela round", "assistant", "secular one", "rubik mono",
  "alef", "heebo", "miriam libre", "suez one", "frank ruhl libre",
];

// Icon / UI-toolkit fonts bundled with themes, sliders and page builders.
// All free (MIT/OFL). They need no licence check, so they are dropped from
// the results entirely and only counted. Matched against family name AND
// the font file URL.
const IGNORED_FAMILIES = [
  "videojs", "video-js", "vjs", "plyr", "mejs", "mediaelement", "jwplayer", "flowplayer", "wp-media",
  "raty", "tripadvisor", "astra", "astra-icons", "kadence-icons", "neve-icons", "oceanwp-icons", "trustpilot", "reviews-io", "feefo", "google-reviews", "widget", "widgets",
  "fontawesome", "font awesome", "font-awesome", "fa", "fa-", "fab", "far", "fas", "fal", "fad",
  "dashicons", "eicons", "elementor", "elementor icons", "themify", "ti-", "icomoon", "genericons", "slick",
  "flaticon", "bootstrap-icons", "bootstrap icons", "bi-", "glyphicons", "glyphicons halflings",
  "glyphicons-halflings", "material icons", "material symbols", "materialicons", "material-icons",
  "linearicons", "simple-line-icons", "simple line icons", "ionicons", "feather", "woocommerce",
  "wpb", "revicons", "pe-icon", "pe-icon-7-stroke", "et-line", "etline", "stroke-gap", "stroke gap icons",
  "fontello", "wpforms", "icon", "icons", "revslider", "swiper", "swiper-icons", "jetpack", "wp-",
  "nicon", "divi", "etmodules", "et modules", "avada", "fusion-icons", "owl", "lightgallery", "lg",
  "fancybox", "magnific", "uikit", "foundation-icons", "typicons", "entypo", "octicons", "weather-icons",
  "socicon", "iconsmind", "line-awesome", "lineawesome", "lineicons", "boxicons", "remixicon", "tabler",
  "tabler-icons", "heroicons", "phosphor", "unicons", "zmdi", "mdi", "material design icons", "emoji",
  "vc_", "vc-", "js_composer", "jet-", "jetelements", "jet-elements", "happy-icon", "happyicon",
  "premium-addons", "powerpack", "essential-addons", "eael", "uael", "elementskit", "ekit", "mfn",
  "mfn-icons", "elegant", "eleganticons", "elegant icons", "linea", "nucleo", "fontelico", "modules",
  "star", "stars", "rating", "ratings", "mcicons", "icofont", "ico-font", "ico", "cs-icon", "x-icon",
  "ult", "ultimate-icons", "flexslider", "bxslider", "royalslider", "layerslider", "soliloquy",
  "metaslider", "smartslider", "lgicons", "lg-icons", "fw-icons", "fw", "stm", "hbicon", "tm-",
  "wpcf7", "ninja-forms", "gravity", "gforms", "learndash", "ld-icons", "bbpress", "buddypress",
  "woo", "edd", "yith", "wc-", "wcicons", "ws-icons", "wsi", "sym", "symbols", "glyph", "glyphs",
  "slider", "carousel", "arrows", "arrow", "chevron", "social", "social-icons", "socials",
  "brands", "brand-icons", "payment", "payments", "flags", "flag-icons", "icn", "ic-", "ic",
  "ui-icons", "uicons", "uil", "uim", "uis", "uit", "fi-", "fi", "la-", "la", "ri-", "ri",
  "bx", "bxs", "bxl", "iconfont", "iconic", "iconkit", "icnkit", "sl-icons", "sli", "mnm",
  "wpmenucart", "vcfa", "wpb-icons", "ninja", "quiz", "tutor", "wpml", "yoast", "rank-math",
  "tablepress", "siteorigin", "fluentform", "formidable", "contact-form", "cf7", "mailchimp",
  "mc4wp", "cookie", "gdpr", "complianz", "wp-rocket", "litespeed", "w3tc", "smush", "wordfence",
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
  const host = hostOf(url);
  if (!host) return null;
  for (const [frag, label, status, note, ignored] of SERVICES) {
    // Match the host exactly or as a subdomain, never as a substring (onlinewebfonts.com is not fonts.com).
    if (host === frag || host.endsWith("." + frag)) return { frag, label, status, note, ignored: !!ignored };
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
  ["archer", "Zilla Slab or Arvo"], ["sentinel", "Roboto Slab"], ["chronicle", "Source Serif 4"],
  ["whitney", "Figtree"], ["mercury", "Source Serif 4"], ["verlag", "Jost"], ["tungsten", "Oswald"],
  ["knockout", "Anton"], ["ideal sans", "Mulish"], ["fs albert", "Nunito"], ["fs elliot", "Inter"],
  ["fs me", "Open Sans"], ["fs lola", "Josefin Sans"], ["fs", "Nunito or Inter"],
  ["foundry sterling", "Nunito Sans"], ["foundry", "Work Sans"], ["gt ultra", "Fraunces"],
  ["gt america", "Inter"], ["gt sectra", "Fraunces"], ["neutra", "Jost"], ["interstate", "Barlow"],
  ["benton", "Libre Franklin"], ["effra", "Rubik"], ["aktiv", "Inter"], ["museo", "Nunito"],
  ["myriad", "PT Sans"], ["minion", "Crimson Pro"], ["rockwell", "Roboto Slab"],
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

// Free look-alikes are chosen by hand, not by the tool. The table above is
// kept for reference only; nothing in the UI, export or emails uses it.
function freeAlternative() {
  return "";
}

// Families known to be on Adobe Fonts (so ICL's Creative Cloud account
// already covers them: load via a kit, delete the files). Whole-word match.
const ON_ADOBE_FONTS = [
  // Hoefler&Co library (on Adobe Fonts since Monotype bought H&Co in 2021)
  "archer", "gotham", "gotham rounded", "gotham narrow", "gotham condensed", "whitney", "whitney condensed",
  "mercury", "mercury text", "mercury display", "chronicle", "chronicle text", "chronicle display",
  "sentinel", "tungsten", "knockout", "verlag", "ideal sans", "ringside", "operator", "operator mono",
  "decimal", "hoefler text", "surveyor", "vitesse", "forza", "landmark", "quarto", "inkwell", "requiem",
  "didot", "hoefler", "gotham screensmart", "chronicle screensmart", "mercury screensmart",
  "circe", "circe rounded", "circe slab", "proxima nova", "proxima soft", "proxima sera", "museo", "museo sans",
  "museo slab", "museo sans rounded", "museo cyrl", "futura pt", "futura now", "neue haas grotesk",
  "neue haas grotesk display", "neue haas grotesk text", "neue haas unica", "nexa", "nexa rust", "nexa slab",
  "brandon grotesque", "brandon text", "sofia pro", "sofia pro soft", "din 2014", "ff din", "din condensed",
  "trade gothic next", "trade gothic", "interstate", "benton sans", "benton modern", "effra", "aktiv grotesk",
  "mont", "cera pro", "cera round pro", "visby cf", "visby round cf", "gibson", "myriad pro", "minion pro",
  "garamond premier pro", "adobe garamond pro", "adobe caslon pro", "trajan pro", "bickham script pro",
  "gill sans nova", "neutraface", "neutraface 2", "neutraface text", "neutra text", "neutra display",
  "rockwell", "rockwell nova", "bodoni urw", "bodoni moda", "linotype didot", "clarendon urw",
  "freight text pro", "freight sans pro", "freight display pro", "freight big pro", "freight", "bebas neue",
  "bebas neue pro", "tt norms", "tt norms pro", "tt commons", "tt commons pro", "tt hoves", "tt hoves pro",
  "tt firs", "tt firs neue", "itc avant garde gothic", "itc avant garde gothic pro", "avant garde",
  "itc franklin gothic", "atf franklin gothic", "franklin gothic urw", "century gothic", "cooper black",
  "ff scala", "ff scala sans", "ff meta", "ff meta serif", "ff dax", "ff dax pro", "itc kabel", "neue kabel",
  "mr eaves", "mrs eaves", "mr eaves xl modern", "filosofia", "lust", "lust script", "lust display",
  "sabon", "sabon next", "eurostile", "eurostile next", "europa", "acumin", "acumin pro", "source sans",
  "source serif", "source code", "halyard", "halyard display", "halyard text", "ivy", "ivypresto",
  "ivymode", "ivyjournal", "new spirit", "obviously", "sweet sans pro", "josefin sans", "chaparral pro",
  "cronos pro", "kepler std", "warnock pro", "utopia std", "hypatia sans pro", "nunito", "recoleta",
  "recoleta alt", "campaign", "roc grotesk", "elza", "elza text", "argent cf", "quasimoda", "kaneda gothic",
  "ohno blazeface", "obviously narrow", "obviously wide", "swear", "swear display", "swear text",
  "covik sans", "degular", "degular display", "magnat", "orbikular", "neue montreal", "poppins",
  "montserrat", "raleway", "lato", "open sans", "roboto", "merriweather", "playfair display", "oswald",
  "p22 mackinac", "p22 underground", "mackinac", "ff tisa", "ff tisa sans", "ff unit", "ff kievit",
  "ff good", "ff milo", "ff real", "ff mark", "mark pro", "zeitung", "zeitung pro",
  "big caslon", "le monde", "fira sans", "fira mono", "ibm plex", "ibm plex sans", "ibm plex serif",
  "ibm plex mono", "pt sans", "pt serif", "pt sans pro", "pt serif pro", "pt root ui", "golos",
  "stem", "fact", "paratype", "scotch", "rooney", "rooney sans", "nautilus", "greycliff cf", "greycliff",
  "articulat cf", "articulat", "league gothic", "league spartan", "alternate gothic", "balboa",
  "franklin gothic", "news gothic", "news gothic std", "trade gothic lt std", "univers next"? "": "",
  "ingra", "ingra wide", "objektiv", "objektiv mk1", "objektiv mk2", "objektiv mk3", "lexia", "co text",
  "co headline", "blenny", "elido", "prenton", "scene", "vega", "vega display", "effra cc", "verb",
  "basic sans", "basic commercial", "halcom", "larken", "gloock", "rustica", "bitter",
  "merriweather sans", "classico", "classico urw", "nimbus sans", "nimbus roman", "nimbus mono",
  "franklin gothic atf", "atf poster gothic", "poster gothic atf", "sofia", "mundial", "runda",
  "gill sans", "neue frutiger"? "": "",
];
// Families known NOT to be on Adobe Fonts (exclusive to their foundry).
const NOT_ON_ADOBE_FONTS = [
  "helvetica", "helvetica neue", "helvetica now", "neue helvetica", "avenir", "avenir next", "avenir next lt pro",
  "frutiger", "univers", "optima", "palatino", "gill sans mt", "gilroy", "circular", "lineto",
  "gt walsheim", "gt ultra", "gt america", "gt sectra", "gt super", "gt alpina", "gt flexa", "gt eesti",
  "graphik", "canela", "styrene", "austin", "portrait", "marr sans", "druk", "action", "domaine",
  "financier", "calibre", "tiempos", "metric", "national", "national 2", "founders grotesk", "untitled sans",
  "signifier", "söhne", "sohne", "soehne", "suisse", "suisse intl", "apercu", "aperçu", "maison neue",
  "aeonik", "euclid", "euclid circular", "euclid flex", "px grotesk", "monument extended", "monument grotesk",
  "neue machina", "migra", "editorial new", "object sans", "sharp grotesk",
  "sharp sans", "basis grotesque", "foundry sterling", "foundry gridnik", "foundry monoline",
  "fs albert", "fs elliot", "fs me", "fs lola", "fs dillon", "fs industrie", "fs emeric", "fs siena",
  "fs kim", "fs matthew", "fs rufus", "fs sinclair", "fs koopman", "fs clerkenwell", "fs jack", "fs joey",
  "fs lucas", "fs millbank", "fs olivia", "fs pimlico", "fs rome", "fs sally", "fs truman", "fs untitled",
  "fs brabo", "fs benjamin", "fs split", "fs renaissance", "larsseit", "formular", "halvar", "value sans",
  "neue plak", "sf pro", "sf pro display", "sf pro text", "san francisco", "segoe ui", "segoe",
  "times new roman", "arial", "verdana", "tahoma", "trebuchet ms", "georgia", "calibri", "cambria",
  "candara", "consolas", "constantia", "corbel", "lucida grande", "lucida sans", "book antiqua",
  "comic sans", "impact", "harmonia sans", "neo sans", "trebuchet", "bw modelica", "modelica", "bw gradual",
  "bw nista", "intro", "intro rust", "campton", "biennale", "ambit", "cocogoose", "silka", "messina",
  "messina sans", "general grotesque", "visuelt", "beausite", "monotype grotesque", "din next", "din pro",
  "neue haas grotesk"? "": "",
];
for (const _l of [ON_ADOBE_FONTS, NOT_ON_ADOBE_FONTS]) {
  for (let i = _l.length - 1; i >= 0; i--) if (!_l[i]) _l.splice(i, 1);
}

export function adobeFontsStatus(fam) {
  const f = norm(fam);
  if (!f) return "unknown";
  // Longest match wins so "gill sans nova" (yes) beats "gill sans" rules.
  // Also match names written without spaces (ProximaNova-Regular), for entries long enough to be unambiguous.
  const sq = (x) => norm(x).replace(/ /g, "");
  const hit = (e) => hasWords(f, e) || (sq(e).length >= 7 && sq(f).includes(sq(e)));
  const yes = ON_ADOBE_FONTS.filter(hit).sort((a, b) => b.length - a.length)[0] || "";
  const no = NOT_ON_ADOBE_FONTS.filter(hit).sort((a, b) => b.length - a.length)[0] || "";
  if (yes && (!no || yes.length >= no.length)) return "yes";
  if (no) return "no";
  return "unknown";
}

const adobeLiveCache = new Map();
// Live check: fonts.adobe.com/fonts/<slug> exists for every family on Adobe Fonts.
// Returns "yes" | "no" | "" (could not tell). Cached per process.
export async function adobeFontsLive(fam) {
  const slug = norm(fam).replace(/ /g, "-");
  if (!slug) return "";
  if (adobeLiveCache.has(slug)) return adobeLiveCache.get(slug);
  let out = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://fonts.adobe.com/fonts/${slug}`, {
      headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: ctrl.signal, cache: "no-store",
    });
    clearTimeout(t);
    if (r.status === 404) out = "no";
    else if (r.status === 200) {
      const html = (await r.text()).slice(0, 200_000).toLowerCase();
      const name = norm(fam);
      if (html.includes(`/fonts/${slug}`) && (html.includes(`<title>${name}`) || html.includes(`"slug":"${slug}"`) || html.includes(`${name} |`) || html.includes(`${name} font`))) out = "yes";
    }
  } catch {}
  adobeLiveCache.set(slug, out);
  return out;
}

// Fonts whose makers give away some weights, or whose exact design exists
// under a free licence, plus metric-identical open drop-ins for system fonts.
// [whole-word family match, description, link]
const FREE_VERSIONS = [
  // Only the SAME font: free weights from the original maker, the same design
  // released under a free licence, or a metric-identical clone of a system font.
  // Look-alikes, revivals and "similar" fonts are never suggested.
  ["museo sans", "Museo Sans 500 and 500 Italic are free from exljbris (other weights are paid). Only a free fix if the site uses just those weights.", "https://www.exljbris.com/museosans.html"],
  ["museo slab", "Museo Slab 500 is free from exljbris (other weights are paid). Only a free fix if the site uses just that weight.", "https://www.exljbris.com/museoslab.html"],
  ["museo", "Museo 300, 500 and 700 are free from exljbris (other weights are paid). Only a free fix if the site uses just those weights.", "https://www.exljbris.com/museo.html"],
  ["nexa", "Nexa Light and Nexa Bold are free from Fontfabric (other weights are paid). Only a free fix if the site uses just those weights.", "https://www.fontfabric.com/fonts/nexa/"],
  ["gilroy", "Gilroy Light and ExtraBold are free from the designer (other weights are paid). Only a free fix if the site uses just those weights.", "https://www.tinkov.info/gilroy.html"],
  ["mont", "Mont ExtraLight and Heavy are free from Fontfabric (other weights are paid). Only a free fix if the site uses just those weights.", "https://www.fontfabric.com/fonts/mont/"],
  ["bebas neue", "Bebas Neue (original) is free under the SIL Open Font License and on Google Fonts.", "https://fonts.google.com/specimen/Bebas+Neue"],
  ["league gothic", "League Gothic is free and on Google Fonts.", "https://fonts.google.com/specimen/League+Gothic"],
  ["league spartan", "League Spartan is free and on Google Fonts.", "https://fonts.google.com/specimen/League+Spartan"],
  ["aller", "Aller is free for commercial use from Dalton Maag.", "https://www.fontsquirrel.com/fonts/aller"],
  ["metropolis", "Metropolis is free (Unlicense).", "https://github.com/chrismsimpson/Metropolis"],
  ["hk grotesk", "HK Grotesk (non-Pro) is free under the SIL Open Font License; the Pro version is paid.", "https://hanken.co/products/hk-grotesk"],
  // Metric-identical clones of system fonts: same letter widths, near-identical look.
  ["times new roman", "Tinos is a metric-identical open-source clone of Times New Roman: a drop-in swap.", "https://fonts.google.com/specimen/Tinos"],
  ["arial", "Arimo is a metric-identical open-source clone of Arial: a drop-in swap.", "https://fonts.google.com/specimen/Arimo"],
  ["courier new", "Cousine is a metric-identical open-source clone of Courier New: a drop-in swap.", "https://fonts.google.com/specimen/Cousine"],
  ["calibri", "Carlito is a metric-identical open-source clone of Calibri: a drop-in swap.", "https://fonts.google.com/specimen/Carlito"],
  ["cambria", "Caladea is a metric-identical open-source clone of Cambria: a drop-in swap.", "https://fonts.google.com/specimen/Caladea"],
];

export function freeVersionFor(fam) {
  const f = norm(fam);
  if (!f) return null;
  const hits = FREE_VERSIONS.filter(([k]) => hasWords(f, k)).sort((a, b) => b[0].length - a[0].length);
  if (!hits.length) return null;
  const [, note, url] = hits[0];
  return { note, url, isFree: true };
}

const googleLiveCache = new Map();
// Live check: fonts.googleapis.com answers 200 for a real family, 400 otherwise.
export async function googleFontsLive(fam) {
  const name = String(fam || "").replace(/[-_]/g, " ").replace(/\b(regular|bold|light|medium|italic|black|thin|book|semibold|extrabold|heavy|pro|std|lt|mt|web|webfont)\b/gi, "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  const key = name.toLowerCase();
  if (googleLiveCache.has(key)) return googleLiveCache.get(key);
  let out = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}`, {
      headers: { "user-agent": UA }, signal: ctrl.signal, cache: "no-store",
    });
    clearTimeout(t);
    if (r.status === 200) out = "yes";
    else if (r.status === 400 || r.status === 404) out = "no";
  } catch {}
  googleLiveCache.set(key, out);
  return out;
}

export function googleFontsSearchUrl(fam) {
  const q = String(fam || "").replace(/[-_]/g, " ").replace(/\b(regular|bold|light|medium|italic|black|thin|book|semibold|extrabold|heavy|pro|std|lt|mt|web|webfont)\b/gi, "").replace(/\s+/g, " ").trim();
  return "https://fonts.google.com/?query=" + encodeURIComponent(q);
}
export function fontSquirrelSearchUrl(fam) {
  const q = String(fam || "").replace(/[-_]/g, " ").replace(/\b(regular|bold|light|medium|italic|black|thin|book|semibold|extrabold|heavy|pro|std|lt|mt|web|webfont)\b/gi, "").replace(/\s+/g, " ").trim();
  return "https://www.fontsquirrel.com/fonts/list/find_fonts?q%5Bterm%5D=" + encodeURIComponent(q) + "&q%5Bsearch_check%5D=Y";
}

export function adobeFontsSearchUrl(fam) {
  const q = String(fam || "").replace(/[-_]/g, " ").replace(/\b(regular|bold|light|medium|italic|black|thin|book|semibold|extrabold|heavy|pro|std|lt|mt|web|webfont)\b/gi, "").replace(/\s+/g, " ").trim();
  return "https://fonts.adobe.com/search?query=" + encodeURIComponent(q);
}

// One-line version of the fix, for card titles and summaries.
export function shortFix(f) {
  if (!f || f.status === OK) return "";
  const fam = f.family || "";
  if (/font awesome/i.test(fam) && /pro/i.test(f.note || fam)) return "confirm Font Awesome Pro licence";
  if (f.kind === "Embedded (data URI)") return "identify embedded font";
  if (f.kind === "Hosted service") return f.status === PROBLEM ? "replace (service closed)" : "confirm subscription";
  if (/demo/i.test(f.note || "")) return "demo font: licence or swap";
  if (/no licence info|base64/i.test(f.note || "")) return "find where the font came from";
  if (f.status === PROBLEM) {
    if (f.adobe === "yes") return "move to Adobe Fonts kit";
    if (f.google === "yes") return "load from Google Fonts";
    if (f.freeVersion?.isFree) return "free version available";
    if (f.adobe === "no") return "no free route: licence or swap";
    return "check free routes, else licence or swap";
  }
  return "find where the font came from";
}

function fixFor(kind, fam, adobeOverride, freeRoute) {
  switch (kind) {
    case "adobe-selfhosted":
      return "Embed it via an Adobe Fonts kit (add to a web project, paste the kit <link>, point the CSS at it) and delete the font files from the server.";
    case "commercial-selfhosted": {
      const a = adobeOverride || adobeFontsStatus(fam);
      if (a === "yes") return "Embed it via an Adobe Fonts kit (add to a web project, paste the kit <link>, point the CSS at it) and delete the font files from the server.";
      if (freeRoute?.google === "yes") return "This family is on Google Fonts: load it from there (free) and delete the font files from the server.";
      if (freeRoute?.freeVersion?.isFree) return `Free route: ${freeRoute.freeVersion.note} Then delete the paid files from the server.`;
      if (a === "no") return "Buy a web licence for this domain, or swap it for a free font chosen by hand.";
      return "Check the Adobe / Google / Font Squirrel links. If found, embed from there and delete the files. If not, buy a web licence or swap it for a free font chosen by hand.";
    }
    case "demo":
      return "Demo fonts cannot be used commercially. Buy the full web licence for this domain, or swap it for a free font chosen by hand.";
    case "fa-kit":
      return "Open the kit at fontawesome.com. Free kit: no action. Pro icons: confirm an active Pro licence covers this domain.";
    case "commercial-service":
      return "Log in to the service and confirm the subscription is active and this domain is registered. If lapsed, move to Adobe Fonts or Google Fonts.";
    case "data-uri":
      return "Identify the family from the CSS font-family name and check it by hand.";
    case "unknown-file":
      return "Find out where the file came from (theme, page builder, previous developer). Google font: no action. Commercial: licence it or swap it.";
    case "fontdeck":
      return "Fontdeck closed in 2017. Replace with Google Fonts or Adobe Fonts.";
    default:
      return "No action needed.";
  }
}

// "FoundrySterling-BookItalic" -> "foundry sterling" : strip style/weight words so
// styles of one family collapse into one row.
const STYLE_WORDS = /\b(regular|roman|normal|bold|semibold|demibold|extrabold|ultrabold|black|heavy|light|extralight|ultralight|thin|hairline|fine|median|standard|medium|book|italic|oblique|condensed|cond|narrow|wide|extended|web|webfont|std|lt|mt|it|bd|rg|\d{3})\b/g;
export function familyKey(name) {
  return String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(STYLE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function prettyFamily(name) {
  const key = familyKey(name);
  if (!key) return String(name || "");
  return key.split(" ").map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

// Normalise a name for word-level matching: lower-case, punctuation -> spaces.
function norm(x) {
  return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
// True when `entry` appears as whole word(s) inside `text`.
function hasWords(text, entry) {
  const t = " " + norm(text) + " ";
  const e = norm(entry);
  return e.length > 0 && t.includes(" " + e + " ");
}
function findWords(list, text) {
  return list.find((entry) => hasWords(text, entry)) || "";
}

// Font Awesome Pro is a paid product: not ignorable, needs a licence check.
function isFontAwesomePro(family, url) {
  const t = norm(family) + " " + norm(url);
  if (!/(^| )(fontawesome|font awesome|fa)( |$)/.test(t) && !/fa (light|thin|duotone|sharp|regular|solid|brands)/.test(t)) return false;
  return / pro( |$)/.test(t) || / (light|thin|duotone|sharp)( |$)/.test(t) || /fa (light|thin|duotone|sharp) \d/.test(t);
}

function ignoredFontName(family, url) {
  if (isFontAwesomePro(family, url)) return "";
  let path = "";
  try { path = decodeURIComponent(new URL(url).pathname); } catch { path = String(url || ""); }
  // Only the file name and its parent folder count, not the whole URL.
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-2).join(" ");
  return findWords(IGNORED_FAMILIES, family) || findWords(IGNORED_FAMILIES, tail) || "";
}

function classifyFileFont(url, familyCss, meta, adobeOverride, freeRoute) {
  const e = ext(url);
  const fam = meta.family || familyCss || "";
  const famBoth = fam + " " + (familyCss || "");
  const strings = ["copyright", "trademark", "manufacturer", "designer", "licence", "licenceUrl", "vendorUrl", "vendorId"]
    .map((k) => String(meta[k] || ""))
    .join(" ")
    .toLowerCase();
  const raw = e === ".otf" || e === ".ttf";

  const free = FREE_LICENCE_PATTERNS.some((p) => p.test(strings));
  const foundry = COMMERCIAL_FOUNDRIES.find((f) => strings.includes(f));
  const commFamily = findWords(COMMERCIAL_FAMILIES, famBoth);
  const freeFamily = findWords(FREE_FAMILIES, famBoth);

  // Demo / trial / personal-use cuts are never licensed for a commercial website.
  const demoText = (famBoth + " " + strings + " " + url).toLowerCase();
  if (/\bdemo\b|\btrial\b|personal[\s-]use|for personal|non[\s-]?commercial|not for commercial/.test(demoText) &&
      !/personal and commercial use/.test(demoText)) {
    return [PROBLEM, "Demo / personal-use version of a font, not licensed for commercial websites.", false, fixFor("demo", fam)];
  }
  if (isFontAwesomePro(famBoth, url)) {
    return [PROBLEM, "Font Awesome Pro (paid) self-hosted.", false,
      "Log in at fontawesome.com and confirm ICL (or the client) has an active Pro licence. If not, switch to Font Awesome Free, which has the same icons for most uses."];
  }
  const ignoredBy = ignoredFontName(famBoth, url);
  if (ignoredBy && !foundry) {
    return [OK, `Icon / UI font ('${ignoredBy}'). Free, no licence check needed.`, true, "No action needed."];
  }
  if (free) return [OK, "Font file carries an open licence (OFL / Apache / MIT / GPL / free font licence).", false, "No action needed."];
  if (freeFamily && !commFamily) return [OK, `Known free/open font ('${freeFamily}').`, false, "No action needed."];

  const rawTxt = raw ? " Raw .otf/.ttf file." : "";
  if (strings.includes("typekit") || strings.includes("adobe fonts") || strings.includes("adobe systems") || strings.includes("adobe inc")) {
    return [PROBLEM, "Adobe font installed as files instead of via a kit." + rawTxt, false, fixFor("adobe-selfhosted", fam)];
  }
  if (foundry || commFamily) {
    const a = adobeOverride || adobeFontsStatus(fam);
    const who = meta.manufacturer ? ` (${String(meta.manufacturer).replace(/\b(ltd|limited|inc|incorporated|llc|gmbh)\b\.?/gi, "").replace(/[\s.,]+$/g, "").trim()})` : "";
    const why = a === "yes"
      ? "Paid font installed on our server; on Adobe Fonts."
      : `Paid font${who} installed on our server, no web licence found.${rawTxt}`;
    return [PROBLEM, why, false, fixFor("commercial-selfhosted", fam, adobeOverride, freeRoute)];
  }
  if (meta.error || !Object.keys(meta).length) {
    return [PROBLEM, raw
      ? "Unreadable raw .otf/.ttf file on our server, no licence info."
      : "Font file could not be read, no licence info.", false, fixFor("unknown-file", fam)];
  }
  if (raw) return [PROBLEM, "Raw .otf/.ttf on our server, no licence info, origin unknown.", false, fixFor("unknown-file", fam)];
  return [PROBLEM, "Unrecognised font on our server, no licence info.", false, fixFor("unknown-file", fam)];
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
// Every image URL referenced on a page: <img src/srcset/data-*>, <source>, inline background-image.
export function pageImageUrls($, pageUrl) {
  const out = [];
  const push = (v) => {
    if (!v || v.startsWith("data:")) return;
    const u = abs(pageUrl, v.trim());
    if (u) out.push(u);
  };
  for (const el of $("img, source").toArray()) {
    const t = $(el);
    for (const a of ["src", "data-src", "data-lazy-src", "data-original", "data-bg", "data-background"]) push(t.attr(a));
    for (const a of ["srcset", "data-srcset", "data-lazy-srcset"]) {
      const v = t.attr(a);
      if (v) for (const part of v.split(",")) push(part.trim().split(/\s+/)[0]);
    }
  }
  for (const el of $("[style]").toArray()) {
    for (const m of ($(el).attr("style") || "").matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) push(m[1]);
  }
  for (const m of $.html().matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp|gif|avif))['"]?\s*\)/gi)) push(m[1]);
  return out;
}

// Flag stock-library images by file name, then read embedded credit/copyright
// tags from a bounded number of the unflagged ones.
export async function analyseImages(get, imgUrls, { metaLimit = MAX_IMAGES } = {}) {
  const imgs = [];
  const seenImg = new Set();
  for (const item of imgUrls) {
    const u = typeof item === "string" ? item : item.url;
    const page = typeof item === "string" ? "" : item.page || "";
    const clean = u.split("?")[0];
    if (seenImg.has(clean) || !IMG_EXT.some((x) => clean.toLowerCase().endsWith(x))) continue;
    seenImg.add(clean);
    let name = "";
    try { name = decodeURIComponent(new URL(clean).pathname.split("/").pop()).toLowerCase(); } catch { name = clean.toLowerCase(); }
    const hit = STOCK_IMAGE_PATTERNS.find(([p]) => p.test(name));
    imgs.push({ url: u, page, flag: hit ? hit[1] : "", meta: "" });
  }
  const toCheck = imgs.filter((i) => /\.(jpe?g|png|webp)$/i.test(i.url.split("?")[0])).slice(0, metaLimit);
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
  return imgs;
}

const MAX_SITE_PAGES = 500;
const SKIP_PAGE_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json|ico|woff2?|ttf|otf)(\?|$)|\/wp-json\/|\/feed\/?$|\/wp-admin|\/wp-login|\/cart|\/checkout|\/my-account|\/tag\/|\/page\/\d|\?(s|replytocom|add-to-cart)=/i;

function isCrawlablePage(u, host) {
  if (!u || hostOf(u) !== host) return false;
  if (SKIP_PAGE_RE.test(u)) return false;
  return /^https?:/.test(u);
}

// Page list from the site's sitemap(s). Empty array when there is none.
export async function discoverSitemapPages(get, home, host) {
  const roots = [];
  const robots = await get(abs(home, "/robots.txt"));
  if (robots.status && robots.status < 400) {
    for (const m of robots.body.toString("utf8").matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.push(m[1].trim());
  }
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml", "/page-sitemap.xml"]) {
    const u = abs(home, p);
    if (u && !roots.includes(u)) roots.push(u);
  }
  const pages = new Set();
  const seenMaps = new Set();
  const queue = [...roots];
  let fetched = 0;
  while (queue.length && fetched < 25 && pages.size < MAX_SITE_PAGES) {
    const u = queue.shift();
    if (seenMaps.has(u)) continue;
    seenMaps.add(u);
    const r = await get(u, 4_000_000);
    fetched++;
    if (!r.status || r.status >= 400 || !r.body.length) continue;
    const xml = r.body.toString("utf8");
    if (!/<(urlset|sitemapindex)/i.test(xml)) continue;
    const isIndex = /<sitemapindex/i.test(xml);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = m[1].replace(/&amp;/g, "&");
      if (isIndex) {
        if (!/image|video|news|attachment|media|product_cat|category|tag|author/i.test(loc)) queue.push(loc);
      } else if (isCrawlablePage(loc, host)) {
        pages.add(loc.split("#")[0]);
        if (pages.size >= MAX_SITE_PAGES) break;
      }
    }
  }
  return [...pages];
}

// Fetch a batch of pages and return the images found on them (flagged ones
// only), plus same-site links for crawling sites without a sitemap. Stops at
// the deadline and hands back the pages it did not get to.
export async function sweepPages(site, urls, { deadlineMs = 40_000 } = {}) {
  const get = makeFetcher();
  const started = Date.now();
  const bare = normaliseSite(site);
  const host = bare.replace(/^www\./, "").split("/")[0];
  const done = [];
  const remaining = [];
  const imgUrls = [];
  const links = new Set();
  const queue = [...urls];

  async function worker() {
    while (queue.length) {
      if (Date.now() - started > deadlineMs) { remaining.push(...queue.splice(0)); return; }
      const u = queue.shift();
      const r = await get(u, 3_000_000);
      done.push(u);
      if (!r.status || r.status >= 400 || !r.type.includes("html")) continue;
      const $ = cheerio.load(r.body.toString("utf8"));
      imgUrls.push(...pageImageUrls($, r.url).map((url) => ({ url, page: r.url })));
      for (const a of $("a[href]").toArray()) {
        const l = abs(r.url, $(a).attr("href"))?.split("#")[0];
        if (l && isCrawlablePage(l, host)) links.add(l);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const imgs = await analyseImages(get, imgUrls, { metaLimit: 30 });
  return {
    done, remaining,
    images: imgs.filter((i) => i.flag || i.meta),
    imagesChecked: imgs.length,
    links: [...links].slice(0, MAX_SITE_PAGES),
    seconds: Math.round((Date.now() - started) / 10) / 100,
  };
}

export async function scanSite(site, { pages = 4, mode = "both" } = {}) {
  const doFonts = mode !== "images";
  const doImages = mode !== "fonts";
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
  // Full page list for the image sweep: sitemap first, else links from the homepage.
  const sitemapPages = doImages ? await discoverSitemapPages(get, home, host) : [];
  const homeLinks = [];
  for (const a of $home("a[href]").toArray()) {
    const l = abs(home, $home(a).attr("href"))?.split("#")[0];
    if (l && isCrawlablePage(l, host)) homeLinks.push(l);
  }
  rec.hasSitemap = sitemapPages.length > 0;
  const scanned = new Set(rec.pages.map((p) => p.replace(/\/$/, "")));
  rec.pageQueue = !doImages ? [] : [...new Set((sitemapPages.length ? sitemapPages : homeLinks).map((p) => p.split("#")[0]))]
    .filter((p) => !scanned.has(p.replace(/\/$/, "")))
    .slice(0, MAX_SITE_PAGES);
  rec.pagesTotal = rec.pages.length + rec.pageQueue.length;
  rec.pagesScanned = rec.pages.length;

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
      const realFontExt = [".woff2", ".woff", ".ttf", ".otf"].some((x) => clean.endsWith(x));
      if (el.tagName === "link" && (asAttr === "font" || (rel.includes("preload") && realFontExt)) && !svc) {
        const fr = addFont("file:" + u.split("?")[0], { kind: "Font file", family: "(preload)", source: u, status: CHECK, note: "", css: "" });
        if (!fr.foundOn.includes(pageUrl)) fr.foundOn.push(pageUrl);
      }
    }
    for (const st of $("style").toArray()) inlineCss.push([pageUrl, $(st).text()]);
    imgUrls.push(...pageImageUrls($, pageUrl).map((url) => ({ url, page: pageUrl })));
  }

  // --- CSS
  if (!doFonts) {
    rec.images = await analyseImages(get, imgUrls).then((imgs) => { rec.imagesChecked = imgs.length; return imgs.filter((i) => i.flag || i.meta); });
    rec.fonts = []; rec.ignoredFonts = []; rec.status = SYSTEM;
    return rec;
  }
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
        const ign = ignoredFontName(face.family, base);
        if (ign) {
          const fr = addFont("data:" + face.family, { kind: "Embedded (data URI)", family: face.family, source: base, status: OK, css: base,
            note: `Icon / UI font ('${ign}'). Free, no licence check needed.`, fix: "No action needed.", ignored: true });
          if (!fr.foundOn.includes(foundOn)) fr.foundOn.push(foundOn);
          continue;
        }
        const fr = addFont("data:" + face.family, {
          kind: "Embedded (data URI)", family: face.family, source: base, status: PROBLEM, css: base,
          note: "Font embedded in CSS as base64, licence unreadable.",
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

  // 1) Icon / UI fonts are recognised from the family name or file path
  //    before anything is downloaded, whatever the file format.
  for (const k of fileKeys) {
    const v = fonts.get(k);
    if (isFontAwesomePro(v.family, v.source)) continue;
    const by = ignoredFontName(v.family, v.source);
    if (by) {
      v.status = OK;
      v.note = `Icon / UI font ('${by}'). Free, no licence check needed.`;
      v.fix = "No action needed.";
      v.ignored = true;
    }
  }

  // 2) One row per family. Several weights and formats of the same family
  //    share one verdict, so keep the best file to inspect (woff2 > woff >
  //    ttf > otf > eot/svg) and fold the others into it.
  const PREF = { ".woff2": 0, ".woff": 1, ".ttf": 2, ".otf": 3, ".eot": 8, ".svg": 9 };
  const byFamily = new Map();
  for (const k of fileKeys) {
    const v = fonts.get(k);
    if (v.ignored) continue;
    const famKey = familyKey(v.family) || norm(v.family) || k;
    const cur = byFamily.get(famKey);
    if (!cur || (PREF[ext(v.source)] ?? 5) < (PREF[ext(cur.source)] ?? 5)) {
      if (cur) { cur.merged = (cur.merged || []).concat(cur.source); fonts.delete(cur.key); v.merged = (v.merged || []).concat(cur.merged || []); }
      v.key = k;
      byFamily.set(famKey, v);
    } else {
      cur.merged = (cur.merged || []).concat(v.source);
      fonts.delete(k);
    }
  }
  const live = [...byFamily.values()];
  for (const v of live) {
    v.otherFiles = (v.merged || []).length;
    delete v.merged;
  }

  // 3) Download one file per family and read its metadata. Legacy-only
  //    families (eot/svg) are classified by name.
  const chosen = live.filter((v) => ![".eot", ".svg"].includes(ext(v.source))).slice(0, MAX_FONT_FILES);
  await Promise.all(chosen.map(async (v) => {
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
    if (v.status === PROBLEM) {
      const famName = v.meta.family || v.family;
      v.adobe = adobeFontsStatus(famName);
      v.adobeSearch = adobeFontsSearchUrl(famName);
      if (v.adobe !== "yes") {
        const live = await adobeFontsLive(famName);
        if (live === "yes") v.adobe = "yes";
        else if (live === "no" && v.adobe === "unknown") v.adobe = "no";
      }
      v.google = v.adobe === "yes" ? "" : await googleFontsLive(famName);
      v.googleSearch = googleFontsSearchUrl(famName);
      v.squirrelSearch = fontSquirrelSearchUrl(famName);
      v.freeVersion = freeVersionFor(famName);
      v.freeRoute = v.adobe === "yes" ? "adobe" : v.google === "yes" ? "google" : v.freeVersion?.isFree ? "free-version" : "none";
      [v.status, v.note, v.ignored, v.fix] = classifyFileFont(r.url, v.family, v.meta, v.adobe, { google: v.google, freeVersion: v.freeVersion });
    }
    if (v.meta.family && !isFontAwesomePro(v.family, r.url)) { v.cssFamily = v.family; v.family = v.meta.family; }
    if (v.family === "(preload)") {
      v.family = v.meta.family || (() => { try { return new URL(r.url).pathname.split("/").pop(); } catch { return r.url; } })();
    }
  }));
  for (const v of live) {
    if (chosen.includes(v)) continue;
    const srcHost = hostOf(v.source);
    v.hostedOn = srcHost === host || srcHost.endsWith("." + host) ? "own server" : srcHost;
    if ([".eot", ".svg"].includes(ext(v.source))) {
      [v.status, v.note, v.ignored, v.fix] = classifyFileFont(v.source, v.family, {});
      if (v.status === PROBLEM) {
        v.adobe = adobeFontsStatus(v.family); v.adobeSearch = adobeFontsSearchUrl(v.family);
        v.googleSearch = googleFontsSearchUrl(v.family); v.squirrelSearch = fontSquirrelSearchUrl(v.family);
        v.freeVersion = freeVersionFor(v.family);
        v.freeRoute = v.adobe === "yes" ? "adobe" : v.freeVersion?.isFree ? "free-version" : "none";
        [v.status, v.note, v.ignored, v.fix] = classifyFileFont(v.source, v.family, {}, v.adobe, { google: "", freeVersion: v.freeVersion });
      }
    } else {
      v.status = CHECK;
      v.note = "Not downloaded (site has an unusually large number of font families).";
      v.fix = "Press Re-scan with Pages per site set to 1, or check this family by hand.";
    }
  }

  // 4) Merge rows that turned out to be the same family once the file was read.
  {
    const seen = new Map();
    for (const [k, v] of [...fonts.entries()]) {
      if (v.kind !== "Font file" || v.ignored || isFontAwesomePro(v.cssFamily || v.family, v.source)) continue;
      const key = familyKey(v.family) || norm(v.family);
      if (!key) continue;
      const first = seen.get(key);
      if (!first) { seen.set(key, v); continue; }
      first.otherFiles = (first.otherFiles || 0) + 1 + (v.otherFiles || 0);
      if (RANK[v.status] > RANK[first.status]) { first.status = v.status; first.note = v.note; first.fix = v.fix; first.adobe = v.adobe; first.adobeSearch = v.adobeSearch; }
      for (const p of v.foundOn || []) if (!first.foundOn.includes(p)) first.foundOn.push(p);
      fonts.delete(k);
    }
  }

  // --- Images on the pages scanned so far
  const imgs = doImages ? await analyseImages(get, imgUrls) : [];
  rec.images = imgs.filter((i) => i.flag || i.meta);
  rec.imagesChecked = imgs.length;

  for (const v of fonts.values()) {
    if (v.kind !== "Font file" || v.ignored) continue;
    const pretty = prettyFamily(v.family);
    if (pretty && pretty.toLowerCase() !== v.family.toLowerCase()) { v.cssFamily = v.cssFamily || v.family; v.family = pretty; }
  }
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
