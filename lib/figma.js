// Accessibility checks on Figma designs, before anything is coded.
// Reads the file through Figma's REST API (FIGMA_TOKEN, a personal access
// token) and checks each top-level frame (screen) for the things that can be
// judged from a design: colour contrast, text size, line height, tap target
// size, link wording, placeholder copy and the fonts used.

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

export const nodeLink = (fileKey, id) => `https://www.figma.com/design/${fileKey}/?node-id=${String(id).replace(/:/g, "-")}`;

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
    return { name: j.name || "", frames: frames.map((f) => ({ id: f.id, name: f.name, page: doc.type === "CANVAS" ? doc.name : "" })) };
  }
  const j = await api(`/files/${fileKey}?depth=2`);
  const out = [];
  for (const page of j.document?.children || []) {
    for (const f of page.children || []) if (isScreen(f)) out.push({ id: f.id, name: f.name, page: page.name });
  }
  return { name: j.name || "", frames: out };
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

const INTERACTIVE = /\b(button|btn|cta|link|tab|toggle|switch|checkbox|radio|chip|pill|menu|burger|hamburger|close|icon ?button|nav item|pagination|arrow|chevron|play|pause|next|prev|previous|dropdown|select)\b/i;
const CONTAINER = ["FRAME", "INSTANCE", "COMPONENT", "GROUP", "COMPONENT_SET", "SECTION"];
const VAGUE_LINK = /^\s*(click here|here|read more|learn more|more|link|see more|view more|find out more|details|go)\s*[>→»]*\s*$/i;

// Check one screen. Returns findings and the fonts it uses.
export function checkFrame(frame, fileKey) {
  const findings = [];
  const fonts = new Map(); // family -> Set(style)
  const seenInteractive = new Set();
  let texts = 0;

  const add = (f) => findings.push(f);
  const link = (n) => nodeLink(fileKey, n.id);
  const label = (n) => (n.type === "TEXT" ? `“${String(n.characters || "").replace(/\s+/g, " ").trim().slice(0, 60)}${(n.characters || "").length > 60 ? "…" : ""}”` : n.name);

  function walk(node, path, insideInteractive) {
    if (node.visible === false) return;
    const b = box(node);
    let interactiveHere = insideInteractive;
    if (!insideInteractive && CONTAINER.includes(node.type) && INTERACTIVE.test(node.name || "") && b && node !== frame) {
      interactiveHere = true;
      if (!seenInteractive.has(node.id)) {
        seenInteractive.add(node.id);
        const w = Math.round(b.width), h = Math.round(b.height);
        if (w < 24 || h < 24) add({ id: "target", level: "fail", text: `Tap target “${node.name}” is ${w}×${h}px. Anything you tap needs at least 24×24px (WCAG 2.5.8); 44×44px is the comfortable size.`, href: link(node) });
        else if (w < 44 || h < 44) add({ id: "target", level: "warn", text: `Tap target “${node.name}” is ${w}×${h}px. 44×44px is the recommended minimum for touch.`, href: link(node) });
      }
    }
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
          if (ratio < need) add({ id: "contrast", level: "fail", text: `${label(node)} has a contrast of ${ratio.toFixed(2)}:1 (${hex(fg)} on ${hex(bg.rgb)}). It needs at least ${need}:1 for ${large ? "large" : "normal"} text.`, href: link(node) });
          else if (!large && ratio < 7 && size < 14) add({ id: "contrast", level: "warn", text: `${label(node)} is small (${size}px) with ${ratio.toFixed(2)}:1 contrast. Passes AA, but small light text is hard to read; 7:1 would be safer.`, href: link(node) });
        } else if (bg?.other) {
          add({ id: "contrast", level: "check", text: `${label(node)} sits on an image or gradient. Check the contrast by eye (needs ${size >= 24 ? "3" : "4.5"}:1 at the lightest point).`, href: link(node) });
        }
      }
      // Size.
      if (size && size < 12) add({ id: "size", level: "fail", text: `${label(node)} is ${size}px. Nothing readable should be under 12px.`, href: link(node) });
      else if (size && size < 16 && chars.length > 60) add({ id: "size", level: "warn", text: `${label(node)} is body text at ${size}px. 16px is the comfortable minimum for paragraphs.`, href: link(node) });
      // Line height on paragraphs.
      const lh = Number(st.lineHeightPx) || 0;
      if (size && lh && chars.length > 80 && lh / size < 1.4) add({ id: "line-height", level: "warn", text: `${label(node)} has a line height of ${Math.round((lh / size) * 100) / 100}× the font size. Paragraphs read best at 1.5×.`, href: link(node) });
      // All caps paragraphs.
      if (st.textCase === "UPPER" && chars.length > 60) add({ id: "caps", level: "warn", text: `${label(node)} is a paragraph in all capitals, which is harder to read. Keep caps for short labels.`, href: link(node) });
      // Wording.
      if (VAGUE_LINK.test(chars)) add({ id: "link-text", level: "warn", text: `${label(node)} does not say where it goes. Link and button text should make sense on its own, e.g. “Read the case study”.`, href: link(node) });
      if (/lorem ipsum|dolor sit amet/i.test(chars)) add({ id: "placeholder", level: "check", text: `${label(node)} is placeholder copy. Real content changes line lengths and contrast.`, href: link(node) });
      // Justified text.
      if (st.textAlignHorizontal === "JUSTIFIED" && chars.length > 80) add({ id: "justified", level: "warn", text: `${label(node)} is justified. Uneven spacing makes paragraphs harder to read; left-align it.`, href: link(node) });
    }
    const kids = node.children || [];
    kids.forEach((child, i) => walk(child, path.concat([{ node, siblingsBelow: kids.slice(0, i) }]), interactiveHere));
  }
  walk(frame, [], false);

  const b = box(frame);
  return {
    id: frame.id, name: frame.name,
    width: b ? Math.round(b.width) : 0, height: b ? Math.round(b.height) : 0,
    texts, findings, href: nodeLink(fileKey, frame.id),
    fonts: [...fonts.entries()].map(([family, styles]) => ({ family, styles: [...styles].sort() })),
  };
}

export const CHECK_NAMES = {
  contrast: "Colour contrast", size: "Text size", "line-height": "Line height", target: "Tap target size",
  "link-text": "Link wording", caps: "All-caps paragraphs", placeholder: "Placeholder copy", justified: "Justified text",
};
