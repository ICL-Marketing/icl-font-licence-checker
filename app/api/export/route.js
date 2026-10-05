import { fontLink, isEmbeddedIconFont, issueLabel, ISSUE_FILL, isFreeFontAwesome, freeRouteLabel, nextAction, mergeImageSizes, creditOnly, imageAdminLink, stockLibraryLink, stockLicenceSignal } from "@/lib/fontlink";
import ExcelJS from "exceljs";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// The workbook is a task tracker: only outstanding items, one sheet per task.
const FILL = { "PROBLEM": "FFF8D7DA", "CHECK": "FFFFF3CD", "COULDN'T CHECK": "FFE8DAEF" };
const LABEL = { PROBLEM: "PROBLEM", CHECK: "CHECK", UNREACHABLE: "COULDN'T CHECK" };
const TASK_STATES = ["To do", "In progress", "Done", "Not an issue"];

function sheet(wb, name, columns, rows, statusKey) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1F1" } };
  for (const r of rows) {
    const row = ws.addRow(r);
    row.alignment = { wrapText: true, vertical: "top" };
    if (statusKey && FILL[r[statusKey]]) {
      const c = row.getCell(statusKey);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r[statusKey]] } };
      c.font = { bold: true };
    }
  }
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  return ws;
}

// Colours follow the chosen value, so they update when someone changes the dropdown.
const TASK_COLOURS = {
  "To do": { fill: "FFF8D7DA", font: "FF9B1C1C" },
  "In progress": { fill: "FFFFF3CD", font: "FF8A5A00" },
  "Done": { fill: "FFD4EDDA", font: "FF1E6B34" },
  "Not an issue": { fill: "FFE5E7EB", font: "FF4B5563" },
};

function addTaskDropdown(ws, colKey, rowCount) {
  const col = ws.getColumn(colKey).number;
  for (let i = 2; i <= rowCount + 1; i++) {
    ws.getCell(i, col).dataValidation = { type: "list", allowBlank: false, formulae: [`"${TASK_STATES.join(",")}"`] };
  }
  if (!rowCount) return;
  const letter = ws.getColumn(colKey).letter;
  const ref = `${letter}2:${letter}${rowCount + 1}`;
  ws.addConditionalFormatting({
    ref,
    rules: Object.entries(TASK_COLOURS).map(([value, c], idx) => ({
      type: "cellIs", operator: "equal", formulae: [`"${value}"`], priority: idx + 1,
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: c.fill } },
        font: { bold: true, color: { argb: c.font } },
      },
    })),
  });
}

