// Builds the ICL proposal deck (.pptx) in the browser with pptxgenjs, in the house style:
// dark gradient slides with the white logo, white slides with navy titles, teal accents, Obviously.
import { TEAMS, DAY_RATE, split } from "@/lib/proposal";
import { isSeoLine, packagesOf } from "@/lib/packages";
import { deckOutline, NOT_IN_CLIENT_DECKS, teamList, hrs, LINKEDIN_BLOCKS, supportTable, SERVICE_ROWS } from "@/lib/deckOutline";

const W = 19.44, H = 12.5;
const NAVY = "252560", INDIGO = "291F8E", TEAL = "1EDD9B", INK = "1B1B3A", GREY = "5B5B78", PALE = "F3F3FA", WHITE = "FFFFFF";
const FONT = "Obviously";
// Tier colours (bronze, silver, gold), and darker versions for text on white.
const METAL = { bronze: "D69C3C", silver: "C9CBD1", gold: "F5D63D" };
const METAL_DARK = { bronze: "A8712A", silver: "7C808C", gold: "B8960F" };


async function dataUrl(src) {
  if (!src || src.startsWith("data:")) return src || null;
  const b = await (await fetch(src)).blob();
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(b); });
}
// Natural size of an image, so it can be fitted without stretching.
const sizeOf = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ w: 16, h: 10 }); i.src = src; });
const fit = (s, bw, bh) => { const k = Math.min(bw / s.w, bh / s.h); return { w: s.w * k, h: s.h * k }; };
export { NOT_IN_CLIENT_DECKS };
const teamName = (k) => TEAMS.find(([x]) => x === k)?.[1] || k;
const fileSafe = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Client";

