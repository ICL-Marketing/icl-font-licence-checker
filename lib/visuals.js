// Mock-up visuals for idea slides: Claude picks the kind that shows the idea best and fills in the words,
// and the deck draws it as editable PowerPoint shapes (used when no screenshot is added).
export const VISUALS = {
  social_card: { label: "Social link preview", caption: "How a shared link will look", fields: { site: "Site name", title: "Page title", description: "Short description", url: "Web address" } },
  search_result: { label: "Google search result", caption: "How you'll show in Google", fields: { query: "What someone searches", title: "Result title", url: "Web address", description: "Result description" } },
  browser: { label: "Web page", caption: "The new page", fields: { url: "Web address", headline: "Headline", subline: "Line under the headline", buttons: "Buttons (one per line)" } },
  phone: { label: "Phone screen", caption: "On a phone", fields: { headline: "Headline", lines: "Content lines (one per line)", button: "Button" } },
  before_after: { label: "Before and after", caption: "", fields: { before: "Today (one per line)", after: "After (one per line)" } },
  checklist: { label: "Checklist", caption: "What's included", fields: { items: "Items (one per line)" } },
  stat: { label: "Big number", caption: "", fields: { value: "Number, e.g. 53%", label: "What it means" } },
  notification: { label: "Alert or email", caption: "What candidates receive", fields: { app: "From", title: "Title", text: "Message" } },
};
const LISTS = new Set(["buttons", "lines", "before", "after", "items"]);
export const isListField = (k) => LISTS.has(k);

export const VISUAL_PROMPT = `- visual: a simple mock-up that SHOWS the idea (not a summary of it). Pick the one kind that fits best and fill its fields with realistic wording for this client:
  social_card {site, title, description, url} for link previews / social sharing;
  search_result {query, title, url, description} for SEO and Google visibility;
  browser {url, headline, subline, buttons: [2 short labels]} for a new or changed web page;
  phone {headline, lines: [2–4 short lines], button} for mobile improvements;
  before_after {before: [2–3 short points], after: [2–3 short points]} for fixes;
  checklist {items: [3–5 short items]} for audits, QA or compliance;
  stat {value, label} only when there's a real figure from their site or a well-known source;
  notification {app, title, text} for job alerts, emails or notifications.
  Add "caption": a 2–5 word label for it (e.g. "How a shared link will look").`;

export function parseVisual(v) {
  if (!v || typeof v !== "object" || !VISUALS[v.kind]) return null;
  const out = { kind: v.kind, caption: String(v.caption || "").trim() };
  for (const k of Object.keys(VISUALS[v.kind].fields)) out[k] = LISTS.has(k) ? (Array.isArray(v[k]) ? v[k] : String(v[k] || "").split("\n")).map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : String(v[k] || "").trim();
  return out;
}

