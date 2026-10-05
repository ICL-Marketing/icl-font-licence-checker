// Launch checklist (7.2 Launch Checks + 8.1 Launch Actions) and how each item
// is judged from the scan. Shared by the page and the Excel export.
//
// state: "pass"   fully verified by the scan, signed off automatically
//        "fail"   the scan found problems to fix
//        "review" the scan found things worth a look, but a person must sign off
//        "manual" cannot be checked automatically, a person must sign off
// A check is only ever auto-signed when the scan covered everything it needs
// (every page, every link). Anything partial stays with a person.

export const AUTO_SIGNER = "Licence Checker (automatic)";

const path = (u) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };
const item = (text, href) => ({ text, href });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listPages = (pages, max = 25) => pages.slice(0, max).map((p) => item(path(p.url), p.url));

function okPages(d) { return (d.pages || []).filter((p) => p.status >= 200 && p.status < 400 && !p.notHtml && !p.error); }
function coverageNote(d) {
  if (!d.complete?.pages) return d.start?.capped ? `Only the first ${d.pages.length} pages were checked (500 page limit).` : "Not every page could be checked.";
  return "";
}

// Plain-English reasons for common TLS failures.
function sslReason(code) {
  const c = String(code || "");
  if (/EXPIRED/i.test(c)) return "the certificate has expired";
  if (/ALTNAME|does not match/i.test(c)) return "the certificate is for a different domain";
  if (/SELF_SIGNED|SELF-SIGNED/i.test(c)) return "the certificate is self-signed (not trusted by browsers)";
  if (/UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CHAIN/i.test(c)) return "the certificate chain is incomplete (intermediate certificate missing)";
  if (/ECONNREFUSED/i.test(c)) return "nothing is answering on HTTPS (port 443)";
  if (/PACKET_LENGTH|WRONG_VERSION|EPROTO/i.test(c)) return "the server is not serving HTTPS on this address";
  if (/ENOTFOUND|EAI_AGAIN/i.test(c)) return "the domain does not resolve";
  if (/timed out|ETIMEDOUT/i.test(c)) return "HTTPS timed out";
  return c || "HTTPS failed";
}

