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
            <h2 className="font-semibold">Lead email details</h2>
            <p className="mb-3 text-sm text-zinc-500">What lead emails say about you: the pages they link to, who is writing, and the clients worth mentioning. Emails redraft on the next rescan.</p>
            <LinksEditor />
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Web search for leads</h2>
            <p className="mb-3 text-sm text-zinc-500">Website Leads checks where each business ranks and finds sites the name-guess misses. Without a key it uses DuckDuckGo, which blocks busy sessions. The Brave Search API gives $5 of free credit every month (about 1,000 searches, roughly 500 leads); it asks for a card but the free credit covers normal use.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.braveSearch
              ? <StatusRow ok label="Brave Search key set" detail="search checks use Brave" />
              : status.googleSearch ? <StatusRow ok label="Google search key set" detail="only works if the engine was created with Search the entire web; Google no longer offers that to new engines" />
              : <>
                  <StatusRow ok={false} label="Using DuckDuckGo" detail="works without a key, blocks after a few dozen searches" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li>Go to <a href="https://api-dashboard.search.brave.com/register" target="_blank" rel="noreferrer" className="text-blue-700 underline">api-dashboard.search.brave.com</a> and create an account (card on file; the monthly free credit is applied first).</li>
                    <li>In the dashboard open <b>API Keys</b> → <b>Add API key</b> → choose the <b>Search</b> plan → copy the key.</li>
                    <li>In Vercel add <code>BRAVE_SEARCH_KEY</code> with that value, then Redeploy.</li>
                  </ol>
                </>}
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Contact finder (Hunter.io)</h2>
            <p className="mb-3 text-sm text-zinc-500">Finds named people at each company with their role and a scored email address, marketing managers included, so far fewer leads end up as &quot;contact not verified&quot;. Free for 25 lookups a month; the Starter plan (about £30 a month) covers 500. One lookup per lead, only for leads worth pitching, cached 60 days.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.hunter
              ? <StatusRow ok label="Hunter.io connected" detail="runs inside every contact lookup" />
              : <>
                  <StatusRow ok={false} label="Not connected" detail="contacts come from Companies House and the website only" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li>Sign up at <a href="https://hunter.io/users/sign_up" target="_blank" rel="noreferrer" className="text-blue-700 underline">hunter.io</a> with the work email (free plan to start).</li>
                    <li>Open <b>API</b> in the left menu and copy the API key.</li>
                    <li>In Vercel add <code>HUNTER_API_KEY</code>, then Redeploy. Optional: <code>HUNTER_MONTHLY_CAP</code> to stop the app at your plan&apos;s limit (default 450).</li>
                  </ol>
                </>}
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Search volumes (Google Ads Keyword Planner)</h2>
            <p className="mb-3 text-sm text-zinc-500">Puts &quot;around 140 people a month make that exact search&quot; in lead emails automatically. Free, but Google makes you apply for API access once.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.keywords
              ? <><StatusRow ok label="Keyword Planner connected" detail="volumes are looked up during the search step and cached for 90 days" /><KeywordTest /></>
              : <>
                  <StatusRow ok={false} label="Not connected" detail="emails say 'the search most new customers make' instead of a figure" />
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    <li><b>Developer token:</b> in Google Ads, switch to (or create) a <b>Manager account</b> → Admin → <b>API Center</b> → copy the developer token, then click <b>Apply for Basic access</b>. Google usually approves an agency in 1–3 working days; test-account access is not enough.</li>
                    <li><b>OAuth client:</b> at console.cloud.google.com create a project → APIs &amp; Services → <b>Credentials</b> → Create credentials → <b>OAuth client ID</b> → type <b>Desktop app</b>. Copy the client ID and secret. Under OAuth consent screen add your Google account as a test user.</li>
                    <li><b>Refresh token:</b> open <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer" className="text-blue-700 underline">developers.google.com/oauthplayground</a> → cog → tick &quot;Use your own OAuth credentials&quot; and paste the ID and secret → in the scope box enter <code>https://www.googleapis.com/auth/adwords</code> → Authorize APIs (sign in with the Ads account) → Exchange authorization code for tokens → copy the <b>refresh token</b>.</li>
                    <li><b>Customer ID:</b> the 10-digit number at the top of Google Ads for the account that will run the queries (any active account; it is not charged). If it sits under a manager account, note the manager&apos;s ID too.</li>
                    <li>In Vercel add <code>GOOGLE_ADS_DEVELOPER_TOKEN</code>, <code>GOOGLE_ADS_CLIENT_ID</code>, <code>GOOGLE_ADS_CLIENT_SECRET</code>, <code>GOOGLE_ADS_REFRESH_TOKEN</code>, <code>GOOGLE_ADS_CUSTOMER_ID</code> (and <code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> for the manager, if used), then Redeploy.</li>
                  </ol>
                </>}
          </section>
          <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Figma</h2>
            <p className="mb-3 text-sm text-zinc-500">Lets Design Checks read Figma files for accessibility problems before they are coded.</p>
            {!status ? <p className="text-sm text-zinc-500">Checking…</p> : status.figma
              ? <><StatusRow ok label="Figma token set" detail="paste a Figma file, page or frame link on the Design Checks tab" /><FigmaTest /></>
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

const SUBJECT_DEFAULTS = { "licence-font": "Font licence on your website", "licence-image": "A stock image on your website", "Broken SSL": "Your website is showing a security warning", "Dead/broken site": "Your website is down", "Parked domain": "Your domain isn't showing a website", "Stale copyright": "A few thoughts on your website", "Dated template": "Your website could be doing more for you", "No website": "Couldn't find you online", seo: "Your website in search", other: "A few thoughts on your website" };
const SUBJECT_LABELS = { "licence-font": "Font licence", "licence-image": "Stock image", seo: "Search ranking", other: "Anything else" };
const LINK_DEFAULTS = { site: "https://icldigital.com/", websites: "https://icldigital.com/services/websites/", videography: "https://icldigital.com/services/videography/", contact: "https://icldigital.com/get-in-touch/" };
const LINK_LABELS = { site: "Homepage", websites: "Websites service page", videography: "Videography service page", contact: "Contact page" };
const SENDER_DEFAULTS = { name: "Chris", role: "Lead Designer", agency: "ICL Digital", where: "Richmond" };
const CLIENT_DEFAULTS = "Thames Laundry | https://thameslaundry.co.uk/ | Sunbury | sunbury, lower sunbury, upper halliford, shepperton, laleham, littleton, charlton, ashford, feltham, hanworth, kempton, hampton, hampton hill, hampton wick, molesey, east molesey, west molesey, walton, hersham, weybridge, staines, teddington\nSt John Eye Hospital Group | https://www.stjohneyehospital.org/ | London | flagship";
const parseClients = (t) => t.split(/\n/).map((line) => line.split("|").map((x) => x.trim())).filter((p) => p[0]).map(([name, url, town, near]) => { const list = (near || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); return { name, url: url || "", town: town || "", near: list.filter((x) => x !== "flagship"), flagship: list.includes("flagship") }; });
function LinksEditor() {
  const [links, setLinks] = useState(LINK_DEFAULTS);
  const [sender, setSender] = useState(SENDER_DEFAULTS);
  const [clients, setClients] = useState(CLIENT_DEFAULTS);
  const [subjects, setSubjects] = useState(SUBJECT_DEFAULTS);
  const [followUp, setFollowUp] = useState({ chaseDays: 7, coldDays: 21, lostDays: 60 });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/settings?key=lead-links").then((r) => r.json()).then((j) => {
      if (!(j.shared && j.value)) return;
      const { sender: sn, clients: cl, volumes: vo, subjects: su, followUp: fu, ...rest } = j.value;
      void vo; // manual volumes are no longer edited here; Keyword Planner supplies them automatically
      if (fu && typeof fu === "object") setFollowUp({ chaseDays: 7, coldDays: 21, lostDays: 60, ...fu });
      if (su && typeof su === "object") setSubjects({ ...SUBJECT_DEFAULTS, ...su });
      setLinks({ ...LINK_DEFAULTS, ...rest });
      if (sn) setSender({ ...SENDER_DEFAULTS, ...sn });
      if (Array.isArray(cl) && cl.length) setClients(cl.map((c) => [c.name, c.url, c.town, [...(c.near || []), ...(c.flagship ? ["flagship"] : [])].join(", ")].join(" | ")).join("\n"));
    }).catch(() => {});
  }, []);
  async function save() {
    await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "lead-links", value: { ...links, sender, clients: parseClients(clients), subjects, followUp: { chaseDays: Number(followUp.chaseDays) || 7, coldDays: Number(followUp.coldDays) || 21, lostDays: Number(followUp.lostDays) || 60 } } }) }).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.keys(LINK_DEFAULTS).map((k) => (
          <label key={k} className="block text-sm"><span className="text-xs font-semibold text-zinc-600">{LINK_LABELS[k]}</span>
            <input value={links[k] || ""} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {[["name", "Your first name"], ["role", "Your role"], ["agency", "Agency"], ["where", "Where you are"]].map(([k, label]) => (
          <label key={k} className="block text-sm"><span className="text-xs font-semibold text-zinc-600">{label}</span>
            <input value={sender[k] || ""} onChange={(e) => setSender({ ...sender, [k]: e.target.value })} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
        ))}
      </div>
      <label className="block text-sm"><span className="text-xs font-semibold text-zinc-600">Clients to mention</span>
        <span className="block text-[11px] text-zinc-500">One per line: name | website | town | towns where a lead would know them (comma-separated). The first match on the lead&apos;s town is introduced as &quot;just down the road from you&quot;; otherwise the one marked <code>flagship</code> is used as the credibility name.</span>
        <textarea value={clients} onChange={(e) => setClients(e.target.value)} rows={4} className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs" /></label>
      <div>
        <div className="text-xs font-semibold text-zinc-600">Follow-up timings (days)</div>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {[["chaseDays", "Flag Contacted leads to chase after"], ["coldDays", "Move Contacted to Cold after"], ["lostDays", "Move Cold to Lost after"]].map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2"><span className="text-xs text-zinc-500">{label}</span>
              <input type="number" min={1} value={followUp[k]} onChange={(e) => setFollowUp({ ...followUp, [k]: e.target.value })} className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Replied or Meeting at any point stops the clock. Moves happen when someone opens the Website Leads tab.</p>
      </div>
      <div>
        <div className="text-xs font-semibold text-zinc-600">Email subjects</div>
        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          {Object.keys(SUBJECT_DEFAULTS).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-xs text-zinc-500">{SUBJECT_LABELS[k] || k}</span>
              <input value={subjects[k] || ""} onChange={(e) => setSubjects({ ...subjects, [k]: e.target.value })} className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm" /></label>
          ))}
        </div>
      </div>
      <button onClick={save} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">{saved ? "Saved" : "Save"}</button>
    </div>
  );
}

