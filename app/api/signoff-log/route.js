import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType, BorderStyle } from "docx";
import { AUTO_SIGNER, STATE_LABEL } from "@/lib/launchChecks";
import { storeConfigured, getSignoffs } from "@/lib/store";

export const dynamic = "force-dynamic";

// Word document recording who signed off each launch check, and when.
const fmt = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
};
const FILL = { pass: "D4EDDA", fail: "F8D7DA", review: "FFF3CD", manual: "E5E7EB" };
const border = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, { bold = false, fill, width } = {}) {
  return new TableCell({
    borders,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: String(text ?? "").split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, bold, size: 18 })] })),
  });
}
function table(header, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, fill: "F1F1F1", width: widths[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => (typeof c === "object" && c ? cell(c.text, { ...c, width: widths[i] }) : cell(c, { width: widths[i] }))) })),
    ],
  });
}

export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const checks = Array.isArray(b.checks) ? b.checks : [];
  let signed = b.signed || {};
  let log = Array.isArray(b.log) ? b.log : [];
  // Use the shared record when there is one, so the log can't be edited from a browser.
  if (storeConfigured() && b.site) {
    try { const s = await getSignoffs(b.site); signed = s.signoffs; log = s.log; } catch {}
  }

  const done = checks.filter((c) => c.state === "pass" || signed[c.id]).length;
  const OWNERS = ["Designer", "Developer", "Senior Developer", "Account Manager"];
  const ordered = [...checks].sort((x, y) => OWNERS.indexOf(x.owner) - OWNERS.indexOf(y.owner));
  const rows = ordered.map((c) => {
    const s = c.state === "pass" ? { name: AUTO_SIGNER, at: b.scannedAt } : signed[c.id];
    return [
      `${c.title}\n${c.owner} · ${c.section === "Launch actions" ? "On launch day" : "Before launch"}`,
      { text: STATE_LABEL[c.state] || c.state, fill: FILL[c.state] },
      s ? s.name : { text: "Not signed off", fill: "F8D7DA" },
      s ? fmt(s.at) : "",
    ];
  });
  const autoEntries = checks.filter((c) => c.state === "pass").map((c) => ({ at: b.scannedAt, check: c.title, action: "Passed automatically", name: AUTO_SIGNER }));
  const history = [...autoEntries, ...log].sort((x, y) => String(x.at).localeCompare(String(y.at)));

  const doc = new Document({
    creator: "ICL Website Checker",
    title: `Launch sign-off log – ${b.site || ""}`,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Launch sign-off log" })] }),
        new Paragraph({ children: [new TextRun({ text: "Website: ", bold: true }), new TextRun(b.url || b.site || "")] }),
        new Paragraph({ children: [new TextRun({ text: "Scanned: ", bold: true }), new TextRun(fmt(b.scannedAt))] }),
        new Paragraph({ children: [new TextRun({ text: "Log generated: ", bold: true }), new TextRun(fmt(new Date().toISOString()))] }),
        new Paragraph({ children: [new TextRun({ text: "Completed: ", bold: true }), new TextRun(`${done} of ${checks.length} checks${done === checks.length ? " – ready to launch" : ""}`)] }),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Checklist")] }),
        ...OWNERS.flatMap((who) => {
          const mine = rows.filter((_, i) => ordered[i].owner === who);
          const left = mine.filter((r) => typeof r[2] === "object").length;
          return [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`${who} – ${left ? `${left} not signed off` : "all signed off"}`)] }),
            table(["Check", "Automatic result", "Signed off by", "Date and time"], mine, [52, 16, 18, 14]),
            new Paragraph({ text: "" }),
          ];
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sign-off history")] }),
        new Paragraph({ children: [new TextRun({ text: "Every sign-off, change and removal, oldest first.", italics: true, size: 18 })] }),
        history.length
          ? table(["Date and time", "Check", "Action", "Name"], history.map((h) => [fmt(h.at), h.check || h.checkId, h.action, h.name]), [18, 46, 18, 18])
          : new Paragraph({ text: "No sign-offs yet." }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const file = `launch-sign-off-log-${String(b.site || "site").replace(/[^a-z0-9.-]/gi, "")}-${new Date().toISOString().slice(0, 10)}.docx`;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
