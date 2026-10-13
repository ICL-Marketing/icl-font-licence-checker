// Builds the ICL proposal deck (.pptx) in the browser with pptxgenjs, in the house style:
// dark gradient slides with the white logo, white slides with navy titles, teal accents, Obviously.
import { TEAMS, range, split, totals, daysFor } from "@/lib/proposal";
import { pickedPackages, packageFor } from "@/lib/packages";

const W = 19.44, H = 12.5;
const NAVY = "252560", INDIGO = "291F8E", TEAL = "1EDD9B", INK = "1B1B3A", GREY = "5B5B78", PALE = "F3F3FA", WHITE = "FFFFFF";
const FONT = "Obviously";

const SERVICES = ["PLATFORMS", "APPS", "WEBSITES", "SEO", "BRANDING", "PPC", "ANIMATION", "DESIGN", "BROCHURE DESIGN", "CONTENT CREATION", "PRESENTATION TEMPLATES", "HOSTING SOLUTIONS", "SOCIAL MEDIA GRAPHICS", "CAMPAIGN STRATEGY", "COMPETITOR RESEARCH", "APP SUPPORT", "WEBSITE SUPPORT", "PLATFORM SUPPORT", "EMAIL CAMPAIGNS", "DIGITAL STRATEGY", "POSTER DESIGN", "VIDEOGRAPHY & PHOTOGRAPHY", "SOCIAL MEDIA CAMPAIGNS", "SOFTWARE MANAGEMENT"];
const PACKAGES = [
  ["", "BRONZE SUPPORT", "SILVER SUPPORT", "GOLD SUPPORT"],
  ["Included:", "All maintenance tasks needed to keep your website safe and secure, plus reactive and proactive support as needed.", "Bronze plus: a weekly call with your dedicated service delivery manager and monthly strategy meetings.", "Silver plus: half a day a month on site and complimentary managed hosting."],
  ["Support hours:", "9am – 5pm, Mon–Fri", "9am – 5pm, Mon–Fri", "9am – 5pm, Mon–Fri, plus emergency out of hours"],
  ["Contractual SLA:", "8 hour resolution", "6 hour resolution", "4 hour resolution"],
  ["Min time included (with flex):", "1 hour", "Half a day", "One day"],
  ["Out of hours support:", "£80 per hour", "Included as needed", "Included as needed"],
  ["On-going rate:", "£80 per hour", "£80 per hour", "£80 per hour"],
  ["Discount on extra work:", "n/a", "10%", "15%"],
  ["Monthly cost:", "£100.00 ex VAT", "£375.00 ex VAT", "£750.00 ex VAT"],
];

async function dataUrl(src) {
  if (!src || src.startsWith("data:")) return src || null;
  const b = await (await fetch(src)).blob();
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(b); });
}
// Natural size of an image, so it can be fitted without stretching.
const sizeOf = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ w: 16, h: 10 }); i.src = src; });
const fit = (s, bw, bh) => { const k = Math.min(bw / s.w, bh / s.h); return { w: s.w * k, h: s.h * k }; };
const teamName = (k) => TEAMS.find(([x]) => x === k)?.[1] || k;
const hrs = (a, b) => `${range(a, b)}\u00A0hr${a === b && a === 1 ? "" : "s"}`;
const fileSafe = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Client";

