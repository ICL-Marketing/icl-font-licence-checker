// Your own PowerPoint slides inside generated decks. The slides stay real, editable slides: each one is copied
// out of the uploaded .pptx with its layout, master, theme and images, and dropped into the deck at the right place.
// Runs in the browser (and in Node for tests) on top of JSZip.
import JSZip from "jszip";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const DROP = new Set([`${R}notesSlide`, `${R}notesMaster`, `${R}comments`, `${R}commentAuthors`, `${R}tags`, `${R}customXml`, "http://schemas.microsoft.com/office/2011/relationships/commentAuthors", "http://schemas.microsoft.com/office/2018/10/relationships/comments"]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const dir = (p) => p.slice(0, p.lastIndexOf("/"));
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const relsOf = (p) => `${dir(p)}/_rels/${base(p)}.rels`;
// "../media/x.png" from "ppt/slides/slide1.xml" -> "ppt/media/x.png"
function resolve(from, target) {
  if (target.startsWith("/")) return target.slice(1);
  const out = dir(from).split("/");
  for (const seg of target.split("/")) { if (seg === "..") out.pop(); else if (seg !== ".") out.push(seg); }
  return out.join("/");
}
// The relative target to write into a .rels file.
function relTarget(from, to) {
  const a = dir(from).split("/"), b = to.split("/");
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return "../".repeat(a.length) + b.join("/");
}
const parseRels = (xml) => [...(xml || "").matchAll(/<Relationship\b([^>]*)\/>/g)].map((m) => { const a = m[1]; const g = (k) => (a.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || ""; return { id: g("Id"), type: g("Type"), target: g("Target"), mode: g("TargetMode") }; });
const relsXml = (rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.mode ? ` TargetMode="${r.mode}"` : ""}/>`).join("")}</Relationships>`;
const text = (zip, p) => zip.file(p)?.async("string");
const maxNum = (zip, re) => Math.max(0, ...Object.keys(zip.files).map((f) => Number((f.match(re) || [])[1] || 0)));

// Slides of a package in the order they're shown, as { path, title } (title = the first words of text on the slide).
export async function listSlides(zip) {
  const pres = await text(zip, "ppt/presentation.xml");
  const rels = parseRels(await text(zip, "ppt/_rels/presentation.xml.rels"));
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
  const out = [];
  for (const id of ids) {
    const rel = rels.find((r) => r.id === id); if (!rel) continue;
    const path = resolve("ppt/presentation.xml", rel.target);
    const xml = (await text(zip, path)) || "";
    const words = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    out.push({ path, title: words.slice(0, 70) || "(no text)" });
  }
  return out;
}

// Copies slides from src into dst. picks: [{ slide: path in src, at: position in the final order }] where
// positions count the dst deck's existing slides from 0 (at: 2 = after the second existing slide).
// Small fixes to the uploaded slides as they're copied: the support packages table's discount row has no label.
function fixSlideText(xml) {
  return xml.replace(/<a:tr\b[\s\S]*?<\/a:tr>/g, (row) => {
    if (!/>n\/a</.test(row) || !/>Yes 10%/.test(row)) return row;
    return row.replace(/<a:tc>([\s\S]*?)<\/a:tc>/, (cell, inner) => (/<a:r>/.test(inner) ? cell
      : cell.replace(/<a:endParaRPr\b([^>]*)>([\s\S]*?)<\/a:endParaRPr>/, (m, attrs, kids) => `<a:r><a:rPr${attrs.replace(/\s*dirty="\d"/, "")}>${kids}</a:rPr><a:t>Discount?</a:t></a:r>${m}`)));
  });
}
export async function copySlides(src, dst, picks) {
  const ct = { src: await text(src, "[Content_Types].xml"), dst: await text(dst, "[Content_Types].xml") };
  const copied = new Map(); // src path -> dst path
  let nSlide = maxNum(dst, /^ppt\/slides\/slide(\d+)\.xml$/), nLayout = maxNum(dst, /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/), nMaster = maxNum(dst, /^ppt\/slideMasters\/slideMaster(\d+)\.xml$/), nTheme = maxNum(dst, /^ppt\/theme\/theme(\d+)\.xml$/);
  const newName = (p) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) return `ppt/slides/slide${++nSlide}.xml`;
    if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p)) return `ppt/slideLayouts/slideLayout${++nLayout}.xml`;
    if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p)) return `ppt/slideMasters/slideMaster${++nMaster}.xml`;
    if (/^ppt\/theme\/theme\d+\.xml$/.test(p)) return `ppt/theme/theme${++nTheme}.xml`;
    let cand = `${dir(p)}/tpl_${base(p)}`, n = 1;
    while (dst.file(cand) || [...copied.values()].includes(cand)) cand = `${dir(p)}/tpl${n++}_${base(p)}`;
    return cand;
  };
  // Content types for a copied part: its Override from the source, or the Default for its extension.
  const types = (srcPath, dstPath) => {
    const ov = ct.src.match(new RegExp(`<Override PartName="/${esc(srcPath)}" ContentType="([^"]+)"`));
    if (ov) { if (!ct.dst.includes(`PartName="/${dstPath}"`)) ct.dst = ct.dst.replace("</Types>", `<Override PartName="/${dstPath}" ContentType="${ov[1]}"/></Types>`); return; }
    const ext = base(dstPath).split(".").pop();
    if (!new RegExp(`<Default Extension="${esc(ext)}"`, "i").test(ct.dst)) {
      const def = ct.src.match(new RegExp(`<Default Extension="${esc(ext)}" ContentType="([^"]+)"`, "i"));
      ct.dst = ct.dst.replace("<Default", `<Default Extension="${ext}" ContentType="${def ? def[1] : "application/octet-stream"}"/><Default`);
    }
  };
  // Which layouts each master must keep (only the ones our slides use).
  const keepLayouts = new Map(); // master path -> Set(layout path)
  const layoutOf = async (slide) => { const r = parseRels(await text(src, relsOf(slide))).find((x) => x.type === `${R}slideLayout`); return r && resolve(slide, r.target); };
  const masterOf = async (layout) => { const r = parseRels(await text(src, relsOf(layout))).find((x) => x.type === `${R}slideMaster`); return r && resolve(layout, r.target); };
  for (const p of picks) { const l = await layoutOf(p.slide); const m = l && (await masterOf(l)); if (m) { if (!keepLayouts.has(m)) keepLayouts.set(m, new Set()); keepLayouts.get(m).add(l); } }

  // Copies one part and (recursively) everything it links to, rewriting its .rels on the way.
  async function copy(srcPath) {
    if (copied.has(srcPath)) return copied.get(srcPath);
    const dstPath = newName(srcPath);
    copied.set(srcPath, dstPath);
    const f = src.file(srcPath); if (!f) return dstPath;
    const isXml = /\.xml$/i.test(srcPath);
    let body = isXml ? await f.async("string") : await f.async("uint8array");
    if (/^ppt\/slides\/slide\d+\.xml$/.test(srcPath)) body = fixSlideText(body);
    const relsText = await text(src, relsOf(srcPath));
    if (relsText) {
      const out = [];
      const isMaster = /slideMasters\//.test(srcPath);
      for (const r of parseRels(relsText)) {
        if (DROP.has(r.type)) continue;
        if (r.mode === "External") { out.push(r); continue; }
        const target = resolve(srcPath, r.target);
        if (isMaster && r.type === `${R}slideLayout` && !keepLayouts.get(srcPath)?.has(target)) continue;
        out.push({ ...r, target: relTarget(dstPath, await copy(target)) });
      }
      if (isMaster) {
        // Only the layouts we kept stay listed on the master, each with a fresh unique id.
        const ids = new Set(out.filter((r) => r.type === `${R}slideLayout`).map((r) => r.id));
        body = body.replace(/<p:sldLayoutId\b[^>]*\/>/g, (tag) => (ids.has((tag.match(/r:id="([^"]+)"/) || [])[1]) ? tag : ""));
      }
      dst.file(relsOf(dstPath), relsXml(out));
    }
    dst.file(dstPath, body);
    types(srcPath, dstPath);
    return dstPath;
  }
  for (const p of picks) await copy(p.slide);

  // Register the new masters and slides with the presentation.
  let pres = await text(dst, "ppt/presentation.xml");
  const prels = parseRels(await text(dst, "ppt/_rels/presentation.xml.rels"));
  let rid = Math.max(0, ...prels.map((r) => Number((r.id.match(/\d+/) || [0])[0]))) ;
  // Master and layout ids must be unique across the whole deck (the existing masters' layout ids included).
  const idsIn = (xml) => [...(xml || "").matchAll(/<p:sld(?:Master|Layout)Id\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  let bigId = Math.max(2147483648, ...idsIn(pres));
  for (const f of Object.keys(dst.files)) if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f) && ![...copied.values()].includes(f)) bigId = Math.max(bigId, ...idsIn(await text(dst, f)));
  for (const [s, d] of copied) if (/slideMasters\//.test(s)) {
    const id = `rId${++rid}`;
    prels.push({ id, type: `${R}slideMaster`, target: relTarget("ppt/presentation.xml", d) });
    pres = pres.replace("</p:sldMasterIdLst>", `<p:sldMasterId id="${++bigId}" r:id="${id}"/></p:sldMasterIdLst>`);
    // Layout ids on the copied master must be unique in the whole deck too.
    let xml = await text(dst, d);
    xml = xml.replace(/(<p:sldLayoutId\b[^>]*\bid=")\d+(")/g, (m, a, b) => `${a}${++bigId}${b}`);
    dst.file(d, xml);
  }
  const existing = [...pres.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => m[0]);
  let sldNum = Math.max(255, ...existing.map((t) => Number((t.match(/\bid="(\d+)"/) || [0, 0])[1])));
  const inserts = picks.map((p) => { const id = `rId${++rid}`; prels.push({ id, type: `${R}slide`, target: relTarget("ppt/presentation.xml", copied.get(p.slide)) }); return { at: p.at, tag: `<p:sldId id="${++sldNum}" r:id="${id}"/>` }; });
  const order = [];
  for (let i = 0; i <= existing.length; i++) { for (const ins of inserts) if (ins.at === i) order.push(ins.tag); if (i < existing.length) order.push(existing[i]); }
  for (const ins of inserts) if (ins.at > existing.length) order.push(ins.tag);
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${order.join("")}</p:sldIdLst>`);
  dst.file("ppt/presentation.xml", pres);
  dst.file("ppt/_rels/presentation.xml.rels", relsXml(prels));
  dst.file("[Content_Types].xml", ct.dst);
  return dst;
}

// A package holding only the chosen slides (in that order), built from an uploaded .pptx.
export async function pruneTemplate(srcZip, slidePaths, shellBlob) {
  const dst = await JSZip.loadAsync(shellBlob);
  await copySlides(srcZip, dst, slidePaths.map((slide, i) => ({ slide, at: i })));
  // An empty shell deck leaves its own master and layout out of the content types; declare them so the file is whole.
  let ct = await dst.file("[Content_Types].xml").async("string");
  for (const f of Object.keys(dst.files)) {
    const kind = /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f) ? "slideMaster" : /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) ? "slideLayout" : "";
    if (kind && !ct.includes(`PartName="/${f}"`)) ct = ct.replace("</Types>", `<Override PartName="/${f}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/></Types>`);
  }
  dst.file("[Content_Types].xml", ct);
  return dst.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ---- Storage: the pruned template is kept in the shared store in pieces, with a small description in Settings.
export const TEMPLATE_KEY = "deck-template";
// Where an extra slide can go in the deck.
export const ANCHORS = [["cover", "After the cover"], ["background", "After the background"], ["wins", "After the biggest wins"], ["ideas", "After the idea slides"], ["costs", "After the effort and costs tables"], ["retainer", "After the retainer pitch"], ["support", "After the support packages"], ["services", "After the service offering"], ["packages", "After the package slides (before the closing)"]];
const CHUNK = 600000; // characters of base64 per piece: inside the store's request limit
const toB64 = (blob) => new Promise((ok, bad) => { const r = new FileReader(); r.onerror = bad; r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
export async function saveTemplate(blob, slots, name, onProgress, extras = []) {
  const b64 = await toB64(blob);
  const parts = Math.ceil(b64.length / CHUNK);
  for (let i = 0; i < parts; i++) {
    const r = await fetch("/api/template", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: i, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) }) }).then((x) => x.json()).catch(() => ({}));
    if (!r.shared) throw new Error(r.error || "Couldn't save to the shared store");
    onProgress?.(i + 1, parts);
  }
  const meta = { parts, size: blob.size, slots, extras, name, at: new Date().toISOString() };
  const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: TEMPLATE_KEY, value: meta }) }).then((x) => x.json()).catch(() => ({}));
  if (!r.shared) throw new Error(r.error || "Couldn't save the template details");
  return meta;
}
export async function templateMeta() {
  const j = await fetch(`/api/settings?key=${TEMPLATE_KEY}`).then((r) => r.json()).catch(() => ({}));
  return j.shared && j.value?.parts ? j.value : null;
}
// The stored template as a JSZip, with its slot -> slide path map; null when none is uploaded.
export async function loadTemplate() {
  const meta = await templateMeta();
  if (!meta) return null;
  const pieces = await Promise.all([...Array(meta.parts)].map((_, i) => fetch(`/api/template?part=${i}`).then((r) => r.json()).then((j) => j.data || "")));
  const bin = atob(pieces.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);
  const slides = await listSlides(zip);
  const paths = {};
  for (const [slot, n] of Object.entries(meta.slots || {})) if (slides[n]) paths[slot] = slides[n].path;
  (meta.extras || []).forEach((e, i) => { if (slides[e.index]) paths[`extra:${i}`] = slides[e.index].path; });
  return { zip, slots: paths, extras: meta.extras || [], meta };
}