// Ask Figma about one file: proves the token works and shows when Figma last saved it.
function FigmaTest() {
  const [link, setLink] = useState("");
  const [res, setRes] = useState(null);
  async function run() { setRes({ busy: true }); try { setRes(await (await fetch(`/api/design?link=${encodeURIComponent(link)}`)).json()); } catch (e) { setRes({ ok: false, error: e.message }); } }
  return (
    <div className="mt-3 rounded-md border border-zinc-200 p-3">
      <p className="text-xs font-semibold">Test with a file</p>
      <div className="mt-1 flex gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Figma file link" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs" />
        <button onClick={run} disabled={!link.trim() || res?.busy} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50">{res?.busy ? "Asking Figma…" : "Test"}</button>
      </div>
      {res && !res.busy && (
        <div className="mt-2 text-xs">
          {res.ok ? (
            <>
              <p className="text-green-700">✓ Figma answered. File &quot;{res.name}&quot;, {res.frames} screen{res.frames === 1 ? "" : "s"}, last saved {res.lastModified ? new Date(res.lastModified).toLocaleString("en-GB") : "unknown"} (version {res.version}).</p>
              {res.sample?.length > 0 && <p className="mt-1 text-zinc-600">Screens: {res.sample.join(" · ")}{res.frames > res.sample.length ? " …" : ""}</p>}
              <p className="mt-1 text-zinc-500">If &quot;last saved&quot; is older than your latest edits, Figma has not stored them yet: make any small change and wait a few seconds, or check you are linking the same file and branch you edited.</p>
            </>
          ) : <p className="text-red-700">✗ {res.error}</p>}
        </div>
      )}
    </div>
  );
}

function KeywordTest() {
  const [q, setQ] = useState("plumber teddington");
  const [res, setRes] = useState(null);
  async function run() { setRes({ busy: true }); try { setRes(await (await fetch(`/api/leads?volume=${encodeURIComponent(q)}`)).json()); } catch (e) { setRes({ ok: false, error: e.message }); } }
  return (
    <div className="mt-3 rounded-md border border-zinc-200 p-3">
      <p className="text-xs font-semibold">Test a search</p>
      <div className="mt-1 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs" />
        <button onClick={run} disabled={!q.trim() || res?.busy} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50">{res?.busy ? "Asking Google…" : "Test"}</button>
      </div>
      {res && !res.busy && <p className={`mt-2 text-xs ${res.ok ? "text-green-700" : "text-red-700"}`}>{res.ok ? `✓ "${q}": ${res.volume.toLocaleString("en-GB")} searches a month (UK).` : `✗ ${res.error}`}</p>}
    </div>
  );
}