export const LAUNCH_CHECKS = [
  // ---- 7.2 Launch checks
  { id: "design-figma", section: "Launch checks", owner: "Designer", title: "Design follows the approved Figma designs",
    detail: "Elements may need re-snagging once content is added.",
    run: () => ({ state: "manual", summary: "Visual check against Figma. Cannot be checked automatically." }) },
  { id: "design-responsive", section: "Launch checks", owner: "Designer", title: "Responsive on all screen sizes from 320px to 1920px",
    run: (d) => {
      const pages = okPages(d);
      const missing = pages.filter((p) => !/width\s*=\s*device-width/i.test(p.viewport || ""));
      if (missing.length) return { state: "fail", summary: `${plural(missing.length, "page")} missing a responsive viewport tag, so mobiles will show the desktop layout.`, items: listPages(missing) };
      return { state: "manual", summary: `Viewport tag present on all ${pages.length} pages checked. Layout still needs checking by eye at 320px–1920px.` };
    } },
  { id: "design-accessible", section: "Launch checks", owner: "Designer", title: "Design is accessible (contrast, readable text)",
    run: (d) => {
      const pages = okPages(d);
      const noLang = pages.filter((p) => !p.lang);
      const items = noLang.length ? [item(`${plural(noLang.length, "page")} without a language set (screen readers need it)`), ...listPages(noLang, 10)] : [];
      return { state: noLang.length ? "review" : "manual", summary: "Colour contrast and text size need checking by eye (e.g. WebAIM contrast checker).", items,
        links: [item("WebAIM contrast checker", "https://webaim.org/resources/contrastchecker/")] };
    } },

  { id: "dev-forms", section: "Launch checks", owner: "Developer", title: "Forms submit correctly, validation works and emails are formatted correctly",
    run: (d) => {
      const withForms = okPages(d).filter((p) => p.forms > 0);
      const tools = [...new Set(withForms.flatMap((p) => p.formTools || []))];
      return { state: "manual", summary: withForms.length
        ? `${plural(withForms.length, "page")} with forms${tools.length ? ` (${tools.join(", ")})` : ""}. Submit each one and check the email that arrives.`
        : "No forms found in the page HTML. Check for any loaded by JavaScript or pop-ups.", items: listPages(withForms) };
    } },
  { id: "dev-images", section: "Launch checks", owner: "Developer", title: "Images load properly and are optimised",
    run: (d) => {
      const info = d.imageInfo || {};
      const urls = Object.keys(info);
      const broken = urls.filter((u) => !info[u].status || info[u].status >= 400);
      const heavy = urls.filter((u) => info[u].status < 400 && info[u].bytes > 400_000).sort((a, b) => info[b].bytes - info[a].bytes);
      const items = [
        ...broken.slice(0, 20).map((u) => item(`Broken (${info[u].status || info[u].error || "no response"}): ${path(u)} — on ${path(d.imageSources?.[u] || "")}`, u)),
        ...heavy.slice(0, 20).map((u) => item(`${Math.round(info[u].bytes / 1024)} KB: ${path(u)}`, u)),
      ];
      const checked = `${plural(urls.length, "image")} checked${d.complete?.images ? "" : " (not all images could be checked)"}`;
      if (broken.length) return { state: "fail", summary: `${plural(broken.length, "image")} not loading, ${heavy.length} over 400 KB. ${checked}.`, items };
      if (heavy.length) return { state: "review", summary: `All images load. ${plural(heavy.length, "image")} over 400 KB could be compressed or resized. ${checked}.`, items };
      return { state: "manual", summary: `All images load and none are over 400 KB. ${checked}. Image dimensions and formats still worth a quick look.` };
    } },
  { id: "dev-speed", section: "Launch checks", owner: "Developer", title: "Page speed: GTmetrix (Pro, London) load time 0.6–1.6s, A PageSpeed and A YSlow",
    run: (d) => ({ state: "manual", summary: `GTmetrix grades cannot be read automatically. Homepage server response here: ${d.start?.homeMs ?? "?"} ms, ${Math.round((d.start?.homeBytes || 0) / 1024)} KB of HTML.`,
      links: [item("Open GTmetrix", "https://gtmetrix.com/")] }) },
  { id: "dev-browsers", section: "Launch checks", owner: "Developer", title: "Works in Chrome, Safari, Edge and Firefox",
    run: () => ({ state: "manual", summary: "Needs testing in each browser." }) },
  { id: "dev-cms", section: "Launch checks", owner: "Developer", title: "CMS editing works correctly (if applicable)",
    run: (d) => ({ state: "manual", summary: d.start?.platform ? `Built on ${d.start.platform}. Log in and test editing.` : "No CMS detected from the front end. Test editing if there is one." }) },
  { id: "dev-security", section: "Launch checks", owner: "Developer", title: "Security basics: HTTPS and no mixed content warnings",
    run: (d) => {
      const s = d.start || {};
      const problems = [];
      if (!s.https?.cert?.valid) problems.push(item(`SSL problem: ${sslReason(s.https?.cert?.error)}`));
      if (!s.httpRedirect?.toHttps) problems.push(item(`http:// does not redirect to https:// (ends at ${s.httpRedirect?.finalUrl || "nothing"})`));
      const mixed = okPages(d).filter((p) => p.mixed?.length);
      for (const p of mixed.slice(0, 20)) problems.push(item(`${path(p.url)}: loads ${p.mixed.slice(0, 3).join(", ")}${p.mixed.length > 3 ? ` +${p.mixed.length - 3} more` : ""} over http`, p.url));
      if (problems.length) return { state: "fail", summary: `${plural(problems.length, "problem")} found.`, items: problems };
      const cov = coverageNote(d);
      if (cov) return { state: "review", summary: `HTTPS works and no mixed content on the pages checked. ${cov}` };
      return { state: "pass", summary: `Valid certificate, http redirects to https, and no mixed content on all ${okPages(d).length} pages.` };
    } },
  { id: "dev-analytics", section: "Launch checks", owner: "Developer", title: "Analytics and tracking are installed correctly",
    run: (d) => {
      const pages = okPages(d);
      const ga = [...new Set(pages.flatMap((p) => p.ga || []))], gtm = [...new Set(pages.flatMap((p) => p.gtm || []))];
      const other = [...new Set(pages.flatMap((p) => p.trackers || []))];
      const found = [ga.length && `Google Analytics ${ga.join(", ")}`, gtm.length && `Tag Manager ${gtm.join(", ")}`, ...other].filter(Boolean);
      return { state: found.length ? "manual" : "fail", summary: found.length
        ? `Found: ${found.join("; ")}. Confirm data arrives (e.g. GA Realtime, Tag Assistant).`
        : "No analytics or tracking found in the page HTML." };
    } },

  { id: "sd-alt", section: "Launch checks", owner: "Senior Developer", title: "Image alt tags: all images must have an alt tag",
    run: (d) => {
      const pages = okPages(d).filter((p) => p.missingAltCount > 0);
      const total = pages.reduce((n, p) => n + p.missingAltCount, 0);
      if (total) return { state: "fail", summary: `${plural(total, "image")} without an alt tag on ${plural(pages.length, "page")}.`,
        items: pages.slice(0, 25).map((p) => item(`${path(p.url)}: ${p.missingAltCount} (${p.missingAlt.slice(0, 3).map(path).join(", ")}${p.missingAltCount > 3 ? "…" : ""})`, p.url)) };
      const cov = coverageNote(d);
      if (cov) return { state: "review", summary: `Every image has an alt tag on the pages checked. ${cov}` };
      return { state: "pass", summary: `Every image in the page HTML has an alt tag, across all ${okPages(d).length} pages. Images added later by JavaScript are not included.` };
    } },
  { id: "sd-ga", section: "Launch checks", owner: "Senior Developer", title: "Google Analytics is installed",
    run: (d) => {
      const pages = okPages(d);
      const withGa = pages.filter((p) => (p.ga?.length || p.gaLoader));
      const withGtm = pages.filter((p) => p.gtm?.length);
      if (!withGa.length && withGtm.length) return { state: "review", summary: "No Google Analytics tag in the page code, but Tag Manager is installed. GA may be set up inside Tag Manager: check there or in GA Realtime." };
      if (!withGa.length) return { state: "fail", summary: "No Google Analytics found." };
      const missing = pages.filter((p) => !withGa.includes(p) && !withGtm.includes(p));
      if (missing.length) return { state: "fail", summary: `Google Analytics missing on ${plural(missing.length, "page")}.`, items: listPages(missing) };
      const ids = [...new Set(pages.flatMap((p) => p.ga || []))];
      const ua = [...new Set(pages.flatMap((p) => p.ua || []))];
      const cov = coverageNote(d);
      if (cov || withGa.length < pages.length) return { state: "review", summary: `Google Analytics ${ids.join(", ")} found${withGa.length < pages.length ? " (some pages via Tag Manager only)" : ""}. ${cov}` };
      return { state: "pass", summary: `Google Analytics ${ids.join(", ") || "tag"} on all ${pages.length} pages.${ua.length ? ` Old Universal Analytics IDs also present (${ua.join(", ")}): these no longer collect data.` : ""}` };
    } },
  { id: "sd-gtm", section: "Launch checks", owner: "Senior Developer", title: "Google Tag Manager is installed",
    run: (d) => {
      const pages = okPages(d);
      const withGtm = pages.filter((p) => p.gtm?.length);
      if (!withGtm.length) return { state: "fail", summary: "No Google Tag Manager container found." };
      const missing = pages.filter((p) => !p.gtm?.length);
      const ids = [...new Set(pages.flatMap((p) => p.gtm || []))];
      if (missing.length) return { state: "fail", summary: `Tag Manager ${ids.join(", ")} missing on ${plural(missing.length, "page")}.`, items: listPages(missing) };
      const cov = coverageNote(d);
      if (cov) return { state: "review", summary: `Tag Manager ${ids.join(", ")} on every page checked. ${cov}` };
      return { state: "pass", summary: `Tag Manager ${ids.join(", ")} on all ${pages.length} pages.` };
    } },
  { id: "sd-client-tracking", section: "Launch checks", owner: "Senior Developer", title: "Any client-specific tracking tools are installed",
    run: (d) => {
      const other = [...new Set(okPages(d).flatMap((p) => p.trackers || []))];
      return { state: "manual", summary: other.length ? `Detected: ${other.join(", ")}. Confirm these are the ones the client needs.` : "No other tracking tools detected. Confirm with the client what they need (some load inside Tag Manager)." };
    } },
  { id: "sd-sitemap", section: "Launch checks", owner: "Senior Developer", title: "XML sitemap is in place",
    run: (d) => {
      const sm = d.start?.sitemap || {};
      if (!sm.files?.length) return { state: "fail", summary: "No XML sitemap found (checked robots.txt, /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml)." };
      if (!sm.count) return { state: "fail", summary: "Sitemap found but it lists no pages.", items: sm.files.map((f) => item(f, f)) };
      return { state: "pass", summary: `Sitemap found with ${plural(sm.count, "URL")}.`, items: sm.files.slice(0, 10).map((f) => item(path(f), f)) };
    } },
  { id: "sd-sitemap-relevant", section: "Launch checks", owner: "Senior Developer", title: "Sitemap only contains relevant public pages",
    run: (d) => {
      const sm = d.start?.sitemap || {};
      if (!sm.count) return { state: "manual", summary: "No sitemap to check." };
      const byUrl = Object.fromEntries((d.pages || []).map((p) => [p.url, p]));
      const flags = [];
      for (const u of sm.urls || []) {
        const p = byUrl[u];
        if (p && (!p.status || p.status >= 400)) flags.push(item(`${p.status || "no response"}: ${path(u)}`, u));
        else if (p && p.noindex) flags.push(item(`Set to noindex but listed: ${path(u)}`, u));
        else if (p && p.finalUrl && p.finalUrl.replace(/\/$/, "") !== u.replace(/\/$/, "")) flags.push(item(`Redirects to ${path(p.finalUrl)}: ${path(u)}`, u));
        else if (/\/(sample-page|hello-world|test|testing|demo|old|copy|draft|staging)(-\d+)?\/?$|\/author\/|\/tag\/|attachment|\?p=\d+|\/elementor-hf\/|\/elementskit|\/e-landing-page\//i.test(u)) flags.push(item(`Looks like a test, archive or system page: ${path(u)}`, u));
      }
      for (const u of sm.offSite || []) flags.push(item(`Different domain: ${u}`, u));
      return { state: flags.length ? "review" : "manual", summary: flags.length
        ? `${plural(flags.length, "URL")} worth checking out of ${sm.count}. Then skim the rest of the list.`
        : `${plural(sm.count, "URL")} listed, none look out of place. Skim the list to confirm.`,
        items: flags.slice(0, 40), links: sm.files?.[0] ? [item("Open sitemap", sm.files[0])] : [] };
    } },

  { id: "am-links", section: "Launch checks", owner: "Account Manager", title: "Navigation and buttons work with no 404 errors (menus, links, dropdowns)",
    run: (d) => {
      const st = d.linkStatus || {};
      const broken = Object.keys(st).filter((u) => !st[u].status || st[u].status >= 400);
      const checked = Object.keys(st).length;
      if (broken.length) return { state: "fail", summary: `${plural(broken.length, "broken internal link")} found.`,
        items: broken.slice(0, 40).map((u) => item(`${st[u].status || st[u].error || "no response"}: ${path(u)} — linked from ${path(d.linkSources?.[u] || "")}`, d.linkSources?.[u] || u)) };
      return { state: "manual", summary: `No broken internal links (${plural(checked, "link")} checked${d.complete?.links ? "" : ", not all could be checked"}). Menus and dropdowns still need clicking through.` };
    } },
  { id: "am-titles", section: "Launch checks", owner: "Account Manager", title: "SEO: every page has a meta title",
    run: (d) => {
      const pages = okPages(d);
      const missing = pages.filter((p) => !p.title);
      if (missing.length) return { state: "fail", summary: `${plural(missing.length, "page")} without a title.`, items: listPages(missing) };
      const cov = coverageNote(d);
      if (cov) return { state: "review", summary: `All pages checked have a title. ${cov}` };
      return { state: "pass", summary: `All ${pages.length} pages have a title.` };
    } },
  { id: "am-descriptions", section: "Launch checks", owner: "Account Manager", title: "SEO: every public page has a meta description",
    run: (d) => {
      const pages = okPages(d).filter((p) => !p.noindex);
      const missing = pages.filter((p) => !p.description);
      if (missing.length) return { state: "fail", summary: `${plural(missing.length, "page")} without a meta description.`, items: listPages(missing, 40) };
      const cov = coverageNote(d);
      if (cov) return { state: "review", summary: `All pages checked have a description. ${cov}` };
      return { state: "pass", summary: `All ${pages.length} public pages have a meta description.` };
    } },
  { id: "am-titles-relevant", section: "Launch checks", owner: "Account Manager", title: "Page titles are relevant",
    run: (d) => {
      const pages = okPages(d);
      const seen = {};
      for (const p of pages) if (p.title) (seen[p.title] ||= []).push(p);
      const dupes = Object.entries(seen).filter(([, ps]) => ps.length > 1);
      const items = [
        ...dupes.slice(0, 15).map(([t, ps]) => item(`Same title on ${ps.length} pages: "${t}"`, ps[0].url)),
        ...pages.filter((p) => p.title && (p.title.length > 65 || p.title.length < 15)).slice(0, 15).map((p) => item(`${p.title.length} characters: "${p.title}" (${path(p.url)})`, p.url)),
      ];
      return { state: items.length ? "review" : "manual", summary: items.length ? "Duplicate, very short or very long titles below. Relevance needs a person." : "No duplicate titles. Relevance needs a person.", items,
        pageList: pages.slice(0, 500).map((p) => ({ url: p.url, title: p.title })) };
    } },
  { id: "am-content", section: "Launch checks", owner: "Account Manager", title: "Content is accurate (no placeholder text or typos)",
    run: (d) => {
      const hits = okPages(d).filter((p) => p.placeholders?.length);
      if (hits.length) return { state: "fail", summary: `Possible placeholder text on ${plural(hits.length, "page")}. Typos still need reading.`,
        items: hits.slice(0, 25).map((p) => item(`${path(p.url)}: "…${p.placeholders[0]}…"`, p.url)) };
      return { state: "manual", summary: "No placeholder text found (lorem ipsum, sample page, TBC…). Typos and accuracy need reading." };
    } },
  { id: "am-redirects", section: "Launch checks", owner: "Account Manager", title: "Redirects: full list of 301s from the old site imported (not by plugin on WordPress)",
    run: (d) => ({ state: "manual", summary: /wordpress/i.test(d.start?.platform || "") ? "WordPress site: 301s must be in the server config (.htaccess / host), not a plugin. Needs the old site's URL list." : "Needs the old site's URL list to check against." }) },
  { id: "am-backup", section: "Launch checks", owner: "Account Manager", title: "If replacing a current host, client advised to get a backup from the old provider",
    run: () => ({ state: "manual", summary: "Confirm the client was advised before go live." }) },

  // ---- 8.1 Launch actions
  { id: "la-ssl", section: "Launch actions", owner: "Developer", title: "SSL certificate is installed",
    run: (d) => {
      const c = d.start?.https?.cert || {};
      if (!c.valid) return { state: "fail", summary: `No valid certificate: ${sslReason(c.error)}${c.error ? ` (${c.error})` : ""}.` };
      if (c.daysLeft != null && c.daysLeft < 14) return { state: "review", summary: `Valid, but expires in ${plural(c.daysLeft, "day")} (${c.validTo}). Check it auto-renews.` };
      return { state: "pass", summary: `Valid certificate from ${c.issuer || "issuer unknown"}, expires ${c.validTo}${c.daysLeft != null ? ` (${c.daysLeft} days)` : ""}.` };
    } },
  { id: "la-robots", section: "Launch actions", owner: "Developer", title: "robots.txt allows search engines to index public content",
    run: (d) => {
      const r = d.start?.robots || {};
      const problems = [];
      if (r.blockedFor?.length) problems.push(item(`robots.txt blocks the whole site for: ${r.blockedFor.join("; ")}`));
      if (r.homeNoindex) problems.push(item(`Homepage is set to noindex (${[r.homeRobotsMeta, r.homeRobotsHeader].filter(Boolean).join(" / ")}). On WordPress: Settings → Reading → untick "Discourage search engines".`));
      const noindex = okPages(d).filter((p) => p.noindex && p.url !== d.start?.finalUrl);
      const info = noindex.length ? [item(`${plural(noindex.length, "page")} set to noindex (fine for thank-you or private pages):`), ...listPages(noindex, 15)] : [];
      if (problems.length) return { state: "fail", summary: "Search engines are blocked.", items: [...problems, ...info] };
      return { state: noindex.length ? "review" : "pass", summary: `${r.found ? "robots.txt allows crawling" : "No robots.txt (crawling allowed by default)"} and the homepage is indexable.${noindex.length ? " Some pages are noindex: check they should be." : ""}`, items: info,
        links: r.found ? [item("Open robots.txt", `${d.start.origin}/robots.txt`)] : [] };
    } },
  { id: "la-crm", section: "Launch actions", owner: "Account Manager", title: "Contact details on the CRM Client Card are up to date",
    run: () => ({ state: "manual", summary: "Check the Client Card on the CRM." }) },
  { id: "la-emails", section: "Launch actions", owner: "Account Manager", title: "New business emails (domain related) added to the Client Card",
    run: (d) => {
      const mx = d.start?.mx || [];
      const provider = mx.some((m) => /google|googlemail/i.test(m)) ? "Google Workspace" : mx.some((m) => /outlook|protection\.outlook/i.test(m)) ? "Microsoft 365" : "";
      return { state: "manual", summary: mx.length ? `Domain email is set up${provider ? ` on ${provider}` : ""} (${mx.slice(0, 2).join(", ")}). Add any new addresses to the Client Card.` : "No email (MX) records found for this domain." };
    } },
];

export function evaluateLaunch(d) {
  return LAUNCH_CHECKS.map((c) => {
    let r;
    try { r = c.run(d) || { state: "manual" }; } catch (e) { r = { state: "manual", summary: `Could not evaluate: ${e.message}` }; }
    return { ...c, run: undefined, ...r, items: r.items || [], links: r.links || [] };
  });
}

export const STATE_LABEL = { pass: "Passed automatically", fail: "Problems found", review: "Worth a look", manual: "Manual check" };
