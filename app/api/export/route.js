import { fontLink, isEmbeddedIconFont, issueLabel, ISSUE_FILL, isFreeFontAwesome, freeRouteLabel, nextAction, mergeImageSizes, creditOnly, imageAdminLink, stockLibraryLink, stockLicenceSignal, isFontFixed, isImageFixed } from "@/lib/fontlink";
import ExcelJS from "exceljs";
import { AUTO_SIGNER, STATE_LABEL } from "@/lib/launchChecks";

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
  const { results = [], kind = "fonts", launch } = await request.json().catch(() => ({}));
  const wb = new ExcelJS.Workbook();
  wb.creator = "ICL Website Checker";
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
        fix: nextAction(f), task: isFontFixed(r, f) ? "Done" : "To do", owner: "" });
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
        task: isImageFixed(r, i) ? "Done" : "To do", owner: "" });
    }
  }
  const LO = { "Possible preview": 0, "Could not check": 1, "Likely licensed": 2 };
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
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.licence === "Likely licensed" ? "FFD4EDDA" : r.licence === "Possible preview" ? "FFF8D7DA" : "FFFFF3CD" } };
    if (r.libUrl) {
      row.getCell("lib").value = { text: `View on ${r.flag}`, hyperlink: r.libUrl };
      row.getCell("lib").font = { color: { argb: "FF1F4E79" }, underline: true };
    }
  });

  }

  if (kind === "launch" && launch) {
    // ---- Launch checklist for one site. Names come from a hidden sheet so the list can be any length.
    const names = [...(launch.team || []), AUTO_SIGNER];
    const ns = wb.addWorksheet("Names", { state: "veryHidden" });
    names.forEach((n, i) => { ns.getCell(i + 1, 1).value = n; });
    const signed = launch.signed || {};
    const rows = (launch.checks || []).map((c) => {
      const s = c.state === "pass" ? { name: AUTO_SIGNER, at: launch.scannedAt } : signed[c.id];
      return {
        section: c.section, owner: c.owner, check: c.title, result: STATE_LABEL[c.state] || c.state, state: c.state,
        details: [c.summary, ...(c.items || []).slice(0, 15).map((i) => `• ${i.text}`)].filter(Boolean).join("\n"),
        done: s ? "Yes" : "No", by: s?.name || "", date: s?.at ? new Date(s.at).toISOString().slice(0, 10) : "",
      };
    });
    const ws = sheet(wb, "Launch checklist", [
      { header: "Section", key: "section", width: 16 },
      { header: "Responsible", key: "owner", width: 18 },
      { header: "Check", key: "check", width: 48 },
      { header: "Automatic result", key: "result", width: 20 },
      { header: "Details", key: "details", width: 70 },
      { header: "Signed off", key: "done", width: 11 },
      { header: "Signed off by", key: "by", width: 24 },
      { header: "Date", key: "date", width: 12 },
    ], rows);
    ws.spliceRows(1, 0, [`Launch checklist: ${launch.url || launch.site}`], [`Scanned ${launch.scannedAt ? new Date(launch.scannedAt).toISOString().slice(0, 16).replace("T", " ") : ""}`]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(2).font = { color: { argb: "FF6B7280" } };
    ws.getRow(3).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 3 }];
    ws.autoFilter = undefined;
    const STATE_FILL = { pass: "FFD4EDDA", fail: "FFF8D7DA", review: "FFFFF3CD", manual: "FFE5E7EB" };
    rows.forEach((r, i) => {
      const row = ws.getRow(i + 4);
      row.alignment = { wrapText: true, vertical: "top" };
      const c = row.getCell(4);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATE_FILL[r.state] || "FFF1F1F1" } };
      c.font = { bold: true };
      row.getCell(6).dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No"'] };
      row.getCell(7).dataValidation = { type: "list", allowBlank: true, formulae: [`Names!$A$1:$A$${names.length}`] };
    });
    if (rows.length) {
      ws.addConditionalFormatting({ ref: `F4:F${rows.length + 3}`, rules: [
        { type: "cellIs", operator: "equal", formulae: ['"Yes"'], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD4EDDA" } }, font: { bold: true, color: { argb: "FF1E6B34" } } } },
        { type: "cellIs", operator: "equal", formulae: ['"No"'], priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF8D7DA" } }, font: { bold: true, color: { argb: "FF9B1C1C" } } } },
      ] });
    }
  }

  if (kind === "leads") {
    // ---- Website leads, same columns as the Client Matrix sheet.
    const STATUS = { new: "New", qualified: "Not contacted", "no-contact": "Contact not verified", contacted: "Contacted", cold: "Cold (no reply)", replied: "Replied", meeting: "Meeting", won: "Won", lost: "Lost", "not-pursuing": "Not pursuing" };
    const rows = (results || []).map((l) => ({
      business: l.business, area: l.area, website: l.website, problem: l.problem, problemDetail: l.problemDetail, companyNumber: l.companyNumber,
      netAssets: l.netAssets ?? "", reChange: l.reChange ?? "", likelihood: l.likelihood, likelihoodWhy: l.likelihoodWhy, background: l.background, pitch: l.pitch,
      caveats: [l.optedOut ? "OPTED OUT: do not contact" : "", l.contactUnverified ? "Contact not verified" : "", l.caveats].filter(Boolean).join("; "), status: STATUS[l.status] || l.status, notes: [l.notes, ...(l.notesLog || []).map((n) => `${new Date(n.at).toLocaleDateString("en-GB")}: ${n.text}`)].filter(Boolean).join("\n"), email: l.email ? `Subject: ${l.subject || ""}\n${l.email}` : "", emailAddress: l.emailAddress || l.emailNote || "",
    }));
    sheet(wb, "Qualified Leads", [
      { header: "Business", key: "business", width: 32 }, { header: "Area", key: "area", width: 16 }, { header: "Website", key: "website", width: 28 },
      { header: "Web presence", key: "problem", width: 16 }, { header: "Problem detail", key: "problemDetail", width: 36 }, { header: "CH #", key: "companyNumber", width: 10 },
      { header: "Net assets (£)", key: "netAssets", width: 14 }, { header: "RE change (£)", key: "reChange", width: 14 }, { header: "Likelihood", key: "likelihood", width: 11 },
      { header: "Likelihood rationale", key: "likelihoodWhy", width: 44 }, { header: "Background", key: "background", width: 36 }, { header: "Pitch angle", key: "pitch", width: 40 },
      { header: "Caveats", key: "caveats", width: 30 }, { header: "Status", key: "status", width: 14 }, { header: "Notes / next action", key: "notes", width: 36 },
      { header: "Outreach Email Drafted", key: "email", width: 70 }, { header: "Email Address", key: "emailAddress", width: 32 },
    ], rows);
  }

  if (kind === "client-images") {
    // ---- One client's stock images, written for the client to fill in and send back.
    const r = results[0] || {};
    const rows = [];
    for (const i of mergeImageSizes((r.images || []).filter((x) => x.flag && !/free/i.test(x.flag)))) {
      let name = i.url;
      try { name = decodeURIComponent(new URL(i.url).pathname.split("/").pop()); } catch {}
      // Excel allows one link per cell: link the most specific page (the homepage last).
      const pages = [...(i.pages?.length ? i.pages : i.page ? [i.page] : [])].sort((a, b) => { const pa = (() => { try { return new URL(a).pathname; } catch { return a; } })(); const pb = (() => { try { return new URL(b).pathname; } catch { return b; } })(); return (pb.length - pa.length) || pa.localeCompare(pb); });
      const sig = stockLicenceSignal(i);
      rows.push({ image: name, imageUrl: i.url, library: i.flag, libUrl: stockLibraryLink(i.url, i.flag), pageText: pages.map((u) => { try { return new URL(u).pathname || "/"; } catch { return u; } }).join("\n"), pageUrl: pages[0] || "",
        assessment: sig.status === "Likely licensed" ? "Likely licensed" : sig.status === "Possible preview" ? "May be a watermarked preview – worth checking" : "Could not tell",
        status: "", notes: "" });
    }
    rows.sort((a, b) => a.library.localeCompare(b.library) || a.image.localeCompare(b.image));
    const ws = sheet(wb, "Stock images", [
      { header: "Image", key: "image", width: 44 },
      { header: "From", key: "library", width: 16 },
      { header: "View on library", key: "lib", width: 22 },
      { header: "Used on", key: "pageText", width: 34 },
      { header: "Our assessment", key: "assessment", width: 34 },
      { header: "Status", key: "status", width: 26 },
      { header: "Notes", key: "notes", width: 36 },
    ], rows);
    ws.spliceRows(1, 0, [`Stock images on ${r.site || ""}`]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(2).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 2 }];
    ws.autoFilter = undefined;
    const STATES = ["Licensed", "Replace", "Remove", "Not sure"];
    rows.forEach((row, i) => {
      const x = ws.getRow(i + 3);
      x.alignment = { wrapText: true, vertical: "top" };
      x.getCell(1).value = { text: row.image, hyperlink: row.imageUrl };
      x.getCell(1).font = { color: { argb: "FF1F4E79" }, underline: true };
      if (row.libUrl) { x.getCell(3).value = { text: `View on ${row.library}`, hyperlink: row.libUrl }; x.getCell(3).font = { color: { argb: "FF1F4E79" }, underline: true }; }
      if (row.pageUrl) { x.getCell(4).value = { text: row.pageText, hyperlink: row.pageUrl }; x.getCell(4).font = { color: { argb: "FF1F4E79" }, underline: true }; }
      x.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: /Likely/.test(row.assessment) ? "FFD4EDDA" : /preview/.test(row.assessment) ? "FFF8D7DA" : "FFFFF3CD" } };
      x.getCell(6).dataValidation = { type: "list", allowBlank: true, formulae: [`"${STATES.join(",")}"`] };
    });
    if (rows.length) ws.addConditionalFormatting({ ref: `F3:F${rows.length + 2}`, rules: [
      { type: "cellIs", operator: "equal", formulae: ['"Licensed"'], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD4EDDA" } } } },
      { type: "cellIs", operator: "equal", formulae: ['"Replace"'], priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF3CD" } } } },
      { type: "cellIs", operator: "equal", formulae: ['"Remove"'], priority: 3, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF8D7DA" } } } },
    ] });
  }

  const buf = await wb.xlsx.writeBuffer();
  const file = kind === "leads" ? `website-leads-${today}.xlsx` : kind === "client-images" ? `stock-images-${String(results[0]?.site || "site").replace(/[^a-z0-9.-]/gi, "")}-${today}.xlsx` : kind === "launch" ? `launch-checklist-${String(launch?.site || "site").replace(/[^a-z0-9.-]/gi, "")}-${today}.xlsx` : kind === "images" ? `stock-image-licence-tasks-${today}.xlsx` : `font-licence-tasks-${today}.xlsx`;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
