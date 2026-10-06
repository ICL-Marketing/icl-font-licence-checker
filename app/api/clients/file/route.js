import ExcelJS from "exceljs";
import { normaliseClients, CLIENT_FIELDS } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS = { name: "Client", websites: "Website(s)", manager: "Account Manager", poc: "POC", emails: "Email Address", phone: "Contact No", type: "Type", notes: "Notes" };
const cellText = (c) => { const x = c?.value; if (x == null) return ""; if (typeof x === "object") return x.text || x.result || (x.richText ? x.richText.map((r) => r.text).join("") : String(x)); return String(x); };

// POST: an uploaded .xlsx (the Web Clients sheet or one exported from here) -> client rows.
export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return Response.json({ error: "Upload an .xlsx file" }, { status: 400 });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()));
    const ws = wb.getWorksheet("Clients") || wb.worksheets[0];
    const rows = [];
    let header = null;
    ws.eachRow((r) => {
      const vals = r.values.slice(1).map((v) => cellText({ value: v }));
      if (!header) {
        if (vals.some((v) => /^client/i.test(v.trim()))) header = vals.map((v) => v.trim().toLowerCase());
        return;
      }
      const o = {};
      header.forEach((h, i) => { o[h] = vals[i] || ""; });
      rows.push({ name: o.client || o["client "] || o.name, websites: o["website(s)"] || o.websites || o.website, manager: o["account manager"], poc: o.poc, emails: o["email address"] || o.emails || o.email, phone: o["contact no"] || o.phone, type: o.type, notes: [o.notes, o.notes2].filter(Boolean).join("; ") });
    });
    return Response.json({ clients: normaliseClients(rows), sheet: ws.name, rows: rows.length });
  } catch (e) {
    return Response.json({ error: `Could not read the spreadsheet: ${e?.message || e}` }, { status: 400 });
  }
}

// PUT: client rows -> .xlsx download (same layout, so it can be edited and imported again).
export async function PUT(request) {
  const b = await request.json().catch(() => ({}));
  const clients = normaliseClients(b.clients || []);
  const wb = new ExcelJS.Workbook();
  wb.creator = "ICL Website Checker";
  const ws = wb.addWorksheet("Clients", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = CLIENT_FIELDS.map((k) => ({ header: HEADERS[k], key: k, width: k === "emails" ? 44 : k === "websites" ? 30 : k === "notes" ? 30 : 20 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1F1" } };
  for (const c of clients) ws.addRow({ ...c, websites: c.websites.join(" | "), emails: c.emails.join(" | ") });
  if (clients.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: clients.length + 1, column: CLIENT_FIELDS.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="web-clients-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
}
