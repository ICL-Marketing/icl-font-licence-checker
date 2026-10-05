import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType, BorderStyle } from "docx";
import { AUTO_SIGNER } from "@/lib/launchChecks";
import { storeConfigured, getSignoffs } from "@/lib/store";

export const dynamic = "force-dynamic";

// Word document recording who signed off each launch check, and when.
const fmt = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
};
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
  // Use the shared record when there is one, so the log can't be edited from a browser.
  if (storeConfigured() && b.site) {
    try { signed = (await getSignoffs(b.site)).signoffs; } catch {}
  }

  const OWNERS = ["Designer", "Developer", "Senior Developer", "Account Manager"];
  const ordered = [...checks].sort((x, y) => OWNERS.indexOf(x.owner) - OWNERS.indexOf(y.owner));
  const rows = ordered.map((c) => {
    const s = c.state === "pass" ? { name: AUTO_SIGNER, at: b.scannedAt } : signed[c.id];
    return [
      `${c.title}\n${c.section === "Launch actions" ? "On launch day" : "Before launch"}`,
      s ? { text: s.notRequired ? `Not required – ${s.name}` : s.name, fill: s.notRequired ? "E5E7EB" : "D4EDDA" } : { text: "Not signed off", fill: "F8D7DA" },
      s ? fmt(s.at) : "",
    ];
  });

  const doc = new Document({
    creator: "ICL Website Checker",
    title: `${b.mode === "post" ? "Post-launch" : "Launch"} sign-off log – ${b.site || ""}`,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${b.mode === "post" ? "Post-launch" : "Launch"} sign-off log` })] }),
        new Paragraph({ children: [new TextRun({ text: "Website: ", bold: true }), new TextRun(b.url || b.site || "")] }),
        new Paragraph({ children: [new TextRun({ text: "Scanned: ", bold: true }), new TextRun(fmt(b.scannedAt))] }),
        new Paragraph({ text: "" }),
        ...OWNERS.flatMap((who) => {
          const mine = rows.filter((_, i) => ordered[i].owner === who);
          const left = mine.filter((r) => r[1].text === "Not signed off").length;
          return [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`${who} – ${left ? `${left} not signed off` : "all signed off"}`)] }),
            table(["Check", "Signed off by", "Date and time"], mine, [60, 22, 18]),
            new Paragraph({ text: "" }),
          ];
        }),
        new Paragraph({ text: "" }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const file = `${b.mode === "post" ? "post-launch" : "launch"}-sign-off-log-${String(b.site || "site").replace(/[^a-z0-9.-]/gi, "")}-${new Date().toISOString().slice(0, 10)}.docx`;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
