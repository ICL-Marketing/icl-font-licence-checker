// Accessibility checks on Figma designs, before anything is coded.
// Reads the file through Figma's REST API (FIGMA_TOKEN, a personal access
// token) and checks each top-level frame (screen) for the things that can be
// judged from a design: colour contrast, text size, line height, tap target
// line height, link wording, and the licences of the fonts used.

const API = process.env.FIGMA_API_BASE || "https://api.figma.com/v1";
const TOKEN = () => process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN || "";
export const figmaConfigured = () => Boolean(TOKEN());

// File key and optional node id from any Figma link (design, file, proto, branch).
export function parseFigmaLink(link) {
  let u;
  try { u = new URL(String(link || "").trim()); } catch { return null; }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!m) return null;
  const nodeId = (u.searchParams.get("node-id") || "").replace(/-/g, ":");
  return { fileKey: m[2] || m[1], nodeId };
}

// Layers inside component instances have ids like "I10502:21240;10502:21066;14584:14999"
// and Figma cannot deep-link to them, so the link selects the instance itself (the first
// id in the chain) and the layer name says where to look inside it.
export const nodeLink = (fileKey, id) => {
  let n = String(id);
  if (n.startsWith("I")) n = n.slice(1).split(";")[0];
  return `https://www.figma.com/design/${fileKey}/?node-id=${encodeURIComponent(n.replace(/:/g, "-"))}`;
};

