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
    if (!r.status) continue;
    if (r.status === "UNREACHABLE") {
      fontRows.push({ site: r.site, status: "UNREACHABLE", font: "(site could not be scanned)", why: r.error || "",
        adobe: "", fix: r.fix || "Check the site by hand.", task: "To do", owner: "", notes: "", done: "" });
      continue;
    }
    for (const f of r.fonts || []) {
      if (f.status !== "PROBLEM" && f.status !== "CHECK") continue;
      fontRows.push({ site: r.site, status: f.status, font: f.family, why: f.note || "",
        adobe: f.adobe === "yes" ? "Yes" : f.adobe === "no" ? "No" : f.adobe ? "Not sure" : "",
        fix: f.fix || "", task: "To do", owner: "", notes: "", done: "" });
    }
  }
  const order = { PROBLEM: 0, CHECK: 1, UNREACHABLE: 2 };
  fontRows.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site));
  for (const r of fontRows) r.status = LABEL[r.status];

  const fonts = sheet(wb, "Fonts to fix", [
    { header: "Site", key: "site", width: 30 },
    { header: "Status", key: "status", width: 15 },
    { header: "Font", key: "font", width: 26 },
    { header: "Why", key: "why", width: 48 },
    { header: "On Adobe Fonts?", key: "adobe", width: 14 },
    { header: "Suggested fix", key: "fix", width: 60 },
    { header: "Task status", key: "task", width: 14 },
    { header: "Owner", key: "owner", width: 14 },
    { header: "Notes", key: "notes", width: 36 },
    { header: "Date done", key: "done", width: 12 },
  ], fontRows, "status");
  addTaskDropdown(fonts, "task", fontRows.length);

  // ---- Sheet 2: stock images to check. Only flagged images.
  const imgRows = [];
  for (const r of results) {
    if (r.imgStatus === "UNREACHABLE") {
      imgRows.push({ site: r.site, flag: "COULDN'T CHECK", image: "(site could not be scanned)", meta: r.imgError || "", fix: r.imgFix || "Check the site by hand.", task: "To do", owner: "", notes: "", done: "" });
      continue;
    }
    if (r.imgStatus !== "DONE") continue;
    for (const i of r.images || []) {
      if (!i.flag || /free/i.test(i.flag)) continue;
      let name = i.url;
      try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
      imgRows.push({ site: r.site, flag: i.flag, image: name, meta: i.meta || "",
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

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="font-licence-tasks-${today}.xlsx"`,
    },
  });
}
