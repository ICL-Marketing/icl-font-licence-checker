"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamEditor, loadTeam, saveTeam, normaliseTeam } from "@/app/team";

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
  const [mk, setMk] = useState(null);
  const [testLink, setTestLink] = useState("");
  const [test, setTest] = useState(null);
  async function runTest() {
    setTest({ busy: true });
    try { setTest(await (await fetch("/api/marker-monitor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: testLink }) })).json()); }
    catch (e) { setTest({ ok: false, error: e.message }); }
  }
  useEffect(() => { fetch("/api/marker").then((r) => r.json()).then(setMk).catch(() => setMk({ configured: true, ok: false, error: "Could not reach the app" })); }, []);
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">← Back to Website Checker</Link>
      <h1 className="mt-3 text-2xl font-semibold">Settings</h1>
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Team names</h2>
        <p className="mb-3 text-sm text-zinc-500">Names and roles offered in the &quot;Checked by&quot; dropdowns on launch checks.</p>
        <TeamEditor team={team} onChange={change} shared={shared} />
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
                  {test.raw && <details className="mt-1"><summary className="cursor-pointer text-zinc-500">Raw response (for troubleshooting)</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[10px]">{test.raw.summary}{"\n\n---\n\n"}{test.raw.checks}</pre></details>}
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
