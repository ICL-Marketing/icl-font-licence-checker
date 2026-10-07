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
  const [status, setStatus] = useState(null);
  useEffect(() => { fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ login: false, store: { configured: false, ok: false } })); }, []);
  const [section, setSection] = useState("team");
  useEffect(() => {
    try { const q = new URLSearchParams(window.location.search).get("section"); if (SECTIONS.some(([id]) => id === q)) setTimeout(() => setSection(q), 0); } catch {}
  }, []);
  const pick = (id) => { setSection(id); try { const u = new URL(window.location.href); u.searchParams.set("section", id); window.history.replaceState(null, "", u.search); } catch {} };
  const st = status?.store || {};
  const allGood = status && status.login && st.configured && st.ok;
  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">← Back to Website Checker</Link>
      <h1 className="mt-3 text-2xl font-semibold">Settings</h1>
      <nav className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-zinc-200/70 p-1 sm:inline-grid sm:w-auto sm:grid-cols-4" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => pick(id)} aria-current={section === id ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${section === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>
            {label}{id === "archived" && archived.length > 0 && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{archived.length}</span>}
          </button>
        ))}
      </nav>
      {section === "team" && (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Team names</h2>
          <p className="mb-3 text-sm text-zinc-500">Names and roles offered in the sign-off dropdowns on launch checks.</p>
          <TeamEditor team={team} onChange={change} shared={shared} />
        </section>
      )}
      {section === "clients" && (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Clients</h2>
          <p className="mb-3 text-sm text-zinc-500">The account manager is offered first on launch sign-offs for that client&apos;s site, and the email addresses are used on client emails.</p>
          <ClientsEditor clients={clients} team={team} onChange={changeClients} shared={clientsShared} />
        </section>
      )}
      {section === "archived" && (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Archived checks</h2>
          <p className="mb-3 text-sm text-zinc-500">Launch and post-launch checks archived from their tabs.</p>
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
      )}
      {section === "connections" && (
        <>
          {status && !allGood && (
            <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="font-semibold">Shared saving &amp; login</h2>
              <p className="mb-3 text-sm text-zinc-500">One team password, and every scan, sign-off, client and setting saved for everyone who signs in.</p>
              <StatusPanel status={status} />
            </section>
          )}
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Companies House</h2>
            <p className="mb-3 text-sm text-zinc-500">Lets Website Leads find local companies and read net assets from their accounts. Free.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.companiesHouse
              ? <StatusRow ok label="API key set" detail="press Find leads on the Website Leads tab" />
              : <>
                  <StatusRow ok={false} label="API key not set" detail="Website Leads can't search yet" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li>Go to <a href="https://developer.company-information.service.gov.uk/" target="_blank" rel="noreferrer" className="text-blue-700 underline">developer.company-information.service.gov.uk</a> and sign in (or register, it is free).</li>
                    <li><b>Your applications</b> → <b>Create an application</b> (name: ICL Website Checker, environment: Live) → <b>Create new key</b> → type <b>REST</b>. Copy the key.</li>
                    <li>In Vercel: project → Settings → Environment Variables → add <code>COMPANIES_HOUSE_API_KEY</code>.</li>
                    <li>Deployments → <b>Redeploy</b>, then reload this page.</li>
                  </ol>
                </>}
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Google search (optional)</h2>
            <p className="mb-3 text-sm text-zinc-500">Website Leads checks where each business ranks for its name and trade. Without a key it uses DuckDuckGo, which can block busy sessions; Google&apos;s Programmable Search gives 100 reliable searches a day free.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.googleSearch
              ? <StatusRow ok label="Google search key set" detail="search checks use Google" />
              : <>
                  <StatusRow ok={false} label="Using DuckDuckGo" detail="works without a key, less reliable" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li>At <a href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer" className="text-blue-700 underline">programmablesearchengine.google.com</a> add a search engine, choose <b>Search the entire web</b>, and copy its <b>Search engine ID</b> (the cx value).</li>
                    <li>At <a href="https://developers.google.com/custom-search/v1/overview" target="_blank" rel="noreferrer" className="text-blue-700 underline">the Custom Search JSON API page</a> click <b>Get a key</b> and copy the API key.</li>
                    <li>In Vercel add <code>GOOGLE_CSE_KEY</code> and <code>GOOGLE_CSE_CX</code>, then Redeploy.</li>
                  </ol>
                </>}
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Figma</h2>
            <p className="mb-3 text-sm text-zinc-500">Lets Design Checks read Figma files for accessibility problems before they are coded.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.figma
              ? <StatusRow ok label="Figma token set" detail="paste a Figma file, page or frame link on the Design Checks tab" />
              : <>
                  <StatusRow ok={false} label="Figma token not set" detail="Design Checks can't read files yet" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li>In Figma: profile menu → <b>Settings</b> → <b>Security</b> → <b>Personal access tokens</b> → Generate new token, with <b>File content: read</b>.</li>
                    <li>In Vercel: project → Settings → Environment Variables → add <code>FIGMA_TOKEN</code> with that value.</li>
                    <li>Deployments → <b>Redeploy</b>, then reload this page.</li>
                  </ol>
                </>}
          </section>
        </>
      )}
    </main>
  );
}

const SECTIONS = [["team", "Team"], ["clients", "Clients"], ["archived", "Archived checks"], ["connections", "Connections"]];

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
              <li>In Vercel open the project → <b>Storage</b> tab → <b>Create Database</b> → <b>Redis</b> (Redis Cloud) or <b>Upstash</b> → Free plan.</li>
              <li>Connect it to this project (all environments). Vercel adds the connection variables automatically.</li>
            </>)}
            {!status.login && <li>Project → <b>Settings</b> → <b>Environment Variables</b>: add <code>CHECKER_PASSWORD</code> with the password the team will share.</li>}
            <li>Deployments → <b>Redeploy</b> the latest deployment (a new deployment is needed before it can see new variables), then reload this page.</li>
          </ol>
          {!storeOk && (
            <p className="mt-2 text-xs">
              {st.vars?.length
                ? <>Storage variables this deployment can see: <code>{st.vars.join(", ")}</code>. {st.configured ? "" : "None of these is a Redis connection, so the store was probably created as a different type (it needs a Redis store)."}</>
                : "This deployment can't see any storage variables yet. If the store is connected in Vercel, it was connected after this deployment was built: redeploy."}
            </p>
          )}
          <p className="mt-2 text-xs">Scans already in this browser are uploaded to the shared store the first time the checker loads after connecting.</p>
        </div>
      )}
    </div>
  );
}
