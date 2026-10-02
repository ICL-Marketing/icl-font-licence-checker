import ExcelJS from "exceljs";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const FILL = { PROBLEM: "FFF8D7DA", CHECK: "FFFFF3CD", UNREACHABLE: "FFE8DAEF", OK: "FFD4EDDA", SYSTEM: "FFE2E3E5" };

function addSheet(wb, name, columns, rows, statusKey) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const row = ws.addRow(r);
    const st = statusKey ? r[statusKey] : null;
    if (st && FILL[st]) {
      row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[st] } }; });
    }
    row.alignment = { wrapText: true, vertical: "top" };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function POST(request) {
  const { results = [] } = await request.json().catch(() => ({}));
  const wb = new ExcelJS.Workbook();
  wb.creator = "ICL font licence checker";

  addSheet(wb, "Summary", [
    { header: "Site", key: "site", width: 32 },
    { header: "Overall", key: "status", width: 10 },
    { header: "Platform", key: "platform", width: 20 },
    { header: "HTTP", key: "http", width: 7 },
    { header: "Final URL", key: "finalUrl", width: 36 },
    { header: "Problems", key: "problems", width: 9 },
    { header: "To check", key: "checks", width: 9 },
    { header: "OK", key: "oks", width: 6 },
    { header: "Problem fonts", key: "problemFonts", width: 40 },
    { header: "Fonts to check", key: "checkFonts", width: 40 },
    { header: "Stock-image flags", key: "stock", width: 10 },
    { header: "Stock libraries", key: "stockLibs", width: 24 },
    { header: "Error", key: "error", width: 30 },
    { header: "Suggested fix (site)", key: "fix", width: 60 },
  ], results.map((r) => {
    const by = (s) => (r.fonts || []).filter((f) => f.status === s);
    const stock = (r.images || []).filter((i) => i.flag);
    return {
      site: r.site, status: r.status, platform: r.platform || "", http: r.http, finalUrl: r.finalUrl || "",
      problems: by("PROBLEM").length, checks: by("CHECK").length, oks: by("OK").length,
      problemFonts: [...new Set(by("PROBLEM").map((f) => f.family))].join("; ").slice(0, 400),
      checkFonts: [...new Set(by("CHECK").map((f) => f.family))].join("; ").slice(0, 400),
      stock: stock.length, stockLibs: [...new Set(stock.map((i) => i.flag))].join("; ").slice(0, 200),
      error: r.error || "",
      fix: r.fix || (by("PROBLEM")[0]?.fix) || (by("CHECK")[0]?.fix) || "",
    };
  }), "status");

  addSheet(wb, "Fonts", [
    { header: "Site", key: "site", width: 28 },
    { header: "Status", key: "status", width: 10 },
    { header: "Font family", key: "family", width: 28 },
    { header: "How loaded", key: "kind", width: 16 },
    { header: "Hosted on", key: "hostedOn", width: 18 },
    { header: "Font URL", key: "source", width: 50 },
    { header: "Other files (same family)", key: "otherFiles", width: 10 },
    { header: "Why", key: "note", width: 45 },
    { header: "Suggested fix", key: "fix", width: 60 },
    { header: "Copyright (from file)", key: "copyright", width: 40 },
    { header: "Manufacturer", key: "manufacturer", width: 22 },
    { header: "Designer", key: "designer", width: 22 },
    { header: "Licence text (from file)", key: "licence", width: 40 },
    { header: "Licence URL", key: "licenceUrl", width: 30 },
    { header: "Vendor ID", key: "vendorId", width: 8 },
    { header: "Declared in CSS", key: "css", width: 40 },
    { header: "Found on pages", key: "foundOn", width: 40 },
  ], results.flatMap((r) => (r.fonts || []).map((f) => ({
    site: r.site, status: f.status, family: f.family, kind: f.kind, hostedOn: f.hostedOn || "",
    source: f.source, otherFiles: f.otherFiles || 0, note: f.note || "", fix: f.fix || "",
    copyright: f.meta?.copyright || "", manufacturer: f.meta?.manufacturer || "", designer: f.meta?.designer || "",
    licence: f.meta?.licence || "", licenceUrl: f.meta?.licenceUrl || "", vendorId: f.meta?.vendorId || "",
    css: f.css || "", foundOn: (f.foundOn || []).slice(0, 3).join(", "),
  }))), "status");

  addSheet(wb, "Images", [
    { header: "Site", key: "site", width: 28 },
    { header: "Flag", key: "flag", width: 26 },
    { header: "Image URL", key: "url", width: 70 },
    { header: "Embedded copyright / credit metadata", key: "meta", width: 70 },
  ], results.flatMap((r) => (r.images || []).map((i) => ({ site: r.site, flag: i.flag, url: i.url, meta: i.meta }))));

  addSheet(wb, "Font families in CSS", [
    { header: "Site", key: "site", width: 28 },
    { header: "font-family values seen", key: "fams", width: 140 },
  ], results.map((r) => ({ site: r.site, fams: (r.familiesInCss || []).join(", ") })));

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="font-licence-report-${stamp}.xlsx"`,
    },
  });
}
