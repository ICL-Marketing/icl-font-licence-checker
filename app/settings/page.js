"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamEditor, loadTeam, saveTeam, normaliseTeam } from "@/app/team";
import { ClientsEditor, loadClients, saveClients } from "@/app/clients";
import { normaliseClients } from "@/lib/clients";
import { keysFor } from "@/app/launch";

export default function Settings() {
  const [team, setTeam] = useState([]);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTeam(loadTeam()), 0);
    fetch("/api/team").then((r) => r.json()).then((j) => {
      if (!j.shared) return;
      setShared(true);
      if (Array.isArray(j.team) && j.team.length) setTeam(normaliseTeam(j.team));
    }).catch(() => {});
    return () => clearTimeout(t);
  }, []);
  async function change(list) {
    const local = saveTeam(list);
    setTeam(local);
    if (shared) {
      const j = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: local }) }).then((r) => r.json()).catch(() => ({}));
      if (Array.isArray(j.team)) setTeam(normaliseTeam(j.team));
    }
  }
  const [clients, setClients] = useState([]);
  const [clientsShared, setClientsShared] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setClients(loadClients()), 0);
    fetch("/api/clients").then((r) => r.json()).then((j) => { if (!j.shared) return; setClientsShared(true); if (Array.isArray(j.clients) && j.clients.length) setClients(normaliseClients(j.clients)); }).catch(() => {});
    return () => clearTimeout(t);
  }, []);
  async function changeClients(list) {
    const local = saveClients(list);
    setClients(local);
    if (clientsShared) {
      const j = await fetch("/api/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clients: local }) }).then((r) => r.json()).catch(() => ({}));
      if (Array.isArray(j.clients)) setClients(normaliseClients(j.clients));
    }
  }
  // Archived launch / post-launch checks: restore or delete for good.
  const [archived, setArchived] = useState([]);
  const loadArchived = () => {
    const out = [];
    for (const mode of ["launch", "post"]) {
      let runs = {};
      try { runs = JSON.parse(localStorage.getItem(keysFor(mode).runs) || "{}"); } catch {}
      for (const [key, r] of Object.entries(runs)) if (r.archived) out.push({ mode, key, r });
    }
    setArchived(out.sort((a, b) => String(b.r.archivedAt).localeCompare(String(a.r.archivedAt))));
  };
  useEffect(() => { const t = setTimeout(loadArchived, 0); return () => clearTimeout(t); }, []);
  async function archivedAction(mode, key, action) {
    let runs = {};
    try { runs = JSON.parse(localStorage.getItem(keysFor(mode).runs) || "{}"); } catch {}
    const r = runs[key];
    if (!r) return;
    if (action === "restore") { runs[key] = { ...r, archived: false, archivedAt: new Date().toISOString() }; }
    else delete runs[key];
    try { localStorage.setItem(keysFor(mode).runs, JSON.stringify(runs)); } catch {}
    try {
      if (action === "restore") await fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: mode, site: key, data: runs[key] }) });
      else await fetch("/api/results", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: mode, site: key }) });
    } catch {}
    loadArchived();
  }
  const [mk, setMk] = useState(null);
  const [testLink, setTestLink] = useState("");
  const [test, setTest] = useState(null);
  async function runTest() {
    setTest({ busy: true });
    try { setTest(await (await fetch("/api/marker-monitor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: testLink }) })).json()); }
    catch (e) { setTest({ ok: false, error: e.message }); }
  }
  const [status, setStatus] = useState(null);
  useEffect(() => { fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ login: false, store: { configured: false, ok: false } })); }, []);
  useEffect(() => { fetch("/api/marker").then((r) => r.json()).then(setMk).catch(() => setMk({ configured: true, ok: false, error: "Could not reach the app" })); }, []);
  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">← Back to Website Checker</Link>
      <h1 className="mt-3 text-2xl font-semibold">Settings</h1>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Shared saving &amp; login</h2>
        <p className="mb-3 text-sm text-zinc-500">One team password, and every scan, sign-off, client and setting saved for everyone who signs in.</p>
        <StatusPanel status={status} />
      </section>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Team names</h2>
        <p className="mb-3 text-sm text-zinc-500">Names and roles offered in the &quot;Checked by&quot; dropdowns on launch checks.</p>
        <TeamEditor team={team} onChange={change} shared={shared} />
      </section>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Clients</h2>
        <p className="mb-3 text-sm text-zinc-500">From the Web Clients spreadsheet. The account manager is offered first on launch sign-offs for that client&apos;s site, and the email addresses are shown on client emails.</p>
        <ClientsEditor clients={clients} team={team} onChange={changeClients} shared={clientsShared} />
      </section>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Archived checks</h2>
        <p className="mb-3 text-sm text-zinc-500">Launch and post-launch checks archived from their tabs. Restore puts one back; Delete removes it and its sign-offs for good.</p>
        {!archived.length && <p className="text-sm text-zinc-500">Nothing archived.</p>}
        {archived.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 pr-3">Site</th><th className="py-1 pr-3">Tab</th><th className="py-1 pr-3">Scanned</th><th className="py-1 pr-3">Archived</th><th /></tr></thead>
            <tbody>
              {archived.map(({ mode, key, r }) => (
                <tr key={`${mode}:${key}`} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-3 font-medium">{key}</td>
                  <td className="py-1.5 pr-3">{mode === "post" ? "Post Launch Checks" : "Launch Checks"}</td>
                  <td className="py-1.5 pr-3 text-zinc-600">{r.scannedAt ? new Date(r.scannedAt).toLocaleDateString("en-GB") : "—"}</td>
                  <td className="py-1.5 pr-3 text-zinc-600">{r.archivedAt ? new Date(r.archivedAt).toLocaleDateString("en-GB") : "—"}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => archivedAction(mode, key, "restore")} className="mr-2 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100">Restore</button>
                    <button onClick={() => { if (confirm(`Delete the ${mode === "post" ? "post-launch" : "launch"} check for ${key} and its sign-offs?`)) archivedAction(mode, key, "delete"); }} className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Marker.io</h2>
        <p className="mb-3 text-sm text-zinc-500">Lets launch checks create snags directly in Marker.io. Set up with two Vercel environment variables: <code>MARKER_MCP_URL</code> (from Marker.io → MCP → Others) and <code>MARKER_MCP_TOKEN</code> (Marker.io → MCP → Access token; tokens last 90 days).</p>
        {!mk && <p className="text-sm text-zinc-500">Checking…</p>}
        {mk && !mk.configured && <p className="text-sm"><span className="font-semibold text-amber-700">Not set up.</span> Add the two variables in Vercel and redeploy.</p>}
        {mk?.configured && !mk.ok && <p className="text-sm"><span className="font-semibold text-red-700">✗ Not working:</span> {mk.error}</p>}
        {mk?.ok && (
          <div className="text-sm">
            <p className="font-semibold text-green-700">✓ Connected.</p>
            <p className="mt-1">{mk.createTool ? <>Snags will be created with <code>{mk.createTool}</code>.</> : <span className="text-amber-700">Marker.io does not let apps create snags (its MCP can only read issues and comment on them), so findings use &quot;Copy snag&quot;, which copies the text and opens the project for you to paste into a new issue.</span>}</p>
            <div className="mt-3 rounded-md border border-zinc-200 p-3">
              <p className="text-xs font-semibold">Test accessibility monitoring for a project</p>
              <div className="mt-1 flex gap-2">
                <input value={testLink} onChange={(e) => setTestLink(e.target.value)} placeholder="Marker.io project link" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs" />
                <button onClick={runTest} disabled={!testLink.trim() || test?.busy} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50">{test?.busy ? "Checking…" : "Test"}</button>
              </div>
              {test && !test.busy && (
                <div className="mt-2 text-xs">
                  {test.ok ? (
                    <>
                      <p className="text-green-700">✓ Read monitoring for project {test.projectId}: score {test.score ?? "?"}, {test.failing ?? "?"} failing checks, {test.pagesMonitored ?? "?"} of {test.pagesTotal ?? "?"} pages, {test.checks?.length ?? 0} checks listed.</p>
                      <ul className="mt-1 list-disc pl-5">{(test.checks || []).slice(0, 10).map((c, i) => <li key={i}>{c.name}{c.impact ? ` (${c.impact})` : ""}{c.elements != null ? ` – ${c.elements} elements` : ""}</li>)}</ul>
                    </>
                  ) : <p className="text-red-700">✗ {test.error}</p>}
                  {test.raw && <details className="mt-1"><summary className="cursor-pointer text-zinc-500">Raw response (for troubleshooting)</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[10px]">{test.raw.summary}{"\n\n---\n\n"}{test.raw.checks}{"\n\n--- elements (sample) ---\n\n"}{test.raw.elements || "(none)"}</pre></details>}
                </div>
              )}
            </div>
            <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">What Marker.io allows ({mk.tools.length})</summary>
              <ul className="mt-1 space-y-1">{mk.tools.map((t) => <li key={t.name}><code>{t.name}</code> – {t.description} {t.fields.length > 0 && <span className="text-zinc-400">({t.fields.join(", ")})</span>}</li>)}</ul>
            </details>
          </div>
        )}
      </section>
    </main>
  );
}

function StatusRow({ ok, label, detail }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${ok ? "bg-green-600" : "bg-red-600"}`}>{ok ? "✓" : "✗"}</span>
      <div><span className="font-medium">{label}</span>{detail && <span className="text-zinc-500"> – {detail}</span>}</div>
    </div>
  );
}

// Shows whether the team login and the shared store are live, with the
// Vercel steps to turn either on. Both are environment variables, so they
// can't be changed from inside the app.
function StatusPanel({ status }) {
  if (!status) return <p className="text-sm text-zinc-500">Checking…</p>;
  const st = status.store || {};
  const storeOk = st.configured && st.ok;
  return (
    <div className="space-y-2">
      <StatusRow ok={status.login} label="Team login" detail={status.login ? "everyone signs in with the shared password" : "no password set, the checker is open to anyone with the link"} />
      <StatusRow ok={storeOk} label="Shared saving" detail={storeOk ? "scans, sign-offs, clients and settings are saved for the whole team" : st.configured ? `store set up but not reachable: ${st.error || "unknown error"}` : "not connected, each browser keeps its own copy"} />
      {(!status.login || !storeOk) && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">To turn this on (about 5 minutes, free):</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {!storeOk && !st.configured && (<>
              <li>In Vercel open the project → <b>Storage</b> tab → <b>Create Database</b> → choose <b>Upstash</b> → <b>Redis</b> → Free plan.</li>
              <li>Connect it to this project (all environments). Vercel adds <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code> automatically.</li>
            </>)}
            {!status.login && <li>Project → <b>Settings</b> → <b>Environment Variables</b>: add <code>CHECKER_PASSWORD</code> with the password the team will share.</li>}
            <li>Deployments → <b>Redeploy</b> the latest deployment, then reload this page.</li>
          </ol>
          <p className="mt-2 text-xs">Scans already in this browser are uploaded to the shared store the first time the checker loads after connecting.</p>
        </div>
      )}
    </div>
  );
}