export async function POST(request) {
  const { results = [], kind = "fonts" } = await request.json().catch(() => ({}));
  const wb = new ExcelJS.Workbook();
  wb.creator = "ICL Licence Checker";
  const today = new Date().toISOString().slice(0, 10);

  if (kind === "fonts") {
  // ---- Sheet 1: fonts to fix. One row per outstanding font, plus one per site that couldn't be checked.
  const fontRows = [];
  for (const r of results) {
    if (!r.status || r.status === "UNREACHABLE") continue;
    for (const f of r.fonts || []) {
      if (f.status !== "PROBLEM" && f.status !== "CHECK") continue;
      if (isEmbeddedIconFont(f) || isFreeFontAwesome(f)) continue;
      const free = freeRouteLabel(f);
      fontRows.push({ site: r.site, status: f.status, issue: issueLabel(f), font: f.family, styles: (f.styles || []).join(", "), why: f.note || "",
        free, freeOk: free !== "N/A",
        siteUrl: r.finalUrl || `https://${r.site}`, fontUrl: fontLink(f),
        fix: nextAction(f), task: "To do", owner: "" });
    }
  }
  const order = { PROBLEM: 0, CHECK: 1, UNREACHABLE: 2 };
  fontRows.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site));
  // Free fixes first (we sort those ourselves), then the rest by severity.
  const issueOrder = Object.keys(ISSUE_FILL);
  fontRows.sort((a, b) => issueOrder.indexOf(a.issue) - issueOrder.indexOf(b.issue) || a.site.localeCompare(b.site));
  for (const r of fontRows) r.status = r.issue;

  const fonts = sheet(wb, "Fonts to fix", [
    { header: "Site", key: "site", width: 30 },
    { header: "Status", key: "status", width: 24 },
    { header: "Font", key: "font", width: 24 },
    { header: "Styles", key: "styles", width: 22 },
    { header: "Why", key: "why", width: 48 },
    { header: "Free route", key: "free", width: 20 },
    { header: "Adobe Embed/Next Action", key: "fix", width: 60 },
    { header: "Task status", key: "task", width: 14 },
    { header: "Owner", key: "owner", width: 14 },
  ], fontRows, "status");
  addTaskDropdown(fonts, "task", fontRows.length);
  fonts.eachRow((row, i) => {
    if (i === 1) return;
    const r = fontRows[i - 2];
    if (!r) return;
    const st = row.getCell("status");
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ISSUE_FILL[r.issue] || "FFF1F1F1" } };
    st.font = { bold: true };
    // Site and font cells link to the live site and the font file.
    row.getCell("site").value = { text: r.site, hyperlink: r.siteUrl };
    row.getCell("site").font = { color: { argb: "FF1F4E79" }, underline: true };
    if (r.fontUrl && /^https?:/.test(r.fontUrl)) {
      row.getCell("font").value = { text: r.font, hyperlink: r.fontUrl };
      row.getCell("font").font = { color: { argb: "FF1F4E79" }, underline: true };
    }
    if (r.freeOk) {
      const c = row.getCell("free");
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
      c.font = { bold: true, color: { argb: "FF1E8449" } };
    }
  });

  }

  if (kind === "images") {
  // ---- Stock images to check. Only flagged images, size variants merged.
  const imgRows = [];
  for (const r of results) {
    if (r.imgStatus !== "DONE") continue;
    for (const i of mergeImageSizes((r.images || []).filter((x) => x.flag && !/free/i.test(x.flag)))) {
      let name = i.url;
      try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
      if (i.sizes > 1) name += ` (+${i.sizes - 1} other size${i.sizes === 2 ? "" : "s"})`;
      imgRows.push({ site: r.site, siteUrl: r.finalUrl || `https://${r.site}`, imageUrl: imageAdminLink(i.url), libUrl: stockLibraryLink(i.url, i.flag), flag: i.flag,
        licence: stockLicenceSignal(i).status, licenceWhy: stockLicenceSignal(i).reason, image: name, meta: creditOnly(i.meta),
        pages: (i.pages || []).map((u) => { try { return new URL(u).pathname || "/"; } catch { return u; } }).join("\n"),
        fix: "Find the purchase record or licence for this image. If none, replace it or buy a licence.",
        task: "To do", owner: "" });
    }
  }
  const LO = { "Possible watermarked preview": 0, "Unconfirmed": 1, "Likely licensed": 2 };
  imgRows.sort((a, b) => a.site.localeCompare(b.site) || LO[a.licence] - LO[b.licence]);
  const imgs = sheet(wb, "Stock images to check", [
    { header: "Site", key: "site", width: 30 },
    { header: "Library", key: "flag", width: 24 },
    { header: "Image", key: "image", width: 40 },
    { header: "Licence check", key: "licence", width: 22 },
    { header: "Why", key: "licenceWhy", width: 36 },
    { header: "Check on library", key: "lib", width: 20 },
    { header: "Found on", key: "pages", width: 36 },
    { header: "Credit / copyright", key: "meta", width: 28 },
    { header: "Next action", key: "fix", width: 48 },
    { header: "Task status", key: "task", width: 14 },
    { header: "Owner", key: "owner", width: 14 },
  ], imgRows);
  addTaskDropdown(imgs, "task", imgRows.length);
  imgs.eachRow((row, i) => {
    if (i === 1) return;
    const r = imgRows[i - 2];
    if (!r) return;
    row.getCell("site").value = { text: r.site, hyperlink: r.siteUrl };
    row.getCell("site").font = { color: { argb: "FF1F4E79" }, underline: true };
    row.getCell("image").value = { text: r.image, hyperlink: r.imageUrl };
    row.getCell("image").font = { color: { argb: "FF1F4E79" }, underline: true };
    const lc = row.getCell("licence");
    lc.font = { bold: true };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.licence === "Likely licensed" ? "FFD4EDDA" : r.licence === "Possible watermarked preview" ? "FFF8D7DA" : "FFFFF3CD" } };
    if (r.libUrl) {
      row.getCell("lib").value = { text: `View on ${r.flag}`, hyperlink: r.libUrl };
      row.getCell("lib").font = { color: { argb: "FF1F4E79" }, underline: true };
    }
  });

  }

  const buf = await wb.xlsx.writeBuffer();
  const file = kind === "images" ? `stock-image-licence-tasks-${today}.xlsx` : `font-licence-tasks-${today}.xlsx`;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