export async function buildDeck({ client, website, lines, copy, images = {}, packages = [] }) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "ICL", width: W, height: H });
  pres.layout = "ICL";
  pres.author = "ICL Digital";
  pres.title = `${client} ${copy.deckTitle || "Website proposal"}`;
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const [bg, logoW, logoN] = await Promise.all(["/proposal/bg-dark.jpg", "/proposal/logo-white.png", "/proposal/logo-navy.png"].map(dataUrl));
  const picked = pickedPackages(packages);
  const pkgOf = (l) => packageFor(l, picked);
  const priceOf = (g) => g.tiers.filter((x) => g.picked.includes(x.id)).map((x) => `${x.price} ${x.period}`).join(" or ");
  // Ideas priced by a set package (e.g. a video) don't count towards the hours or days.
  const hourLines = lines.filter((l) => !pkgOf(l));
  const days = daysFor(hourLines), t = totals(hourLines);
  const byKey = Object.fromEntries((copy.ideas || []).map((i) => [i.key, i]));
  const dark = () => { const s = pres.addSlide(); s.background = { data: bg }; s.addImage({ data: logoW, x: 0.9, y: H - 1.15, w: 2.3, h: 2.3 * (183 / 786) }); return s; };
  const light = (title) => {
    const s = pres.addSlide(); s.background = { color: WHITE };
    s.addImage({ data: logoN, x: 0.9, y: H - 1.15, w: 2.3, h: 2.3 * (199 / 858) });
    s.addText(String(lines.length ? client : "").toUpperCase(), { x: W - 7.9, y: H - 1.1, w: 7, h: 0.5, fontFace: FONT, fontSize: 12, color: GREY, align: "right", charSpacing: 2, isTextBox: true });
    if (title) s.addText(title.toUpperCase(), { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: NAVY, isTextBox: true, margin: 0 });
    return s;
  };
  const block = (s, x, y, w, h, n, title, text, onDark) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: 0.9, h: 0.9, fill: { color: TEAL } });
    s.addText(String(n), { x, y, w: 0.9, h: 0.9, fontFace: FONT, fontSize: 24, bold: true, color: NAVY, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText([{ text: title.toUpperCase(), options: { fontSize: 28, bold: true, color: onDark ? TEAL : NAVY, breakLine: true } }, { text, options: { fontSize: 24, color: onDark ? WHITE : INK } }], { x: x + 1.25, y: y + 0.05, w: w - 1.25, h, fontFace: FONT, valign: "top", paraSpaceAfter: 8, isTextBox: true, margin: 0 });
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
    const nameSize = Math.max(40, Math.min(110, Math.floor((tw * 72) / (longest * 0.82))));
    const nameLines = Math.min(3, Math.ceil((client.length * 0.82 * nameSize) / 72 / tw)), nameH = (nameLines * nameSize * 1.1) / 72, subY = 3.6 + nameH + 0.35;
    s.addText(client.toUpperCase(), { x: 0.9, y: 3.6, w: tw, h: nameH, fontFace: FONT, fontSize: nameSize, bold: true, color: WHITE, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    s.addText(copy.deckTitle || "WEBSITE PROPOSAL", { x: 0.9, y: subY, w: tw, h: 1.6, valign: "top", fontFace: FONT, fontSize: 50, bold: true, color: TEAL, isTextBox: true, margin: 0 });
    s.addText([website, new Date().toLocaleDateString("en-GB")].filter(Boolean).join("  ·  "), { x: 0.9, y: subY + 1.9, w: tw, h: 0.8, fontFace: FONT, fontSize: 26, color: "CFCFF0", isTextBox: true, margin: 0 });
  }
  // 3. Background
  const hide = copy.hide || {}; // slides taken out in the review step
  if (copy.background?.length && !hide.background) {
    const s = light("The background");
    copy.background.forEach((b, i) => block(s, 0.9 + (i % 2) * 9.1, 2.6 + Math.floor(i / 2) * 3.9, 8.4, 3.5, i + 1, b.title, b.text));
  }
  // 4. Where the biggest wins are
  if (copy.wins?.length && !hide.wins) {
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
  // 5. One slide per idea
  for (const [n, l] of lines.entries()) {
    const c = byKey[l.key] || {};
    const s = light();
    const img = images[l.key];
    const textW = 8.7;
    s.addText(`${n + 1}. ${(c.title || l.title).toUpperCase()}`, { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: NAVY, fit: "shrink", isTextBox: true, margin: 0 });
    const body = [];
    if (!c.intro && !l.why && !(c.bullets || []).length) body.push({ text: c.title || l.title, options: { fontSize: 23, color: INK, breakLine: true } });
    if (c.intro || l.why) body.push({ text: c.intro || l.why, options: { fontSize: 23, color: INK, breakLine: true, paraSpaceAfter: 16 } });
    (c.bullets || []).map((b) => b.trim()).filter(Boolean).forEach((b) => body.push({ text: b, options: { fontSize: 23, color: INK, bullet: { indent: 26 }, breakLine: true, paraSpaceAfter: 10 } }));
    if (c.closing && img) body.push({ text: c.closing, options: { fontSize: 23, color: INDIGO, bold: true, paraSpaceBefore: 12 } });
    if (body.length) { delete body[body.length - 1].options.breakLine; s.addText(body, { x: 0.9, y: 2.3, w: textW, h: 6.6, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 }); }
    if (img) {
      const f = fit(await sizeOf(img), 8.6, 7.2);
      s.addImage({ data: img, x: W - 0.9 - f.w, y: 2.2 + (7.2 - f.h) / 2, w: f.w, h: f.h });
    } else {
      // No screenshot: a navy panel with the number, the service and what we found, so the slide isn't half empty.
      const px = 10.9, pw = W - 0.9 - px;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px, y: 2.2, w: pw, h: 7, rectRadius: 0.3, fill: { color: NAVY }, line: { color: NAVY } });
      s.addText(String(n + 1).padStart(2, "0"), { x: px + 0.6, y: 2.6, w: pw - 1.2, h: 1.8, fontFace: FONT, fontSize: 96, bold: true, color: TEAL, isTextBox: true, margin: 0 });
      s.addText([{ text: (l.service || "").toUpperCase(), options: { fontSize: 18, bold: true, color: TEAL, charSpacing: 2, breakLine: true } }, { text: " ", options: { fontSize: 10, breakLine: true } }, { text: c.closing || (c.intro && l.why) || "", options: { fontSize: 26, color: WHITE } }], { x: px + 0.6, y: 4.7, w: pw - 1.2, h: 4.1, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    }
    // Effort box
    const pkg = pkgOf(l);
    const sp = split(l), parts = pkg ? "A set price for a set amount of work" : TEAMS.filter(([k]) => sp[k]).map(([k, name]) => `${name} ${hrs(...sp[k])}`).join("  ·  ");
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: W - 1.8, h: 1.25, rectRadius: 0.2, fill: { color: PALE }, line: { color: PALE } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: 0.18, h: 1.25, rectRadius: 0.05, fill: { color: TEAL }, line: { color: TEAL } });
    s.addText([{ text: pkg ? "PACKAGE  " : "ESTIMATE  ", options: { color: GREY, fontSize: 20, bold: true } }, { text: (pkg ? priceOf(pkg) : hrs(l.min, l.max)).toUpperCase(), options: { color: NAVY, fontSize: 20, bold: true } }, { text: "      TEAM  ", options: { color: GREY, fontSize: 20, bold: true } }, { text: l.team.map(teamName).join(" + ").toUpperCase(), options: { color: NAVY, fontSize: 20, bold: true } }], { x: 1.4, y: 9.6, w: 10.5, h: 1.15, fontFace: FONT, valign: "middle", fit: "shrink", isTextBox: true, margin: 0 });
    s.addText(parts.toUpperCase(), { x: 11.9, y: 9.6, w: W - 13.2, h: 1.15, fontFace: FONT, fontSize: 20, color: GREY, align: "right", valign: "middle", fit: "shrink", isTextBox: true, margin: 0 });
  }
  // 6. Estimated effort
  if (!hide.effort && hourLines.length) {
    const s = light("Estimated effort");
    const hd = (t, al = "center") => ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, fontSize: many ? 12 : 16 } });
    const cell = (t, o = {}) => ({ text: t, options: { color: INK, fontSize: many ? 15 : 17, align: "center", ...o } });
    // Only the teams this proposal uses get a column.
    const used = TEAMS.filter(([k]) => t[k][1] > 0);
    const many = used.length > 4, fixedW = many ? [3.2, 2.2] : [4.1, 2.5];
    const rows = [[hd("Improvement", "left"), hd("Team"), ...used.map(([, , short]) => hd(short)), hd("Estimate")]];
    for (const l of lines) { const sp = split(l); if (pkgOf(l)) { rows.push([cell((byKey[l.key]?.title || l.title), { align: "left", bold: true, color: NAVY }), cell(l.team.map(teamName).join(" + ")), ...used.map(() => cell("–")), cell(`${pkgOf(l).name} package`, { bold: true })]); continue; } rows.push([cell((byKey[l.key]?.title || l.title), { align: "left", bold: true, color: NAVY }), cell(l.team.map(teamName).join(" + ")), ...used.map(([k]) => cell(sp[k] ? range(...sp[k]) : "–")), cell(hrs(l.min, l.max), { bold: true })]); }
    rows.push([cell("Total hands-on work", { align: "left", bold: true, color: NAVY, fill: { color: PALE } }), cell("", { fill: { color: PALE } }), ...used.map(([k]) => cell(t[k][1] ? range(t[k][0], t[k][1]) : "–", { bold: true, fill: { color: PALE } })), cell(`${range(t.min, t.max)} hrs`, { bold: true, color: NAVY, fill: { color: PALE } })]);
    const rh = Math.min(1, 7.6 / rows.length);
    s.addTable(rows, { x: 0.9, y: 2.3, w: 12.6, colW: [...fixedW, ...used.map(() => (12.6 - fixedW[0] - fixedW[1] - 1.8) / used.length), 1.8], rowH: rh, fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" }, margin: 0.08 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 13.9, y: 2.3, w: W - 14.8, h: 7.6, rectRadius: 0.3, fill: { color: NAVY }, line: { color: NAVY } });
    s.addText([{ text: `${days} DAY${days === 1 ? "" : "S"}`, options: { fontSize: 66, bold: true, color: TEAL, breakLine: true } }, { text: "fixed, start to finish", options: { fontSize: 22, color: WHITE, breakLine: true } }, { text: " ", options: { fontSize: 16, breakLine: true } }, { text: `${range(t.min, t.max)} hours of hands-on work, estimated for a person doing it by hand (not AI-assisted).`, options: { fontSize: 19, color: "DCDCF5", breakLine: true, paraSpaceAfter: 12 } }, { text: `The ${days} day${days === 1 ? "" : "s"} also cover your feedback, testing and launch, so the price stays fixed.`, options: { fontSize: 19, color: "DCDCF5" } }], { x: 14.3, y: 2.6, w: W - 15.6, h: 7, fontFace: FONT, valign: "top", isTextBox: true, margin: 0 });
  }
  // 7. Retainer
  if (copy.retainer?.length && !hide.retainer) {
    const s = light("Next: a monthly retainer");
    copy.retainer.forEach((b, i) => block(s, 0.9 + (i % 2) * 9.1, 2.6 + Math.floor(i / 2) * 3.9, 8.4, 3.5, i + 1, b.title, b.text));
  }
  // 9. Service retainer offering
  if (!hide.services) {
    const s = dark();
    s.addText("OUR SERVICE RETAINER OFFERING", { x: 0.9, y: 0.9, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, isTextBox: true, margin: 0 });
    s.addText("Here are just some of the services ICL can offer you as part of your retainer.*", { x: 0.9, y: 2, w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 20, color: "DCDCF5", isTextBox: true, margin: 0 });
    const cols = 4, cw = (W - 1.8 - 0.3 * (cols - 1)) / cols;
    SERVICES.forEach((t, i) => {
      const x = 0.9 + (i % cols) * (cw + 0.3), y = 3.1 + Math.floor(i / cols) * 1.1;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: 0.8, rectRadius: 0.4, fill: { color: WHITE, transparency: 88 }, line: { color: TEAL, width: 1 } });
      s.addText(t, { x, y, w: cw, h: 0.8, fontFace: FONT, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle", charSpacing: 1, isTextBox: true, margin: 0 });
    });
    s.addText("* The services we provide are limited to the time included in your package; extra days can be added at our standard day rate.", { x: 4, y: H - 1.4, w: W - 4.9, h: 0.6, fontFace: FONT, fontSize: 13, color: "BDBDE0", align: "right", isTextBox: true, margin: 0 });
  }
  // 10. Packages: one slide per package group picked, otherwise the standard support packages
  if (!hide.packages && picked.length) for (const g of picked) {
    const s = light(g.title);
    s.addText(g.intro, { x: 0.9, y: 1.95, w: W - 1.8, h: 0.8, fontFace: FONT, fontSize: 20, color: GREY, isTextBox: true, margin: 0 });
    const n = g.tiers.length, gap = 0.35, cw = (W - 1.8 - gap * (n - 1)) / n;
    g.tiers.forEach((x, i) => {
      const on = g.picked.includes(x.id), cx = 0.9 + i * (cw + gap), fg = on ? WHITE : INK;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: 3.3, w: cw, h: 6.4, rectRadius: 0.25, fill: { color: on ? NAVY : PALE }, line: { color: on ? TEAL : PALE, width: on ? 2.5 : 1 } });
      if (on) {
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, rectRadius: 0.25, fill: { color: TEAL }, line: { color: TEAL } });
        s.addText("RECOMMENDED", { x: cx + 0.45, y: 3.05, w: 2.4, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, align: "center", valign: "middle", charSpacing: 1, isTextBox: true, margin: 0 });
      }
      const sz = n > 3 ? 1 : 1.12;
      s.addText([
        { text: x.name.toUpperCase(), options: { fontSize: 19 * sz, bold: true, color: on ? TEAL : NAVY, breakLine: true } },
        { text: x.price, options: { fontSize: 44 * sz, bold: true, color: fg, breakLine: true } },
        { text: x.period, options: { fontSize: 15 * sz, color: on ? "DCDCF5" : GREY, breakLine: true, paraSpaceAfter: 10 } },
        { text: x.best, options: { fontSize: 16 * sz, italic: true, color: on ? "DCDCF5" : GREY, breakLine: true, paraSpaceAfter: 12 } },
        ...x.items.map((it, k) => ({ text: it, options: { fontSize: 16 * sz, color: fg, bullet: { indent: 18 }, paraSpaceAfter: 8, ...(k < x.items.length - 1 ? { breakLine: true } : {}) } })),
      ], { x: cx + 0.45, y: 3.8, w: cw - 0.9, h: 5.7, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    });
    s.addText(g.footnote, { x: 0.9, y: 9.95, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 14, italic: true, color: GREY, isTextBox: true, margin: 0 });
  }
  if (!hide.packages && !picked.length) {
    const s = light("Support packages");
    const rows = PACKAGES.map((r, i) => r.map((t, j) => ({ text: t, options: i === 0 ? { bold: true, color: j ? WHITE : NAVY, fill: { color: j ? [0, "9C6B3F", "8A8FA0", "C9A227"][j] : WHITE }, align: "center", fontSize: 17 } : { color: j ? INK : NAVY, bold: !j || i === PACKAGES.length - 1, fontSize: 14, align: j ? "center" : "left", fill: { color: i % 2 ? PALE : WHITE } } })));
    s.addTable(rows, { x: 0.9, y: 2.2, w: W - 1.8, colW: [3.84, 4.4, 4.4, 5], rowH: [0.8, 1.35, 0.75, 0.65, 0.65, 0.65, 0.65, 0.65, 0.8], fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" }, margin: 0.1 });
    s.addText("These packages are a starting point only. Depending on your needs, we'll put together a custom package.", { x: 0.9, y: 9.9, w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 15, italic: true, color: GREY, isTextBox: true, margin: 0 });
  }
  // 11. Closing
  {
    const s = pres.addSlide(); s.background = { data: bg };
    s.addImage({ data: logoW, x: (W - 7) / 2, y: 3.2, w: 7, h: 7 * (183 / 786) });
    s.addText([{ text: "www.icldigital.com", options: { fontSize: 26, bold: true, color: TEAL, breakLine: true } }, { text: "© ICL Digital – All rights reserved.", options: { fontSize: 16, color: WHITE } }], { x: 1, y: 6.2, w: W - 2, h: 1.5, fontFace: FONT, align: "center", isTextBox: true, margin: 0 });
    s.addText("Commercial-in-confidence. This document in its entirety has been specifically prepared for the client and its agents directly involved with this project. As such, it is considered confidential and proprietary and must not be disclosed to or used by any third party without written consent from ICL Group Limited.", { x: 2.5, y: H - 2.4, w: W - 5, h: 1.3, fontFace: FONT, fontSize: 12, color: "BDBDE0", align: "center", isTextBox: true, margin: 0 });
  }
  const fileName = `${fileSafe(client)}-Proposal.pptx`;
  await pres.writeFile({ fileName });
  return fileName;
}
