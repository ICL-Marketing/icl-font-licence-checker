import { fontLink, isEmbeddedIconFont, fixedFix, issueLabel, ISSUE_FILL } from "@/lib/fontlink";
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

function addTaskDropdown(ws, colKey, rowCount) {
  const col = ws.getColumn(colKey).number;
  for (let i = 2; i <= rowCount + 1; i++) {
    ws.getCell(i, col).dataValidation = { type: "list", allowBlank: false, formulae: [`"${TASK_STATES.join(",")}"`] };
  }
}

export async function POST(request) {
  const { results = [] } = await request.json().catch(() => ({}));
  const wb = new ExcelJS.Workbook();
  wb.creator = "ICL font licence checker";
  const today = new Date().toISOString().slice(0, 10);

  // ---- Sheet 1: fonts to fix. One row per outstanding font, plus one per site that couldn't be checked.
  const fontRows = [];
  for (const r of results) {
    if (!r.status || r.status === "UNREACHABLE") continue;
    for (const f of r.fonts || []) {
      if (f.status !== "PROBLEM" && f.status !== "CHECK") continue;
      if (isEmbeddedIconFont(f)) continue;
      fontRows.push({ site: r.site, status: f.status, issue: issueLabel(f), font: f.family, why: f.note || "",
        free: f.status !== "PROBLEM" || f.kind === "Hosted service" ? "" : (f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) ? "Adobe Fonts" : f.google === "yes" ? "Google Fonts" : f.freeVersion?.isFree ? `Free version: ${f.freeVersion.note}` : f.adobe === "no" ? "None found" : "Not sure: check Adobe / Google / Font Squirrel",
        freeOk: f.status === "PROBLEM" && ((f.adobe === "yes" || /^Adobe font installed as files/.test(f.note || "")) || f.google === "yes" || !!f.freeVersion?.isFree),
        siteUrl: r.finalUrl || `https://${r.site}`, fontUrl: fontLink(f),
        fix: fixedFix(f), task: "To do", owner: "", notes: "", done: "" });
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
    { header: "Font", key: "font", width: 26 },
    { header: "Why", key: "why", width: 48 },
    { header: "Free route", key: "free", width: 40 },
    { header: "Suggested fix", key: "fix", width: 60 },
    { header: "Task status", key: "task", width: 14 },
    { header: "Owner", key: "owner", width: 14 },
    { header: "Notes", key: "notes", width: 36 },
    { header: "Date done", key: "done", width: 12 },
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

  // ---- Sheet 2: stock images to check. Only flagged images.
  const imgRows = [];
  for (const r of results) {
    if (r.imgStatus !== "DONE") continue;
    for (const i of r.images || []) {
      if (!i.flag || /free/i.test(i.flag)) continue;
      let name = i.url;
      try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
      imgRows.push({ site: r.site, siteUrl: r.finalUrl || `https://${r.site}`, imageUrl: i.url, flag: i.flag, image: name, meta: i.meta || "",
        fix: /free/i.test(i.flag) ? "Free library: no licence needed, but check attribution rules." : "Find the purchase record / licence for this image. If none, replace it or buy a licence.",
        task: "To do", owner: "", notes: "", done: "" });
    }
  }
  imgRows.sort((a, b) => a.site.localeCompare(b.site));
  const imgs = sheet(wb, "Stock images to check", [
    { header: "Site", key: "site", width: 30 },
    { header: "Library", key: "flag", width: 24 },
    { header: "Image", key: "image", width: 40 },
    { header: "Embedded credit / copyright", key: "meta", width: 44 },
    { header: "Suggested fix", key: "fix", width: 50 },
    { header: "Task status", key: "task", width: 14 },
    { header: "Owner", key: "owner", width: 14 },
    { header: "Notes", key: "notes", width: 36 },
    { header: "Date done", key: "done", width: 12 },
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
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="font-licence-tasks-${today}.xlsx"`,
    },
  });
}