// Draws the visual into a box on a pptxgenjs slide. Colours and font come from the deck.
export function drawVisual(pres, s, v, box, C) {
  const { x, y, w, h } = box;
  const { NAVY, INDIGO, TEAL, WHITE, INK, GREY, PALE, FONT } = C;
  const T = (text, o) => s.addText(text, { fontFace: FONT, isTextBox: true, margin: 0, valign: "top", ...o });
  const R = (o, round = 0.15) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { rectRadius: round, line: { color: o.fill?.color || WHITE }, ...o });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.3, fill: { color: NAVY }, line: { color: NAVY } });
  const cap = v.caption || VISUALS[v.kind].caption;
  if (cap) T(cap.toUpperCase(), { x: x + 0.5, y: y + 0.4, w: w - 1, h: 0.45, fontSize: 16, bold: true, color: TEAL, charSpacing: 2 });
  const ix = x + 0.5, iy = y + 1.05, iw = w - 1, ih = h - 1.5; // inner area
  const list = (k) => (Array.isArray(v[k]) ? v[k] : []).map((t) => String(t).trim()).filter(Boolean);
  switch (v.kind) {
    case "social_card": {
      R({ x: ix, y: iy, w: iw, h: ih, fill: { color: WHITE } }, 0.25);
      s.addShape(pres.shapes.RECTANGLE, { x: ix + 0.3, y: iy + 0.3, w: iw - 0.6, h: ih * 0.48, fill: { color: INDIGO }, line: { color: INDIGO } });
      s.addShape(pres.shapes.RECTANGLE, { x: ix + 0.3, y: iy + 0.3 + ih * 0.48 - 0.12, w: iw - 0.6, h: 0.12, fill: { color: TEAL }, line: { color: TEAL } });
      T((v.site || "").toUpperCase(), { x: ix + 0.5, y: iy + 0.3, w: iw - 1, h: ih * 0.48, fontSize: 30, bold: true, color: WHITE, align: "center", valign: "middle", fit: "shrink" });
      const ty = iy + 0.45 + ih * 0.48;
      T((v.url || "").toUpperCase(), { x: ix + 0.35, y: ty, w: iw - 0.7, h: 0.4, fontSize: 13, color: GREY, charSpacing: 1 });
      T(v.title || "", { x: ix + 0.35, y: ty + 0.42, w: iw - 0.7, h: 0.9, fontSize: 21, bold: true, color: INK, fit: "shrink" });
      T(v.description || "", { x: ix + 0.35, y: ty + 1.35, w: iw - 0.7, h: ih - (ty - iy) - 1.5, fontSize: 16, color: GREY, fit: "shrink" });
      break;
    }
    case "search_result": {
      R({ x: ix, y: iy, w: iw, h: ih, fill: { color: WHITE } }, 0.25);
      R({ x: ix + 0.35, y: iy + 0.4, w: iw - 0.7, h: 0.7, fill: { color: PALE } }, 0.35);
      s.addShape(pres.shapes.OVAL, { x: ix + 0.6, y: iy + 0.6, w: 0.28, h: 0.28, fill: { color: PALE }, line: { color: GREY, width: 1.5 } });
      T(v.query || "", { x: ix + 1.05, y: iy + 0.4, w: iw - 1.2, h: 0.7, fontSize: 17, color: INK, valign: "middle" });
      T(v.url || "", { x: ix + 0.4, y: iy + 1.5, w: iw - 0.8, h: 0.4, fontSize: 14, color: "4D5156" });
      T(v.title || "", { x: ix + 0.4, y: iy + 1.95, w: iw - 0.8, h: 1, fontSize: 22, color: "1A0DAB", fit: "shrink" });
      T(v.description || "", { x: ix + 0.4, y: iy + 3, w: iw - 0.8, h: 1.6, fontSize: 16, color: "4D5156", fit: "shrink" });
      T("1st", { x: ix + iw - 1.5, y: iy + ih - 0.9, w: 1.2, h: 0.6, fontSize: 22, bold: true, color: TEAL, align: "right" });
      break;
    }
    case "browser": {
      R({ x: ix, y: iy, w: iw, h: ih, fill: { color: WHITE } }, 0.2);
      s.addShape(pres.shapes.RECTANGLE, { x: ix, y: iy + 0.2, w: iw, h: 0.45, fill: { color: "ECECF4" }, line: { color: "ECECF4" } });
      ["FF5F57", "FEBC2E", "28C840"].forEach((c, i) => s.addShape(pres.shapes.OVAL, { x: ix + 0.25 + i * 0.3, y: iy + 0.32, w: 0.2, h: 0.2, fill: { color: c }, line: { color: c } }));
      T(v.url || "", { x: ix + 1.3, y: iy + 0.2, w: iw - 1.6, h: 0.45, fontSize: 12, color: GREY, valign: "middle" });
      T(v.headline || "", { x: ix + 0.45, y: iy + 1.1, w: iw - 0.9, h: 1.7, fontSize: 28, bold: true, color: NAVY, fit: "shrink" });
      T(v.subline || "", { x: ix + 0.45, y: iy + 2.9, w: iw - 0.9, h: 1, fontSize: 16, color: GREY, fit: "shrink" });
      list("buttons").slice(0, 2).forEach((b, i) => {
        const bw = Math.min(3, (iw - 1.2) / 2);
        R({ x: ix + 0.45 + i * (bw + 0.3), y: iy + 4.2, w: bw, h: 0.65, fill: { color: i ? WHITE : TEAL }, line: { color: i ? NAVY : TEAL, width: 1.5 } }, 0.32);
        T(b, { x: ix + 0.45 + i * (bw + 0.3), y: iy + 4.2, w: bw, h: 0.65, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle" });
      });
      break;
    }
    case "phone": {
      const pw = Math.min(3.5, iw), px = x + (w - pw) / 2;
      R({ x: px, y: iy - 0.1, w: pw, h: ih + 0.2, fill: { color: "14141C" } }, 0.45);
      R({ x: px + 0.15, y: iy + 0.05, w: pw - 0.3, h: ih - 0.1, fill: { color: WHITE } }, 0.35);
      T(v.headline || "", { x: px + 0.4, y: iy + 0.5, w: pw - 0.8, h: 1.3, fontSize: 20, bold: true, color: NAVY, fit: "shrink" });
      list("lines").forEach((t, i) => { R({ x: px + 0.4, y: iy + 2 + i * 0.75, w: pw - 0.8, h: 0.6, fill: { color: PALE } }, 0.1); T(t, { x: px + 0.55, y: iy + 2 + i * 0.75, w: pw - 1.1, h: 0.6, fontSize: 12, color: INK, valign: "middle", fit: "shrink" }); });
      if (v.button) { R({ x: px + 0.4, y: iy + ih - 1.05, w: pw - 0.8, h: 0.65, fill: { color: TEAL } }, 0.32); T(v.button, { x: px + 0.4, y: iy + ih - 1.05, w: pw - 0.8, h: 0.65, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle" }); }
      break;
    }
    case "before_after": {
      const cw = (iw - 0.3) / 2;
      [["TODAY", list("before"), "E5484D"], ["AFTER", list("after"), TEAL]].forEach(([lab, items, col], i) => {
        const cx = ix + i * (cw + 0.3);
        R({ x: cx, y: iy, w: cw, h: ih, fill: { color: WHITE } }, 0.2);
        s.addShape(pres.shapes.RECTANGLE, { x: cx, y: iy + 0.15, w: cw, h: 0.12, fill: { color: col }, line: { color: col } });
        T(lab, { x: cx + 0.3, y: iy + 0.45, w: cw - 0.6, h: 0.5, fontSize: 18, bold: true, color: i ? NAVY : col, charSpacing: 2 });
        T(items.map((t, k) => ({ text: `${i ? "✓" : "✕"}  ${t}`, options: { breakLine: k < items.length - 1, paraSpaceAfter: 10 } })), { x: cx + 0.3, y: iy + 1.1, w: cw - 0.6, h: ih - 1.3, fontSize: 22, bold: true, color: INK, fit: "shrink" });
      });
      break;
    }
    case "checklist": {
      list("items").forEach((t, i) => {
        const ry = iy + i * 1.05;
        R({ x: ix, y: ry, w: iw, h: 0.85, fill: { color: WHITE } }, 0.2);
        s.addShape(pres.shapes.OVAL, { x: ix + 0.2, y: ry + 0.17, w: 0.5, h: 0.5, fill: { color: TEAL }, line: { color: TEAL } });
        T("✓", { x: ix + 0.2, y: ry + 0.17, w: 0.5, h: 0.5, fontSize: 18, bold: true, color: NAVY, align: "center", valign: "middle" });
        T(t, { x: ix + 0.95, y: ry, w: iw - 1.2, h: 0.85, fontSize: 18, color: INK, valign: "middle", fit: "shrink" });
      });
      break;
    }
    case "stat": {
      T(v.value || "", { x: ix, y: iy + 0.6, w: iw, h: 2.6, fontSize: 110, bold: true, color: TEAL, align: "center", valign: "middle", fit: "shrink" });
      T(v.label || "", { x: ix + 0.3, y: iy + 3.4, w: iw - 0.6, h: 1.8, fontSize: 24, color: WHITE, align: "center", fit: "shrink" });
      break;
    }
    case "notification": {
      [0, 1].forEach((k) => {
        const ny = iy + 0.6 + k * 2.3, op = k ? 50 : 0;
        R({ x: ix + k * 0.3, y: ny, w: iw - k * 0.6, h: 2, fill: { color: WHITE, transparency: op } }, 0.3);
        if (k) return;
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ix + 0.3, y: ny + 0.3, w: 0.55, h: 0.55, rectRadius: 0.12, fill: { color: INDIGO }, line: { color: INDIGO } });
        T(`${(v.app || "").toUpperCase()}  ·  NOW`, { x: ix + 1.05, y: ny + 0.3, w: iw - 1.4, h: 0.4, fontSize: 13, color: GREY, charSpacing: 1 });
        T(v.title || "", { x: ix + 1.05, y: ny + 0.7, w: iw - 1.4, h: 0.5, fontSize: 18, bold: true, color: INK, fit: "shrink" });
        T(v.text || "", { x: ix + 1.05, y: ny + 1.15, w: iw - 1.4, h: 0.75, fontSize: 15, color: GREY, fit: "shrink" });
      });
      break;
    }
  }
}