export async function buildDeck({ client, website, lines, copy, images = {}, packages = [], template = null, dayRate = DAY_RATE, tiers = false, savings = {}, prices = true, captions = {}, supportPlan = "", overhead = null }) {
  // overhead: project management and management hours from the cost table ({ hours, price }), a line of its own in the summary.
  // prices: false leaves out every price, cost and hour: no estimate bars, investment summary, cost or tier slides
  // (package slides still go in when switched on).
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pres = new PptxGenJS();
  // Where each slide goes: null for one built here, or a slot name for a slide copied from the uploaded template.
  const order = [];
  const realAdd = pres.addSlide.bind(pres);
  pres.addSlide = (o) => { order.push(null); return realAdd(o); };
  pres.defineLayout({ name: "ICL", width: W, height: H });
  pres.layout = "ICL";
  pres.author = "ICL Digital";
  pres.title = `${client} ${copy.deckTitle || "Website proposal"}`;
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const [bg, logoW, logoN, logoC, icon8, icon9] = await Promise.all(["/proposal/bg-dark.jpg", "/proposal/logo-white.png", "/proposal/logo-navy.png", "/proposal/logo-closing.png", "/proposal/icon-8.png", "/proposal/icon-9.png"].map(dataUrl));
  // What goes on each slide (shared with the review step's slide previews).
  const extraList = (template?.extras || []).map((e, i) => ({ ...e, i })).filter((e) => template.slots[`extra:${e.i}`]);
  const O = deckOutline({ lines, copy, packages, dayRate, tiers, savings, prices, overhead, extras: extraList });
  const { picked, pkgOf, byKey, hide, show, plans } = O;
  // A slide you designed yourself (Settings → Proposals) takes the place of the built-in one.
  const fixedSlide = (slot) => { if (!template?.slots?.[slot]) return false; order.push(slot); return true; };
  // Extra slides from your template, at the point in the deck you chose for them (unless taken out in the review step).
  const extrasAt = (anchor) => { extraList.forEach((e) => { if (e.after === anchor && O.extraOn(e)) order.push(`extra:${e.i}`); }); };
  const retainerUpsell = O.retainerUpsell; // the retainer slide, pitched on the Gold card
  const dark = () => { const s = pres.addSlide(); s.background = { data: bg }; s.addImage({ data: logoW, x: 0.9, y: H - 1.15, w: 2.3, h: 2.3 * (183 / 786) }); return s; };
  const light = (title) => {
    const s = pres.addSlide(); s.background = { color: WHITE };
    s.addImage({ data: logoN, x: 0.9, y: H - 1.15, w: 2.3, h: 2.3 * (199 / 858) });
    s.addText(String(lines.length ? client : "").toUpperCase(), { x: W - 7.9, y: H - 1.1, w: 7, h: 0.5, fontFace: FONT, fontSize: 12, color: GREY, align: "right", charSpacing: 2, isTextBox: true });
    if (title) s.addText(title.toUpperCase(), { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: NAVY, isTextBox: true, margin: 0 });
    return s;
  };
  // A 2x2 grid of numbered blocks with a clear gap between rows: the text size drops until every block fits its cell.
  const blockGrid = (s, items) => {
    const top = 2.4, gap = 0.7, w = 8.4, ch = (H - 1.6 - top - gap) / 2, tw = w - 1.25;
    const fits = (fs) => items.every((b) => {
      const lines = (t, size, k) => Math.ceil((t.length * size * k) / 72 / tw);
      const hgt = (lines(b.title, fs + 4, 0.72) * (fs + 4) + lines(b.text, fs, 0.52) * fs) * 1.2 / 72 + 0.15;
      return hgt <= ch;
    });
    let fs = 24; while (fs > 15 && !fits(fs)) fs -= 1;
    items.forEach((b, i) => block(s, 0.9 + (i % 2) * 9.1, top + Math.floor(i / 2) * (ch + gap), w, ch, i + 1, b.title, b.text, false, fs));
  };
  const block = (s, x, y, w, h, n, title, text, onDark, fs = 24) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: 0.9, h: 0.9, fill: { color: TEAL } });
    s.addText(String(n), { x, y, w: 0.9, h: 0.9, fontFace: FONT, fontSize: 24, bold: true, color: NAVY, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText([{ text: title.toUpperCase(), options: { fontSize: fs + 4, bold: true, color: onDark ? TEAL : NAVY, breakLine: true } }, { text, options: { fontSize: fs, color: onDark ? WHITE : INK } }], { x: x + 1.25, y: y + 0.05, w: w - 1.25, h, fontFace: FONT, valign: "top", paraSpaceAfter: 8, isTextBox: true, margin: 0 });
  };

  // 1. Cover
  {
    const s = dark();
    const cover = images.cover || Object.values(images)[0];
    if (cover) {
      const sz = await sizeOf(cover); const f = fit(sz, 8.6, 8.4);
      s.addImage({ data: cover, x: W - 0.9 - f.w, y: (H - f.h) / 2 - 0.3, w: f.w, h: f.h, shadow: { type: "outer", blur: 12, offset: 6, angle: 90, color: "000000", opacity: 0.35 } });
    }
    const tw = cover ? 9 : W - 1.8;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.9, y: 3.2, w: 1.6, h: 0.14, fill: { color: TEAL }, line: { color: TEAL } });
    // As big as fits: sized so the longest word stays on one line (shrink-to-fit isn't applied until the deck is edited).
    const longest = Math.max(...client.split(/\s+/).map((w) => w.length), 1);
    // Sized from the heading font's real letter widths (Obviously Bold, in ems), so the longest word stays on one line.
    const EM = { A: 0.83, B: 0.81, C: 0.81, D: 0.82, E: 0.72, F: 0.68, G: 0.82, H: 0.86, I: 0.38, J: 0.51, K: 0.81, L: 0.57, M: 1.02, N: 0.85, O: 0.85, P: 0.78, Q: 0.86, R: 0.82, S: 0.75, T: 0.63, U: 0.85, V: 0.77, W: 1.08, X: 0.79, Y: 0.74, Z: 0.76, "&": 0.83, "-": 0.44, ".": 0.25, "'": 0.25, " ": 0.26 };
    const ems = (t) => [...String(t).toUpperCase()].reduce((n, c) => n + (EM[c] ?? (/[0-9]/.test(c) ? 0.75 : 0.85)), 0) * 1.06; // 6% spare
    const words = client.split(/\s+/).filter(Boolean);
    const nameSize = Math.max(36, Math.min(110, Math.floor((tw * 72) / Math.max(...words.map(ems), 1))));
    // Lines after wrapping at that size, to place the subtitle below the name.
    let nameLines = 1, lineW = 0;
    for (const w of words) { const wW = (ems(w) * nameSize) / 72, sp = (0.26 * nameSize) / 72; if (lineW && lineW + sp + wW > tw) { nameLines++; lineW = wW; } else lineW += (lineW ? sp : 0) + wW; }
    nameLines = Math.min(3, nameLines);
    const nameH = (nameLines * nameSize * 1.1) / 72, subY = 3.6 + nameH + 0.35;
    s.addText(client.toUpperCase(), { x: 0.9, y: 3.6, w: tw, h: nameH, fontFace: FONT, fontSize: nameSize, bold: true, color: WHITE, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    s.addText(copy.deckTitle || "WEBSITE PROPOSAL", { x: 0.9, y: subY, w: tw, h: 1.6, valign: "top", fontFace: FONT, fontSize: 50, bold: true, color: TEAL, isTextBox: true, margin: 0 });
    s.addText([website, new Date().toLocaleDateString("en-GB")].filter(Boolean).join("  ·  "), { x: 0.9, y: subY + 1.9, w: tw, h: 0.8, fontFace: FONT, fontSize: 26, color: "CFCFF0", isTextBox: true, margin: 0 });
  }
  // 2. Agenda: the sections this deck actually has, in order.
  const showPackages = show.packages;
  if (show.agenda) {
    const agenda = O.agenda;
    const s = light("Agenda");
    const per = Math.ceil(agenda.length / (agenda.length > 7 ? 2 : 1)), colW = agenda.length > 7 ? 8.6 : W - 1.8;
    agenda.forEach((t, i) => {
      const x = 0.9 + Math.floor(i / per) * 9.1, y = 2.5 + (i % per) * 1.05;
      s.addShape(pres.shapes.OVAL, { x, y, w: 0.75, h: 0.75, fill: { color: TEAL } });
      s.addText(String(i + 1), { x, y, w: 0.75, h: 0.75, fontFace: FONT, fontSize: 20, bold: true, color: NAVY, align: "center", valign: "middle", isTextBox: true, margin: 0 });
      s.addText(t, { x: x + 1.05, y, w: colW - 1.05, h: 0.75, fontFace: FONT, fontSize: 24, bold: true, color: NAVY, valign: "middle", isTextBox: true, margin: 0 });
    });
  }
  extrasAt("cover");
  // LinkedIn: broad options only. A single monthly price, never cost breakdowns or supplier costs; the
  // outreach plan and its campaign pricing are presented separately by our Head of Marketing.
  if (show.linkedin) {
    const s = light("LinkedIn suggestions");
    blockGrid(s, LINKEDIN_BLOCKS(Number(copy.linkedinPosts) > 0 ? Number(copy.linkedinPosts) : 8, prices));
  }
  // 3. Background
  if (show.background) {
    const s = light("Website ideas: the background");
    blockGrid(s, copy.background);
  }
  extrasAt("background");
  // 4. Where the biggest wins are
  if (show.wins) {
    const s = dark();
    s.addText("WHERE THE BIGGEST WINS ARE", { x: 0.9, y: 0.9, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, isTextBox: true, margin: 0 });
    const n = copy.wins.length, gap = 0.45, cw = (W - 1.8 - gap * (n - 1)) / n;
    copy.wins.forEach((b, i) => {
      const x = 0.9 + i * (cw + gap);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.8, w: cw, h: 7.4, rectRadius: 0.25, fill: { color: WHITE, transparency: 90 }, line: { color: TEAL, width: 1.5 } });
      s.addText(String(i + 1).padStart(2, "0"), { x: x + 0.5, y: 3.2, w: cw - 1, h: 1.2, fontFace: FONT, fontSize: 54, bold: true, color: TEAL, isTextBox: true, margin: 0 });
      s.addText([{ text: b.title.toUpperCase(), options: { fontSize: 24, bold: true, color: WHITE, breakLine: true } }, { text: " ", options: { fontSize: 12, breakLine: true } }, { text: b.text, options: { fontSize: 22, color: "DCDCF5" } }], { x: x + 0.5, y: 4.6, w: cw - 1, h: 5.3, fontFace: FONT, valign: "top", isTextBox: true, margin: 0 });
    });
  }
  extrasAt("wins");
  // 5. One slide per idea
  // A package slide (SEO, PPC, social media): with the other packages near the end of the deck.
  const shownPkg = new Set();
  const packageSlide = (g) => {
    if (!showPackages || g.id === "support" || shownPkg.has(g.id) || !picked.includes(g)) return;
    shownPkg.add(g.id);
    if (fixedSlide(g.id)) return;
    const s = light(g.title);
    s.addText(g.intro, { x: 0.9, y: 1.95, w: W - 1.8, h: 0.8, fontFace: FONT, fontSize: 20, color: GREY, isTextBox: true, margin: 0 });
    const n = g.tiers.length, gap = 0.35, cw = (W - 1.8 - gap * (n - 1)) / n;
    g.tiers.forEach((x, i) => {
      const on = g.picked.includes(x.id), cx = 0.9 + i * (cw + gap), fg = on ? WHITE : INK, metal = METAL[x.id] || TEAL;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: 3.3, w: cw, h: 6.4, rectRadius: 0.25, fill: { color: on ? NAVY : PALE }, line: { color: on ? metal : PALE, width: on ? 2.5 : 1 } });
      if (on) {
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, rectRadius: 0.25, fill: { color: metal }, line: { color: metal } });
        s.addText("RECOMMENDED", { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, align: "center", valign: "middle", charSpacing: 1, isTextBox: true, margin: 0 });
      }
      const sz = n > 3 ? 1 : 1.12;
      s.addText([
        { text: x.name.toUpperCase(), options: { fontSize: 19 * sz, bold: true, color: on ? metal : METAL[x.id] ? METAL_DARK[x.id] : NAVY, breakLine: true } },
        { text: x.price.toUpperCase(), options: { fontSize: 44 * sz, bold: true, color: fg, breakLine: true } },
        { text: x.period, options: { fontSize: 15 * sz, color: on ? "DCDCF5" : GREY, breakLine: true, paraSpaceAfter: 10 } },
        ...(x.best ? [{ text: x.best, options: { fontSize: 16 * sz, color: on ? "DCDCF5" : GREY, breakLine: true, paraSpaceAfter: 12 } }] : []),
        ...x.items.map((it, k) => ({ text: it, options: { fontSize: 16 * sz, color: fg, bullet: { indent: 18 }, paraSpaceAfter: x.items.length >= 15 ? 3 : 6, ...(k < x.items.length - 1 ? { breakLine: true } : {}) } })),
      ], { x: cx + 0.45, y: 3.8, w: cw - 0.9, h: 5.7, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    });
    s.addText(g.footnote, { x: 0.9, y: 9.95, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 14, color: GREY, isTextBox: true, margin: 0 });
  };
  // The SEO idea is always the last idea slide.
  for (const [n, l] of [...lines.filter((x) => !isSeoLine(x)), ...lines.filter(isSeoLine)].entries()) {
    const c = byKey[l.key] || {};
    const s = light();
    const img = hide.pictures || isSeoLine(l) ? null : images[l.key]; // the SEO slide is text only; pictures can be switched off
    const textW = img ? 8.7 : W - 1.8; // no picture: the text uses the full width
    s.addText(`${n + 1}. ${(c.title || l.title).toUpperCase()}`, { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: NAVY, fit: "shrink", isTextBox: true, margin: 0 });
    // Body paragraphs at 1.5 line spacing: the intro with no indent and 16pt after, bullets with a 0.36" hanging
    // indent and 10pt after, then the benefit in bold. The text size drops for longer copy so it all fits.
    const body = [], bullets = (c.bullets || []).map((b) => b.trim()).filter(Boolean);
    const copyLen = [c.intro || l.why || "", ...bullets, c.closing || ""].join(" ").length;
    const bodySize = copyLen > 520 ? 17 : copyLen > 400 ? 19 : copyLen > 300 ? 21 : 23, ls = { lineSpacingMultiple: 1.5 };
    if (!c.intro && !l.why && !bullets.length) body.push({ text: c.title || l.title, options: { fontSize: bodySize, color: INK, breakLine: true, ...ls } });
    if (c.intro || l.why) body.push({ text: c.intro || l.why, options: { fontSize: bodySize, color: INK, breakLine: true, paraSpaceAfter: 16, ...ls } });
    bullets.forEach((b) => body.push({ text: b, options: { fontSize: bodySize, color: INK, bullet: { indent: 26 }, breakLine: true, paraSpaceAfter: 10, ...ls } }));
    if (c.closing) body.push({ text: c.closing, options: { fontSize: bodySize, color: INDIGO, bold: true, paraSpaceBefore: 6, ...ls } });
    if (body.length) { delete body[body.length - 1].options.breakLine; s.addText(body, { x: 0.9, y: 2.3, w: textW, h: 6.6, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 }); }
    // Every picture fills the same frame on the right (cropped to fit, not squashed), so the slides match.
    if (img) {
      const sz = await sizeOf(img), bw = 8.6, bh = 5.4, iy = 2.2 + (7.2 - bh) / 2;
      // A screenshot of their site is captioned above, e.g. "Current layout".
      if (captions[l.key]) s.addText(captions[l.key], { x: W - 0.9 - bw, y: iy - 0.8, w: bw, h: 0.6, fontFace: FONT, fontSize: 24, color: NAVY, align: "center", valign: "bottom", isTextBox: true, margin: 0 });
      s.addImage({ data: img, x: W - 0.9 - bw, y: iy, w: bw, h: (bw * sz.h) / sz.w, sizing: { type: "cover", w: bw, h: bh } });
    }
    // Effort box (left out of a deck without prices)
    if (prices) {
    const pkg = pkgOf(l);
    // One line: ESTIMATE 14 HRS   TEAM: CONTENT (4 HOURS), DESIGN (8 HOURS), DEVELOPMENT (2 HOURS). Package work is named, not timed.
    const sp = split(l), hoursOf = (h) => `${h} ${h === 1 ? "HOUR" : "HOURS"}`;
    const teamBits = [...TEAMS.filter(([k]) => sp[k]).map(([k, name]) => `${name} (${hoursOf(sp[k][1])})`), ...packagesOf(l, picked).map((g) => `${g.name} (package)`)];
    const teamText = teamBits.length ? teamBits.join(", ") : teamList(l.team); // only the teams with hours, each with its hours
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: W - 1.8, h: 1.25, rectRadius: 0.2, fill: { color: PALE }, line: { color: PALE } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: 0.18, h: 1.25, rectRadius: 0.05, fill: { color: TEAL }, line: { color: TEAL } });
    // The SEO idea: "SEO Bronze from £599 p.m., Team: Marketing". Other ideas show hours and team only (no £: prices are on
    // the package slide).
    const seoTier = isSeoLine(l) && pkg && (pkg.tiers.find((x) => pkg.picked.includes(x.id)) || pkg.tiers[0]);
    const runs = seoTier ? [{ text: `${pkg.name} ${String(seoTier.name).split(":")[0].replace(new RegExp(`^${pkg.name}\\s*`, "i"), "")}${prices ? ` from ${seoTier.price} p.m.` : ""}`.replace(/\s+/g, " ").toUpperCase(), options: { color: NAVY, bold: true } }, { text: ",  TEAM:  ", options: { color: GREY, bold: true } }, { text: "MARKETING", options: { color: NAVY, bold: true } }] : [{ text: pkg ? "PACKAGE  " : "ESTIMATE  ", options: { color: GREY, bold: true } }, { text: (pkg ? pkg.name : `${hrs(l.min, l.max)}${l.free ? " · FREE OF CHARGE" : ""}`).toUpperCase(), options: { color: NAVY, bold: true } }, { text: "      TEAM:  ", options: { color: GREY, bold: true } }, { text: teamText.toUpperCase(), options: { color: NAVY, bold: true } }];
    const chars = runs.reduce((n, r) => n + r.text.length, 0), fs = Math.max(11, Math.min(20, Math.floor(((W - 2.9) * 72) / (chars * 0.7))));
    s.addText(runs, { x: 1.4, y: 9.6, w: W - 2.9, h: 1.15, fontFace: FONT, fontSize: fs, valign: "middle", wrap: false, isTextBox: true, margin: 0 });
    }
  }
  extrasAt("ideas");
  // 6. Investment summary: the hourly work, plus one-off packages (videography) at their set price.
  if (show.summary) {
    const s = light("Investment summary");
    const { heads, rows: body, teams } = O.summary, many = teams > 3;
    const hd = (t, al = "center") => ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, fontSize: many ? 12 : 16 } });
    const cell = (t, o = {}) => ({ text: t, options: { color: INK, fontSize: many ? 15 : 17, align: "center", ...o } });
    const fixedW = many ? [4.6, 3.0] : [5.4, 3.4], TW = W - 1.8, EW = 2.2, CW = 2.2; // CW: the cost column
    const pad = { margin: [0.08, 0.1, 0.08, 0.35] }; // breathing room on the left of the first column
    const rows = [heads.map((h, i) => (i ? hd(h) : { ...hd(h, "left"), options: { ...hd(h, "left").options, ...pad } }))];
    const est = 2 + teams; // the Estimate column (Cost follows it)
    for (const r of body) {
      const total = r.kind === "total", fill = total ? { fill: { color: PALE } } : {}, teal = r.free ? { color: TEAL } : {};
      rows.push(r.cells.map((c, i) => (i === 0 ? cell(c, { align: "left", bold: true, color: NAVY, ...pad, ...fill })
        : i === 1 ? cell(c, fill)
        : i < est ? cell(c, total ? { bold: true, ...fill } : {})
        : cell(c, { bold: !(r.kind === "fixed" && i === est), ...teal, ...(total ? { color: NAVY, ...fill } : {}) }))));
    }
    const rh = Math.min(1, 7.6 / rows.length);
    const colW = [...fixedW, ...Array(teams).fill((TW - fixedW[0] - fixedW[1] - EW - (prices ? CW : 0)) / teams), EW, ...(prices ? [CW] : [])];
    s.addTable(rows, { x: 0.9, y: 2.3, w: TW, colW, rowH: rh, fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" }, margin: 0.08 });
  }
  // 6b. Costs: package work (SEO, PPC, videography, support) kept apart from the hours
  // One-off packages are on the investment summary, so this is the monthly costs only.
  if (show.costs) {
    const s = light("Monthly costs");
    const hd = (t, al = "left") => ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, fontSize: 17, margin: [0.08, 0.35, 0.08, 0.35] } });
    const cell = (t, o = {}) => ({ text: t, options: { color: INK, fontSize: 18, margin: [0.1, 0.35, 0.1, 0.35], ...o } });
    const rows = [[hd("Package"), hd("Covers"), hd("Cost", "right")], ...O.costs.rows.map(([n, c, p]) => [cell(n, { bold: true, color: NAVY }), cell(c), cell(p, { bold: true, color: NAVY, align: "right" })])];
    // Column widths follow the longest package name and cost, so each stays on one line.
    const est = (t) => (t.length * 18 * 0.7) / 72 + 0.8;
    const c1 = Math.min(9, Math.max(5.6, ...rows.slice(1).map((r) => est(r[0].text)))), c3 = Math.min(7.5, Math.max(4.4, ...rows.slice(1).map((r) => est(r[2].text))));
    s.addTable(rows, { x: 0.9, y: 2.3, w: W - 1.8, colW: [c1, W - 1.8 - c1 - c3, c3], rowH: 0.95, fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" } });
    s.addText(O.costs.note, { x: 0.9, y: Math.min(9.9, 2.6 + rows.length * 0.95), w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 15, color: GREY, isTextBox: true, margin: 0 });
  }
  extrasAt("costs");
  // 6b. Options: Bronze / Silver / Gold built from the ideas (only when switched on in the review step).
  for (const [opt, plan] of plans.entries()) {
    const s = light("Choose your one-off package");
    if (plans.length > 1) s.addNotes(`Option ${opt + 1} of ${plans.length}: keep the pricing you like best and delete the other option slides.`);
    const { cards: tiers, extras } = O.tierSlides[opt];
    s.addText("Silver gives you the most for your budget, and any option can be split over multiple payments if needed.", { x: 0.9, y: 1.95, w: W - 1.8, h: 0.8, fontFace: FONT, fontSize: 20, color: GREY, isTextBox: true, margin: 0 });
    const gap = 0.35, cw = (W - 1.8 - gap * 2) / 3;
    // Bronze lists its ideas (and any free extras); Silver and Gold start "Everything in Bronze / Silver, plus:" and list only what they add.
    const itemsOf = (x) => x.items.map((t) => [t]);
    const longest = Math.max(...tiers.map((x) => itemsOf(x).length));
    // Fit check: the longest list (by height) must fit between the price and the bottom of the card.
    const room = 3.3 + (plan.monthly.length ? 5.6 : 6.4) - 5.65 - 0.2, textW = cw - 0.9 - 0.3;
    const listH = (fs, marB) => Math.max(...tiers.map((x) => itemsOf(x).reduce((h, [t]) => h + Math.ceil((t.length * fs * 0.55) / 72 / textW) * (fs * 1.2) / 72 + marB, 0)));
    let cardSize = 16; while (cardSize > 10 && listH(cardSize, 0.14) > room) cardSize -= 1;
    tiers.forEach((x, i) => {
      const on = x.id === "silver", cx = 0.9 + i * (cw + gap), fg = on ? WHITE : INK, metal = METAL[x.id];
      const items = itemsOf(x);
      // 0.18" under each item (0.14" on the longest list); the text size drops until the longest list fits its card.
      const marB = items.length === longest && longest > 1 && tiers.some((y) => itemsOf(y).length < longest) ? 0.14 : 0.18, fs = cardSize;
      // Each card wraps its own list: as tall as its items need (with room at the bottom), never past the space there is.
      const ownH = items.reduce((h, [t]) => h + Math.ceil((t.length * fs * 0.55) / 72 / textW) * (fs * 1.2) / 72 + marB, 0);
      const cardH = Math.min(plan.monthly.length ? 5.6 : 6.4, Math.max(3, 5.65 - 3.3 + ownH + 0.35));
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: 3.3, w: cw, h: cardH, rectRadius: 0.25, fill: { color: on ? NAVY : PALE }, line: { color: on ? metal : PALE, width: on ? 2.5 : 1 } });
      if (on) {
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, rectRadius: 0.25, fill: { color: TEAL }, line: { color: TEAL } });
        s.addText("RECOMMENDED", { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, align: "center", valign: "middle", charSpacing: 1, isTextBox: true, margin: 0 });
      }
      // Support retainer switched on: Gold carries an upsell pill (like Recommended) for continuous work after the build.
      if (x.id === "gold" && retainerUpsell) {
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx + 0.45, y: 3.05, w: 3.4, h: 0.5, rectRadius: 0.25, fill: { color: METAL.gold }, line: { color: METAL.gold } });
        s.addText("+ ONGOING RETAINER", { x: cx + 0.45, y: 3.05, w: 3.4, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, align: "center", valign: "middle", charSpacing: 1, isTextBox: true, margin: 0 });
      }
      // Under the price: "The essentials", "Everything in Bronze, plus", "Everything in Silver, plus". "From" when a
      // package with a "From" price is included.
      const { tagline, from } = x;
      s.addText([
        { text: x.label.toUpperCase(), options: { fontSize: 22, bold: true, color: on ? metal : METAL_DARK[x.id], breakLine: true } },
        { text: x.price, options: { fontSize: from ? 42 : 50, bold: true, color: fg, breakLine: true } },
        { text: " ", options: { fontSize: 8, breakLine: true } },
        { text: tagline, options: { fontSize: 15, color: on ? "DCDCF5" : GREY } },
      ], { x: cx + 0.45, y: 3.8, w: cw - 0.9, h: 1.7, fontFace: FONT, valign: "top", isTextBox: true, margin: 0 });
      // Item prices match the investment summary exactly (a package at its own price wording).
      const cell = { fontFace: FONT, fontSize: fs, color: fg, valign: "top", margin: [0, 0, marB, 0] };
      // Real check-mark bullets with a hanging indent, so wrapped lines sit under the text, not the tick.
      s.addTable(items.map(([t]) => [{ text: [{ text: t, options: { bullet: { code: "2713", indent: 18 } } }], options: cell }]), { x: cx + 0.45, y: 5.65, w: cw - 0.9, colW: [cw - 0.9], border: { type: "none" }, fill: { color: on ? NAVY : PALE } });
    });
    // Monthly packages (SEO, PPC) aren't in the tiers: they sit underneath as an extra on top of any option.
    if (extras.length) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.1, w: W - 1.8, h: 0.85, rectRadius: 0.2, fill: { color: WHITE }, line: { color: TEAL, width: 1.5 } });
      s.addText([{ text: "+ MONTHLY EXTRA   ", options: { bold: true, color: TEAL, charSpacing: 1 } }, ...extras.flatMap(([n, p], k) => [{ text: `${k ? "     " : ""}${n}  ` , options: { bold: true, color: NAVY } }, { text: p, options: { color: INK } }])], { x: 1.3, y: 9.1, w: W - 2.6, h: 0.85, fontFace: FONT, fontSize: 17, valign: "middle", isTextBox: true, margin: 0 });
    }
    s.addText(extras.length ? "Prices exclude VAT. Monthly packages (such as SEO) are on top and can be added to any option." : "Prices exclude VAT.", { x: 0.9, y: extras.length ? 10.2 : 9.95, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 14, color: GREY, isTextBox: true, margin: 0 });
  }
  // 6c. Roadmap (the template's process timeline): the ideas spread over the months, most expensive
  // first, one-off packages included, monthly packages running all the way through, a cost per month.
  // Six months (fewer only when there's little to do), one column per month, in the packages' build order
  // (Bronze ideas first, then Silver, then Gold) when the options slide is on.
  if (O.roadmap) {
    const { months, ongoing: monthly } = O.roadmap, n = months.length;
    const s = dark();
    const title = O.roadmap.title;
    const q = title.indexOf("?") + 1;
    s.addText([{ text: title.slice(0, q).toUpperCase() + " ", options: { color: WHITE } }, { text: title.slice(q).trim().toUpperCase(), options: { color: TEAL } }], { x: 0.9, y: 0.6, w: W - 1.8, h: 1.4, fontFace: FONT, fontSize: 36, bold: true, valign: "top", isTextBox: true, margin: 0 });
    // The template's process timeline in one row: big number, a teal arrow band with MONTH n, then what's done
    // that month. Monthly packages run through every month, in their tier's colour (SEO Bronze in bronze).
    const left = 0.9, colW = (W - 0.9 - left) / n, fs = n > 4 ? 16 : 20, top = 2.6;
    const ONGOING = { bronze: "A9782F", silver: METAL.silver, gold: METAL.gold };
    s.addShape(pres.shapes.PENTAGON, { x: 0, y: top + 1.05, w: left + n * colW + 0.2, h: 0.9, fill: { color: TEAL }, line: { color: TEAL } });
    months.forEach((list, i) => {
      const x = left + i * colW, w = colW - 0.3;
      s.addText(String(i + 1), { x, y: top, w, h: 1.0, fontFace: FONT, fontSize: n > 4 ? 52 : 64, bold: true, color: WHITE, isTextBox: true, margin: 0 });
      s.addText(`MONTH ${i + 1}`, { x, y: top + 1.05, w, h: 0.9, fontFace: FONT, fontSize: n > 4 ? 20 : 28, bold: true, color: NAVY, valign: "middle", isTextBox: true, margin: 0 });
      const after = list.length + monthly.length >= 15 ? 3 : 6; // 6pt after each item, 3pt in a list of 15 or more
      const runs = [
        ...list.map((text) => ({ text, options: { color: WHITE, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: after } })),
        ...monthly.map(({ tier: tid, text }) => ({ text, options: { color: ONGOING[tid] || "CFCFF0", bold: !!ONGOING[tid], bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: after } })),
      ];
      s.addText(runs, { x, y: top + 2.3, w, h: H - top - 3.8, fontFace: FONT, fontSize: fs, valign: "top", isTextBox: true, margin: 0 });
    });
  }
  // 7. Retainer
  if (show.retainer) {
    const s = light("Next: a support retainer");
    // The roadmap slide is the plan; a roadmap block in older copy would disagree with it, so it's left out.
    blockGrid(s, copy.retainer.filter((b) => !/roadmap|\bmonths?\b/i.test(b.title)));
  }
  // 8. Support packages: the template's page 11 (tier headings in their colours, open table with rules)
  if (show.support && !fixedSlide("support")) {
    const s = light();
    s.addText("SUPPORT PACKAGES", { x: 0.64, y: 0.52, w: 15.25, h: 0.91, fontFace: FONT, fontSize: 44, bold: true, color: NAVY, valign: "middle", isTextBox: true, margin: 0 });
    s.addImage({ data: icon9, x: 17.16, y: 0.79, w: 0.66, h: 0.53 });
    s.addImage({ data: icon8, x: 18.04, y: 0.8, w: 0.53, h: 0.53 });
    s.addText([{ text: "These packages are designed to be used " }, { text: "as a starting point only", options: { bold: true } }, { text: ". Depending on your project's needs, a custom package will be created." }], { x: 0.64, y: 1.61, w: 18.17, h: 0.77, fontFace: FONT, fontSize: 20, color: INK, valign: "top", isTextBox: true, margin: 0 });
    const TIER = ["E4A315", "AFAFAF", "E3D42A"];
    const lab = (t) => ({ text: t, options: { bold: true, color: INDIGO } });
    const val = (t) => ({ text: t, options: { color: INK } });
    const rich = (b, t) => ({ text: [{ text: b, options: { bold: true } }, { text: t }], options: { color: INK } });
    const st = supportTable(supportPlan);
    const rows = [
      [{ text: "", options: {} }, ...st.heads.map((text, i) => ({ text, options: { bold: true, fontSize: 24, color: TIER[i] } }))],
      ...st.rows.map(([l, ...vals]) => [lab(l), ...vals.map((v) => (Array.isArray(v) ? rich(...v) : val(v)))]),
      [lab("Monthly Cost"), ...st.cost.map((t) => ({ text: t, options: { bold: true, color: INK } }))],
    ];
    // Rules under the headings and above the monthly cost, as in the template; no other borders.
    rows.forEach((r, i) => r.forEach((c) => { c.options.border = i === 0 ? [null, null, { type: "solid", pt: 1, color: INDIGO }, null] : i === rows.length - 1 ? [{ type: "solid", pt: 1, color: INDIGO }, null, null, null] : [null, null, null, null]; }));
    s.addTable(rows, { x: 0.71, y: 2.48, w: 18.1, colW: [4.88, 4.37, 4.34, 4.51], rowH: [0.87, 2.04, 0.91, 0.87, 0.67, 0.71, 0.67, 0.87, 0.87], fontFace: FONT, fontSize: 20, valign: "middle", margin: [0.04, 0.1, 0.04, 0.04] });
  }
  extrasAt("retainer"); // your own slides placed after the retainer follow the support packages, which come straight after it
  extrasAt("support");
  // 9. Service retainer offering: the brand layout, staggered rows of service names (positions taken from the design, in px of a 1900px-wide slide)
  if (show.services && !fixedSlide("services")) {
    const s = pres.addSlide(); s.background = { data: bg };
    const px = W / 1900;
    s.addText("OUR SERVICE RETAINER OFFERING", { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 58, bold: true, color: TEAL, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText([{ text: "Here is a list of just some of the services ICL can offer you as part of your retainer. ", options: { color: WHITE } }, { text: "*", options: { color: TEAL, bold: true } }], { x: 0.9, y: 1.8, w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 20, align: "center", isTextBox: true, margin: 0 });
    const rows = SERVICE_ROWS;
    for (const [cy, items] of rows) for (const [cx, label] of items) {
      const w = 4.6, h = 1.3;
      s.addText(label, { x: cx * px - w / 2, y: cy * px - h / 2, w, h, fontFace: FONT, fontSize: 32, bold: true, color: WHITE, align: "center", valign: "middle", lineSpacingMultiple: 0.95, isTextBox: true, margin: 0 });
    }
    s.addText([{ text: "* ", options: { color: TEAL, bold: true } }, { text: "The services we provide will be limited to the days included in your package, and any extra days can be added at our standard day rate.", options: { color: WHITE } }], { x: 3, y: 11.05, w: W - 6, h: 0.85, fontFace: FONT, fontSize: 19, align: "center", valign: "middle", isTextBox: true, margin: 0 });
  }
  extrasAt("services");
  // 10. Packages: one slide per package group picked, otherwise the standard support packages
  // 10. Packages not tied to an idea slide
  for (const g of picked) if (!g.fixed) packageSlide(g); // never a videography slide: the idea slide covers it
  extrasAt("packages");
  // 11. Closing: the template's last slide (logo with strapline, web address, copyright, confidentiality)
  if (!fixedSlide("closing")) {
    const s = pres.addSlide(); s.background = { data: bg };
    s.addImage({ data: logoC, x: 4.54, y: 3.85, w: 10.58, h: 10.58 * (749 / 2400) });
    s.addText("www.icldigital.com", { x: 0.9, y: 8.88, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 24, bold: true, color: WHITE, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText([{ text: "© ICL Digital – All rights reserved.", options: { fontSize: 14, bold: true, breakLine: true } }, { text: " ", options: { fontSize: 8, breakLine: true } }, { text: "Commercial-in-confidence. This document in its entirety has been specifically prepared for the client and its agents directly involved with this project. As such, it is considered confidential and proprietary and must not be disclosed to or used by any third party without written consent from ICL Group Limited.", options: { fontSize: 12, bold: true } }], { x: 1.74, y: 10.5, w: 15.97, h: 1.3, fontFace: FONT, color: WHITE, align: "center", valign: "top", isTextBox: true, margin: 0 });
  }
  const fileName = `${fileSafe(client)}-Proposal.pptx`;
  if (!order.some(Boolean)) { await pres.writeFile({ fileName }); return fileName; }
  // Your own slides are copied in after the deck is built, so they stay fully editable.
  const [{ default: JSZip }, { copySlides }] = await Promise.all([import("jszip"), import("@/lib/deckTemplate")]);
  const dst = await JSZip.loadAsync(await pres.write({ outputType: "blob" }));
  const picks = []; let at = 0;
  for (const slot of order) { if (slot) picks.push({ slide: template.slots[slot], at }); else at++; }
  await copySlides(template.zip, dst, picks);
  const blob = await dst.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  return fileName;
}
