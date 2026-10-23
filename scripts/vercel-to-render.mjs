// Copies the app's settings (API keys etc.) from Vercel into the Render service, then redeploys it.
//
//   1. npx vercel login                      (once)
//   2. npx vercel link                       (pick the icl-sales / icl-font-licence-checker project)
//   3. npx vercel env pull .env.render --environment=production
//   4. RENDER_API_KEY=rnd_xxx node scripts/vercel-to-render.mjs .env.render
//
// Render API key: Render → Account settings → API keys. Nothing is printed except key names.
// Vercel never gives back values marked "Sensitive": those come through empty and are listed at the end
// so you can copy them from each provider instead. Existing Render values are only replaced when Vercel
// has a value for that key, so nothing you added on Render is wiped.
import fs from "node:fs";

const file = process.argv[2] || ".env.render";
const SERVICE = process.env.RENDER_SERVICE || "icl-sales";
const KEY = process.env.RENDER_API_KEY;
if (!KEY) { console.error("Set RENDER_API_KEY first (Render → Account settings → API keys)."); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`No ${file}. Run: npx vercel env pull ${file} --environment=production`); process.exit(1); }

// Vercel's own build and deploy details aren't settings for the app.
const SKIP = /^(VERCEL|VERCEL_.*|TURBO_.*|NX_.*|NEXT_PUBLIC_BUILD|NEXT_PUBLIC_BUILT_AT)$/;
const vars = {};
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m || SKIP.test(m[1])) continue;
  let v = m[2];
  if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
  vars[m[1]] = v;
}

const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.render.com/v1${path}`, { ...opts, headers: { authorization: `Bearer ${KEY}`, accept: "application/json", "content-type": "application/json" } });
  if (!r.ok) throw new Error(`Render ${opts.method || "GET"} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const found = (await api(`/services?name=${encodeURIComponent(SERVICE)}&limit=20`)).map((x) => x.service).filter((s) => s.name === SERVICE);
if (found.length !== 1) { console.error(`Expected one Render service called "${SERVICE}", found ${found.length}. Set RENDER_SERVICE to its name.`); process.exit(1); }
const id = found[0].id;

const copied = [], empty = [];
for (const [k, v] of Object.entries(vars)) {
  if (!v) { empty.push(k); continue; }
  await api(`/services/${id}/env-vars/${encodeURIComponent(k)}`, { method: "PUT", body: JSON.stringify({ value: v }) });
  copied.push(k);
}
console.log(`Copied ${copied.length} to Render: ${copied.join(", ") || "none"}`);
if (empty.length) console.log(`\nEmpty in Vercel (marked Sensitive), add these by hand in Render → ${SERVICE} → Environment:\n  ${empty.join("\n  ")}`);
if (copied.length) { await api(`/services/${id}/deploys`, { method: "POST", body: JSON.stringify({ clearCache: "do_not_clear" }) }); console.log("\nRedeploy started. It takes a few minutes."); }
fs.rmSync(file); // the keys shouldn't sit around on disk
console.log(`Deleted ${file}.`);