async function api(path) {
  const r = await fetch(`${API}${path}`, { headers: { "X-Figma-Token": TOKEN() }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("Figma refused the token. Check FIGMA_TOKEN has file read access and that the file is shared with the token's account.");
  if (r.status === 404) throw new Error("Figma file not found. Check the link and that the token's account can open it.");
  if (r.status === 429) throw new Error("Figma rate limit reached. Try again in a minute.");
  if (!r.ok) throw new Error(j.err || j.message || `Figma error ${r.status}`);
  return j;
}

// Screens to check: top-level frames on every page (or inside the linked node).
export async function listFrames(fileKey, nodeId) {
  if (nodeId) {
    const j = await api(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=2`);
    const doc = j.nodes?.[nodeId]?.document;
    if (!doc) throw new Error("That frame was not found in the file.");
    const frames = doc.type === "CANVAS" ? (doc.children || []).filter(isScreen) : [doc];
    return { name: j.name || "", lastModified: j.lastModified || "", version: j.version || "", frames: frames.map((f) => ({ id: f.id, name: f.name, page: doc.type === "CANVAS" ? doc.name : "" })) };
  }
  const j = await api(`/files/${fileKey}?depth=2`);
  const out = [];
  for (const page of j.document?.children || []) {
    for (const f of page.children || []) if (isScreen(f)) out.push({ id: f.id, name: f.name, page: page.name });
  }
  return { name: j.name || "", lastModified: j.lastModified || "", version: j.version || "", frames: out };
}
const isScreen = (n) => ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"].includes(n.type) && n.visible !== false;

// Full trees for a few frames at once.
export async function fetchFrames(fileKey, ids) {
  const j = await api(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(","))}`);
  return ids.map((id) => j.nodes?.[id]?.document).filter(Boolean);
}

// ---- colour maths (WCAG 2.x relative luminance and contrast ratio) ----
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
// Lay a colour with alpha over a background.
const over = ([r, g, b], a, bg) => [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];

// First visible solid fill of a node as {rgb, alpha}; null for none, "other" for gradients/images.
function solidFill(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const vis = fills.filter((f) => f.visible !== false && (f.opacity ?? 1) > 0);
  if (!vis.length) return null;
  const top = vis[vis.length - 1];
  if (top.type !== "SOLID") return "other";
  const a = (top.color?.a ?? 1) * (top.opacity ?? 1) * (node.opacity ?? 1);
  return { rgb: [top.color.r, top.color.g, top.color.b], alpha: a };
}

const box = (n) => n.absoluteBoundingBox || n.absoluteRenderBounds || null;
const contains = (outer, inner) => outer && inner && inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

// What is behind a text node: walk up through ancestors; at each level,
// earlier siblings (drawn underneath) that cover the text count before the
// ancestor's own fill. Returns {rgb} composited, or {other: true} if a
// gradient/image is involved, or null if nothing solid was found.
function backgroundFor(path, textBox) {
  let layers = []; // from top-most to bottom-most
  for (let i = path.length - 1; i >= 0; i--) {
    const { node, siblingsBelow } = path[i];
    for (let s = siblingsBelow.length - 1; s >= 0; s--) {
      const sib = siblingsBelow[s];
      if (sib.visible === false) continue;
      const fill = solidFill(sib);
      if (!fill) continue;
      if (!contains(box(sib), textBox)) continue;
      if (fill === "other") return { other: true };
      layers.push(fill);
      if (fill.alpha >= 0.99) return composite(layers);
    }
    const own = solidFill(node);
    if (own) {
      if (own === "other") return { other: true };
      layers.push(own);
      if (own.alpha >= 0.99) return composite(layers);
    }
  }
  return layers.length ? composite(layers, true) : null;
}
function composite(layers, onWhite = false) {
  let bg = onWhite || true ? [1, 1, 1] : [1, 1, 1];
  for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i].rgb, layers[i].alpha, bg);
  return { rgb: bg };
}

const VAGUE_LINK = /^\s*(click here|here|read more|learn more|more|link|see more|view more|find out more|details|go)\s*[>→»]*\s*$/i;

// Check one screen. Returns findings and the fonts it uses.
export function checkFrame(frame, fileKey) {
  const findings = [];
  const fonts = new Map(); // family -> Set(style)
  let texts = 0;

  const add = (f) => findings.push({ ...f, text: `${f.node}${f.detail ? ` (${f.detail})` : ""}: ${f.rule}` });
  // (findings carry nodeId so done/ignored marks stay per layer even when several share one instance link)
  const link = (n) => nodeLink(fileKey, n.id);
  const label = (n) => (n.type === "TEXT" ? `“${String(n.characters || "").replace(/\s+/g, " ").trim().slice(0, 60)}${(n.characters || "").length > 60 ? "…" : ""}”` : n.name);

  function walk(node, path) {
    if (node.visible === false) return;
    const b = box(node);
    // (Tap target size is checked on the built site, not the design.)
    if (node.type === "TEXT" && b && String(node.characters || "").trim()) {
      texts++;
      const st = node.style || {};
      const size = Number(st.fontSize) || 0;
      const weight = Number(st.fontWeight) || 400;
      const chars = String(node.characters || "");
      const fam = st.fontFamily || "";
      if (fam) { if (!fonts.has(fam)) fonts.set(fam, new Set()); fonts.get(fam).add(st.fontPostScriptName || `${weight}${st.italic ? " italic" : ""}`); }
      // Contrast.
      const fill = solidFill(node);
      if (fill && fill !== "other") {
        const bg = backgroundFor(path, b);
        if (bg && !bg.other) {
          const fg = over(fill.rgb, fill.alpha, bg.rgb);
          const ratio = contrastRatio(fg, bg.rgb);
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          if (ratio < need) add({ id: "contrast", level: "fail", rule: `Text contrast must be at least ${need}:1 for ${large ? "large" : "normal"} text.`, node: label(node), detail: `${ratio.toFixed(2)}:1, ${hex(fg)} on ${hex(bg.rgb)}`, href: link(node), nodeId: node.id });
          else if (!large && ratio < 7 && size < 14) add({ id: "contrast", level: "warn", rule: "Small text with contrast under 7:1 passes AA but is hard to read; darken it.", node: label(node), detail: `${size}px, ${ratio.toFixed(2)}:1`, href: link(node), nodeId: node.id });
        } else if (bg?.other) {
          add({ id: "contrast", level: "check", rule: "Text on an image or gradient: check the contrast by eye at the lightest point (4.5:1, or 3:1 for large text).", node: label(node), href: link(node), nodeId: node.id });
        }
      }
      // Size.
      if (size && size < 12) add({ id: "size", level: "fail", rule: "Text under 12px is too small to read.", node: label(node), detail: `${size}px`, href: link(node), nodeId: node.id });
      else if (size && size < 16 && chars.length > 60) add({ id: "size", level: "warn", rule: "Body text under 16px: 16px is the comfortable minimum for paragraphs.", node: label(node), detail: `${size}px`, href: link(node), nodeId: node.id });
      // Line height on paragraphs. Figma reports it three ways; the percent-of-font-size
      // value is the one designers set ("160%"), so it wins. "Auto" line height is left alone,
      // and a paragraph whose character overrides set a line height uses the largest of those.
      const ratioOf = (x) => {
        if (!x) return 0;
        if (x.lineHeightUnit === "INTRINSIC_%" || x.lineHeightUnit === "AUTO") return -1; // auto
        if (Number(x.lineHeightPercentFontSize) > 0) return Number(x.lineHeightPercentFontSize) / 100;
        const fs = Number(x.fontSize) || size;
        if (Number(x.lineHeightPx) > 0 && fs) return Number(x.lineHeightPx) / fs;
        return 0;
      };
      const ratios = [ratioOf(st), ...Object.values(node.styleOverrideTable || {}).map(ratioOf)].filter((r) => r !== 0);
      const ratio = ratios.length ? Math.max(...ratios) : 0;
      if (size && chars.length > 80 && ratio > 0 && ratio < 1.4) add({ id: "line-height", level: "warn", rule: "Paragraph line height is tight; paragraphs read best at 1.5× the font size.", node: label(node), detail: `${Math.round(ratio * 100) / 100}×`, href: link(node), nodeId: node.id });
      // All caps paragraphs.
      if (st.textCase === "UPPER" && chars.length > 60) add({ id: "caps", level: "warn", rule: "Paragraphs in all capitals are harder to read; keep caps for short labels.", node: label(node), href: link(node), nodeId: node.id });
      // Wording.
      if (VAGUE_LINK.test(chars)) add({ id: "link-text", level: "warn", rule: "Link and button text should say where it goes, e.g. “Read the case study” rather than “Find out more”.", node: label(node), href: link(node), nodeId: node.id });
      // Justified text.
      if (st.textAlignHorizontal === "JUSTIFIED" && chars.length > 80) add({ id: "justified", level: "warn", rule: "Justified paragraphs have uneven spacing; left-align them.", node: label(node), href: link(node), nodeId: node.id });
    }
    const kids = node.children || [];
    kids.forEach((child, i) => walk(child, path.concat([{ node, siblingsBelow: kids.slice(0, i) }])));
  }
  walk(frame, []);

  const b = box(frame);
  return {
    id: frame.id, name: frame.name,
    width: b ? Math.round(b.width) : 0, height: b ? Math.round(b.height) : 0,
    texts, findings, href: nodeLink(fileKey, frame.id),
    fonts: [...fonts.entries()].map(([family, styles]) => ({ family, styles: [...styles].sort() })),
  };
}

export const CHECK_NAMES = {
  contrast: "Colour contrast", size: "Text size", "line-height": "Line height",
  "link-text": "Link wording", caps: "All-caps paragraphs", justified: "Justified text",
};

// Licence check for the fonts a design uses: Google Fonts and Adobe Fonts
// (both covered by the usual subscriptions), free weights, Font Awesome Free,
// system fonts. Anything else needs a bought licence or a swap before build.
export async function checkDesignFonts(families) {
  const { googleFontsLive, googleFontsSpecimenUrl, adobeFontsLive, adobeFontsStatus, freeVersionFor, adobeFontsSearchUrl, googleFontsSearchUrl } = await import("@/lib/scanner");
  const SYSTEM = /^(arial|helvetica( neue)?|times new roman|georgia|verdana|tahoma|trebuchet ms|courier new|segoe ui|roboto|system-ui|\.sf nt|calibri|cambria|inter)$/i;
  const out = [];
  for (const family of families.slice(0, 40)) {
    const fam = String(family).replace(/[-_](bold|regular|medium|light|italic|black|thin|semibold|extrabold|heavy)$/i, "").trim();
    const r = { family: fam, status: "check", label: "Check licence", note: "", link: "" };
    if (/^(product sans|google sans|youtube sans)$/i.test(fam)) {
      Object.assign(r, { status: "paid", label: "Google's own font", note: "Product Sans and Google Sans are Google's brand fonts and are not licensed for other websites, even though Google's servers host them. Swap to a Google Fonts family (Poppins, Figtree and Outfit are close).", link: "https://fonts.google.com/?query=poppins" });
    } else if (/^(sf pro|sf pro display|sf pro text|san francisco|sf compact|new york)$/i.test(fam)) {
      Object.assign(r, { status: "check", label: "Apple system font", note: "Fine in the design, but Apple only licenses SF Pro for Apple platforms, so it cannot be embedded on the website. The build should use a system font stack (so Apple devices still show SF) or swap to a Google Fonts family such as Inter.", link: "https://fonts.google.com/specimen/Inter" });
    } else if (/^font ?awesome/i.test(fam)) {
      const pro = /pro|sharp|duotone|light|thin/i.test(fam);
      Object.assign(r, pro ? { status: "paid", label: "Font Awesome Pro", note: "Pro icon styles need a Font Awesome Pro licence on the site, or swap to the Free solid/regular icons.", link: "https://fontawesome.com/plans" } : { status: "free", label: "Font Awesome Free", note: "Free icons, fine to use.", link: "https://fontawesome.com/search?o=r&m=free" });
    } else if (SYSTEM.test(fam) && !/^(roboto|inter)$/i.test(fam)) {
      Object.assign(r, { status: "free", label: "System font", note: "Built into the visitor's device; nothing to licence." });
    } else {
      const [g, a] = await Promise.all([googleFontsLive(fam), adobeFontsLive(fam)]);
      const adobe = a || adobeFontsStatus(fam);
      if (g === "yes") Object.assign(r, { status: "free", label: "On Google Fonts", note: "Free to use; load it from Google Fonts.", link: googleFontsSpecimenUrl(fam) });
      else if (adobe === "yes") Object.assign(r, { status: "free", label: "On Adobe Fonts", note: "Covered by the Adobe Fonts subscription; embed it via a web project kit.", link: `https://fonts.adobe.com/fonts/${fam.toLowerCase().replace(/\s+/g, "-")}` });
      else {
        const fv = freeVersionFor(fam);
        if (fv) Object.assign(r, { status: "check", label: "Partly free", note: fv.note, link: fv.url });
        else Object.assign(r, { status: "paid", label: "Licence needed", note: "Not on Google Fonts or Adobe Fonts. The client needs to buy a webfont licence, or the designer should swap it before build.", link: adobeFontsSearchUrl(fam), searchGoogle: googleFontsSearchUrl(fam) });
      }
    }
    out.push(r);
  }
  return out;
}
