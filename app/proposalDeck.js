// Builds the ICL proposal deck (.pptx) in the browser with pptxgenjs, in the house style:
// dark gradient slides with the white logo, white slides with navy titles, teal accents, Obviously.
import { TEAMS, range, split, totals } from "@/lib/proposal";
import { pickedPackages, packageFor, packagesOf, hourTeams } from "@/lib/packages";

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
const teamName = (k) => TEAMS.find(([x]) => x === k)?.[1] || k;
const hrs = (a, b) => `${range(a, b)}\u00A0hr${a === b && a === 1 ? "" : "s"}`;
const fileSafe = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Client";

export async function buildDeck({ client, website, lines, copy, images = {}, packages = [], template = null }) {
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
  const picked = pickedPackages(packages);
  const pkgOf = (l) => packageFor(l, picked);
  const priceOf = (g) => g.tiers.filter((x) => g.picked.includes(x.id)).map((x) => `${x.price} ${x.period}`).join(" or ");
  // Ideas priced by a set package (e.g. a video) don't count towards the hours.
  const hourLines = lines.filter((l) => !pkgOf(l));
  const t = totals(hourLines);
  // A slide you designed yourself (Settings → Proposals) takes the place of the built-in one.
  const fixedSlide = (slot) => { if (!template?.slots?.[slot]) return false; order.push(slot); return true; };
  // Extra slides from your template, at the point in the deck you chose for them (unless taken out in the review step).
  const extrasAt = (anchor) => { (template?.extras || []).forEach((e, i) => { if (e.after === anchor && !hide[`extra:${i}`] && template.slots[`extra:${i}`]) order.push(`extra:${i}`); }); };
  const byKey = Object.fromEntries((copy.ideas || []).map((i) => [i.key, i]));
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
    const nameSize = Math.max(40, Math.min(110, Math.floor((tw * 72) / (longest * 0.82))));
    const nameLines = Math.min(3, Math.ceil((client.length * 0.82 * nameSize) / 72 / tw)), nameH = (nameLines * nameSize * 1.1) / 72, subY = 3.6 + nameH + 0.35;
    s.addText(client.toUpperCase(), { x: 0.9, y: 3.6, w: tw, h: nameH, fontFace: FONT, fontSize: nameSize, bold: true, color: WHITE, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    s.addText(copy.deckTitle || "WEBSITE PROPOSAL", { x: 0.9, y: subY, w: tw, h: 1.6, valign: "top", fontFace: FONT, fontSize: 50, bold: true, color: TEAL, isTextBox: true, margin: 0 });
    s.addText([website, new Date().toLocaleDateString("en-GB")].filter(Boolean).join("  ·  "), { x: 0.9, y: subY + 1.9, w: tw, h: 0.8, fontFace: FONT, fontSize: 26, color: "CFCFF0", isTextBox: true, margin: 0 });
  }
  extrasAt("cover");
  // 3. Background
  const hide = copy.hide || {}; // slides taken out in the review step
  if (copy.background?.length && !hide.background) {
    const s = light("The background");
    blockGrid(s, copy.background);
  }
  extrasAt("background");
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
  extrasAt("wins");
  // 5. One slide per idea
  for (const [n, l] of lines.entries()) {
    const c = byKey[l.key] || {};
    const s = light();
    const img = images[l.key];
    const textW = img ? 8.7 : W - 1.8; // no picture: the text uses the full width
    s.addText(`${n + 1}. ${(c.title || l.title).toUpperCase()}`, { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: NAVY, fit: "shrink", isTextBox: true, margin: 0 });
    const body = [];
    if (!c.intro && !l.why && !(c.bullets || []).length) body.push({ text: c.title || l.title, options: { fontSize: 23, color: INK, breakLine: true } });
    if (c.intro || l.why) body.push({ text: c.intro || l.why, options: { fontSize: 23, color: INK, breakLine: true, paraSpaceAfter: 16 } });
    (c.bullets || []).map((b) => b.trim()).filter(Boolean).forEach((b) => body.push({ text: b, options: { fontSize: 23, color: INK, bullet: { indent: 26 }, breakLine: true, paraSpaceAfter: 10 } }));
    if (c.closing) body.push({ text: c.closing, options: { fontSize: 23, color: INDIGO, bold: true, paraSpaceBefore: 12 } });
    if (body.length) { delete body[body.length - 1].options.breakLine; s.addText(body, { x: 0.9, y: 2.3, w: textW, h: 6.6, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 }); }
    if (img) {
      const f = fit(await sizeOf(img), 8.6, 7.2);
      s.addImage({ data: img, x: W - 0.9 - f.w, y: 2.2 + (7.2 - f.h) / 2, w: f.w, h: f.h });
    }
    // Effort box
    const pkg = pkgOf(l);
    // One line: ESTIMATE 14 HRS   TEAM: CONTENT (4 HOURS), DESIGN (8 HOURS), DEVELOPMENT (2 HOURS). Package work is named, not timed.
    const sp = split(l), hoursOf = (h) => `${h} ${h === 1 ? "HOUR" : "HOURS"}`;
    const teamBits = [...TEAMS.filter(([k]) => sp[k]).map(([k, name]) => `${name} (${hoursOf(sp[k][1])})`), ...packagesOf(l, picked).map((g) => `${g.name} (package)`)];
    const teamText = teamBits.length > 1 ? teamBits.join(", ") : l.team.map(teamName).join(" + ");
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: W - 1.8, h: 1.25, rectRadius: 0.2, fill: { color: PALE }, line: { color: PALE } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 9.55, w: 0.18, h: 1.25, rectRadius: 0.05, fill: { color: TEAL }, line: { color: TEAL } });
    const runs = [{ text: pkg ? "PACKAGE  " : "ESTIMATE  ", options: { color: GREY, bold: true } }, { text: (pkg ? priceOf(pkg) : hrs(l.min, l.max)).toUpperCase(), options: { color: NAVY, bold: true } }, { text: "      TEAM:  ", options: { color: GREY, bold: true } }, { text: teamText.toUpperCase(), options: { color: NAVY, bold: true } }];
    const chars = runs.reduce((n, r) => n + r.text.length, 0), fs = Math.max(11, Math.min(20, Math.floor(((W - 2.9) * 72) / (chars * 0.7))));
    s.addText(runs, { x: 1.4, y: 9.6, w: W - 2.9, h: 1.15, fontFace: FONT, fontSize: fs, valign: "middle", wrap: false, isTextBox: true, margin: 0 });
  }
  extrasAt("ideas");
  // 6. Estimated effort
  if (!hide.effort && hourLines.length) {
    const s = light("Estimated effort");
    const hd = (t, al = "center") => ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, fontSize: many ? 12 : 16 } });
    const cell = (t, o = {}) => ({ text: t, options: { color: INK, fontSize: many ? 15 : 17, align: "center", ...o } });
    // Only the teams this proposal uses get a column.
    const used = TEAMS.filter(([k]) => t[k][1] > 0);
    const many = used.length > 4, fixedW = many ? [4.8, 3.2] : [5.8, 3.6], TW = W - 1.8, EW = 2.4;
    const pad = { margin: [0.08, 0.1, 0.08, 0.35] }; // breathing room on the left of the first column
    const rows = [[{ ...hd("Improvement", "left"), options: { ...hd("Improvement", "left").options, ...pad } }, hd("Team"), ...used.map(([, , short]) => hd(short)), hd("Estimate")]];
    for (const l of hourLines) { const sp = split(l); rows.push([cell((byKey[l.key]?.title || l.title).toUpperCase(), { align: "left", bold: true, color: NAVY, ...pad }), cell(l.team.map(teamName).join(" + ")), ...used.map(([k]) => cell(sp[k] ? range(...sp[k]) : "–")), cell(hrs(l.min, l.max), { bold: true })]); }
    rows.push([cell("TOTAL HANDS-ON WORK", { align: "left", bold: true, color: NAVY, fill: { color: PALE }, ...pad }), cell("", { fill: { color: PALE } }), ...used.map(([k]) => cell(t[k][1] ? range(t[k][0], t[k][1]) : "–", { bold: true, fill: { color: PALE } })), cell(`${range(t.min, t.max)} hrs`, { bold: true, color: NAVY, fill: { color: PALE } })]);
    const rh = Math.min(1, 7.6 / rows.length);
    s.addTable(rows, { x: 0.9, y: 2.3, w: TW, colW: [...fixedW, ...used.map(() => (TW - fixedW[0] - fixedW[1] - EW) / used.length), EW], rowH: rh, fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" }, margin: 0.08 });
  }
  // 6b. Costs: package work (SEO, PPC, videography, support) kept apart from the hours
  if (!hide.costs && picked.length) {
    const s = light(picked.some((g) => g.fixed) ? (picked.some((g) => !g.fixed) ? "Monthly & one-off costs" : "One-off costs") : "Monthly costs");
    const hd = (t, al = "left") => ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, fontSize: 17, margin: [0.08, 0.35, 0.08, 0.35] } });
    const cell = (t, o = {}) => ({ text: t, options: { color: INK, fontSize: 18, margin: [0.1, 0.35, 0.1, 0.35], ...o } });
    const rows = [[hd("Package"), hd("Covers"), hd("Cost", "right")]];
    for (const g of [...picked.filter((x) => !x.fixed), ...picked.filter((x) => x.fixed)]) for (const t of g.tiers.filter((x) => g.picked.includes(x.id))) {
      const covers = lines.filter((l) => packagesOf(l, picked).some((x) => x.id === g.id)).map((l) => byKey[l.key]?.title || l.title);
      rows.push([cell((t.name.toLowerCase().includes(g.name.toLowerCase()) ? t.name : `${g.name} ${t.name}`).toUpperCase(), { bold: true, color: NAVY }), cell(covers.length ? covers.join(", ") : t.best), cell(`${t.price} ${t.period}`, { bold: true, color: NAVY, align: "right" })]);
    }
    // Column widths follow the longest package name and cost, so each stays on one line.
    const est = (t) => (t.length * 18 * 0.7) / 72 + 0.8;
    const c1 = Math.min(9, Math.max(5.6, ...rows.slice(1).map((r) => est(r[0].text)))), c3 = Math.min(7.5, Math.max(4.4, ...rows.slice(1).map((r) => est(r[2].text))));
    s.addTable(rows, { x: 0.9, y: 2.3, w: W - 1.8, colW: [c1, W - 1.8 - c1 - c3, c3], rowH: 0.95, fontFace: FONT, valign: "middle", border: { type: "solid", pt: 0.75, color: "DADAEA" } });
    s.addText(["All prices exclude VAT.", picked.some((g) => g.id === "ppc") && "PPC is our monthly management fee plus your Google ad spend, paid to Google.", picked.some((g) => g.fixed) && "Videography is a set price for a set amount of work."].filter(Boolean).join(" "), { x: 0.9, y: Math.min(9.9, 2.6 + rows.length * 0.95), w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 15, italic: true, color: GREY, isTextBox: true, margin: 0 });
  }
  extrasAt("costs");
  // 7. Retainer
  if (copy.retainer?.length && !hide.retainer) {
    const s = light("Next: a monthly retainer");
    blockGrid(s, copy.retainer);
  }
  extrasAt("retainer");
  // 8. Support packages: the template's page 11 (tier headings in their colours, open table with rules)
  if (!hide.support && !fixedSlide("support")) {
    const s = light();
    s.addText("SUPPORT PACKAGES", { x: 0.64, y: 0.52, w: 15.25, h: 0.91, fontFace: FONT, fontSize: 44, bold: true, color: NAVY, valign: "middle", isTextBox: true, margin: 0 });
    s.addImage({ data: icon9, x: 17.16, y: 0.79, w: 0.66, h: 0.53 });
    s.addImage({ data: icon8, x: 18.04, y: 0.8, w: 0.53, h: 0.53 });
    s.addText([{ text: "These packages are designed to be used " }, { text: "as a starting point only", options: { bold: true } }, { text: ". Depending on your project's needs, a custom package will be created." }], { x: 0.64, y: 1.61, w: 18.17, h: 0.77, fontFace: FONT, fontSize: 20, color: INK, valign: "top", isTextBox: true, margin: 0 });
    const TIER = ["E4A315", "AFAFAF", "E3D42A"];
    const lab = (t) => ({ text: t, options: { bold: true, color: INDIGO } });
    const val = (t) => ({ text: t, options: { color: INK } });
    const rich = (b, t) => ({ text: [{ text: b, options: { bold: true } }, { text: t }], options: { color: INK } });
    const rows = [
      [{ text: "", options: {} }, ...["BRONZE SUPPORT", "SILVER SUPPORT", "GOLD SUPPORT"].map((t, i) => ({ text: t, options: { bold: true, fontSize: 24, color: TIER[i], border: [null, null, { type: "solid", pt: 1, color: INDIGO }, null] } }))],
      [lab("Included:"), val("All maintenance tasks needed to ensure your app or website is safe and secure. Plus reactive and proactive support as needed."), rich("Bronze plus:", " Weekly conference call with dedicated service delivery manager and monthly strategic meetings."), rich("Silver plus:", " half a day per month on-site visit and complimentary managed hosting.")],
      [lab("Support hours:"), val("9am – 5pm, Mon-Fri"), val("9am – 5pm, Mon-Fri"), val("9am – 5pm, Mon-Fri, plus emergency out of hours.")],
      [lab("Contractual SLA:"), val("8 Hour Resolution"), val("6 Hour Resolution"), val("4 Hour Resolution")],
      [lab("Min time included (with flex):"), val("1 Hour"), val("Half a day"), val("One day")],
      [lab("Out of Hours Support Available:"), val("Additional Cost £80 per hour"), val("Included as needed."), val("Included as needed.")],
      [lab("On-Going Rate:"), val("£80 per hour"), val("£80 per hour"), val("£80 per hour")],
      [lab(""), val("n/a"), val("Yes 10%"), val("Yes 15%")],
      [lab("Monthly Cost"), ...["£100.00 ex vat", "£375.00 ex vat", "£750.00 ex vat"].map((t) => ({ text: t, options: { bold: true, color: INK } }))],
    ];
    // Rules under the headings and above the monthly cost, as in the template; no other borders.
    rows.forEach((r, i) => r.forEach((c) => { c.options.border = i === 0 ? [null, null, { type: "solid", pt: 1, color: INDIGO }, null] : i === rows.length - 1 ? [{ type: "solid", pt: 1, color: INDIGO }, null, null, null] : [null, null, null, null]; }));
    s.addTable(rows, { x: 0.71, y: 2.48, w: 18.1, colW: [4.88, 4.37, 4.34, 4.51], rowH: [0.87, 2.04, 0.91, 0.87, 0.67, 0.71, 0.67, 0.87, 0.87], fontFace: FONT, fontSize: 20, valign: "middle", margin: [0.04, 0.1, 0.04, 0.04] });
  }
  extrasAt("support");
  // 9. Service retainer offering: the brand layout, staggered rows of service names (positions taken from the design, in px of a 1900px-wide slide)
  if (!hide.services && !fixedSlide("services")) {
    const s = pres.addSlide(); s.background = { data: bg };
    const px = W / 1900;
    s.addText("OUR SERVICE RETAINER OFFERING", { x: 0.9, y: 0.75, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 58, bold: true, color: TEAL, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText([{ text: "Here is a list of just some of the services ICL can offer you as part of your retainer. ", options: { color: WHITE } }, { text: "*", options: { color: TEAL, bold: true } }], { x: 0.9, y: 1.8, w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 20, align: "center", isTextBox: true, margin: 0 });
    const rows = [
      [333, [[273, "PLATFORMS"], [576, "APPS"], [862, "WEBSITES"], [1137, "SEO"], [1420, "BRANDING"], [1702, "PPC"]]],
      [480, [[284, "ANIMATION\nDESIGN"], [670, "BROCHURE\nDESIGN"], [1056, "CONTENT\nCREATION"], [1490, "PRESENTATION\nTEMPLATES"]]],
      [635, [[391, "HOSTING\nSOLUTIONS"], [786, "SOCIAL MEDIA\nGRAPHICS"], [1184, "CAMPAIGN\nSTRATEGY"], [1602, "COMPETITOR\nRESEARCH"]]],
      [798, [[265, "APP\nSUPPORT"], [597, "WEBSITE\nSUPPORT"], [941, "PLATFORM\nSUPPORT"], [1317, "EMAIL\nCAMPAIGNS"], [1682, "DIGITAL\nSTRATEGY"]]],
      [953, [[226, "POSTER\nDESIGN"], [657, "VIDEOGRAPHY &\nPHOTOGRAPHY"], [1156, "SOCIAL MEDIA\nCAMPAIGNS"], [1627, "SOFTWARE\nMANAGEMENT"]]],
    ];
    for (const [cy, items] of rows) for (const [cx, label] of items) {
      const w = 4.6, h = 1.3;
      s.addText(label, { x: cx * px - w / 2, y: cy * px - h / 2, w, h, fontFace: FONT, fontSize: 32, bold: true, color: WHITE, align: "center", valign: "middle", lineSpacingMultiple: 0.95, isTextBox: true, margin: 0 });
    }
    s.addText([{ text: "* ", options: { color: TEAL, bold: true } }, { text: "The services we provide will be limited to the days included in your package, and any extra days can be added at our standard day rate.", options: { color: WHITE } }], { x: 3, y: 11.05, w: W - 6, h: 0.85, fontFace: FONT, fontSize: 19, align: "center", valign: "middle", isTextBox: true, margin: 0 });
  }
  extrasAt("services");
  // 10. Packages: one slide per package group picked, otherwise the standard support packages
  if (!hide.packages) for (const g of picked.filter((x) => x.id !== "support")) {
    if (fixedSlide(g.id)) continue;
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
        { text: x.best, options: { fontSize: 16 * sz, italic: true, color: on ? "DCDCF5" : GREY, breakLine: true, paraSpaceAfter: 12 } },
        ...x.items.map((it, k) => ({ text: it, options: { fontSize: 16 * sz, color: fg, bullet: { indent: 18 }, paraSpaceAfter: 8, ...(k < x.items.length - 1 ? { breakLine: true } : {}) } })),
      ], { x: cx + 0.45, y: 3.8, w: cw - 0.9, h: 5.7, fontFace: FONT, valign: "top", fit: "shrink", isTextBox: true, margin: 0 });
    });
    s.addText(g.footnote, { x: 0.9, y: 9.95, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 14, italic: true, color: GREY, isTextBox: true, margin: 0 });
  }
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
