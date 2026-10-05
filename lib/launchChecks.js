// Launch checklist (7.2 Launch Checks + 8.1 Launch Actions) and how each item
// is judged from the scan. Shared by the page and the Excel export.
//
// state: "pass"   fully verified by the scan, signed off automatically
//        "fail"   the scan found problems to fix
//        "review" the scan found things worth a look, but a person must sign off
//        "manual" cannot be checked automatically, a person must sign off
// A check is only ever auto-signed when the scan covered everything it needs
// (every page, every link). Anything partial stays with a person.

export const AUTO_SIGNER = "Website Checker (automatic)";

const path = (u) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };
const item = (text, href) => ({ text, href });
const plural = (n, w) => `${n} ${n === 1 ? w : w === "button or link" ? "buttons or links" : `${w}s`}`;
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

// PageSpeed (Lighthouse) results: which crawled pages were audited, and is that all of them.
function psiCover(d) {
  const pages = okPages(d);
  const audited = pages.filter((p) => d.psi?.[p.url]?.ok);
  return { pages, audited, full: !!d.complete?.psi && pages.length > 0 && audited.length === pages.length };
}
function psiMissing(d, what) {
  const { pages, audited } = psiCover(d);
  if (d.psiError) return `${what} needs Google PageSpeed: ${d.psiError}`;
  if (!audited.length) return `${what} needs Google PageSpeed, which did not run.`;
  return `Google PageSpeed audited ${audited.length} of ${pages.length} pages.`;
}
// Pass only when the HTML check covered every page; otherwise a person looks.
// noun is pluralised ("form field" -> "form fields"), rest follows it unchanged.
function htmlRule(d, { bad, count, noun, rest, perPage, describe, passText }) {
  const pages = okPages(d).filter(bad);
  const total = pages.reduce((n, p) => n + count(p), 0);
  if (total) return { state: "fail", summary: `${plural(total, noun)} ${rest}${perPage ? "" : ` on ${plural(pages.length, "page")}`}.`, items: pages.slice(0, 25).map((p) => item(`${path(p.url)}: ${describe(p)}`, p.url)) };
  const cov = coverageNote(d);
  if (cov) return { state: "review", summary: `None found on the pages checked. ${cov}` };
  return { state: "pass", summary: passText(okPages(d).length) };
}

export const LAUNCH_CHECKS = [
  // ---- 7.2 Launch checks
{ id: "design-figma", section: "Launch checks", owner: "Designer", title: "Design follows the approved Figma designs",
    detail: "Elements may need re-snagging once content is added.",
    run: () => ({ state: "manual", summary: "Visual check against Figma. Cannot be checked automatically." }) },
  { id: "resp-viewport", section: "Launch checks", owner: "Designer", title: "Responsive: every page has a mobile viewport tag",
    run: (d) => htmlRule(d, { bad: (p) => !/width\s*=\s*device-width/i.test(p.viewport || ""), count: () => 1, noun: "page", rest: "missing a mobile viewport tag", perPage: true,
      describe: () => "no width=device-width viewport, so phones show the desktop layout", passText: (n) => `All ${n} pages have a width=device-width viewport tag.` }) },
  { id: "resp-layout", section: "Launch checks", owner: "Designer", title: "Responsive: layout works on all screen sizes from 320px to 1920px",
    run: () => ({ state: "manual", summary: "Check by eye at 320px, 768px, 1024px, 1440px and 1920px (browser dev tools)." }) },

  { id: "a11y-contrast", section: "Launch checks", owner: "Designer", title: "Accessibility: text colour contrast meets WCAG AA",
    run: (d) => {
      const { audited, full } = psiCover(d);
      if (!audited.length) return { state: "manual", summary: psiMissing(d, "Contrast checking") + " Check by eye or with the WebAIM contrast checker.", links: [item("WebAIM contrast checker", "https://webaim.org/resources/contrastchecker/")] };
      const bad = audited.filter((p) => d.psi[p.url].contrast?.length);
      if (bad.length) return { state: "fail", summary: `Low-contrast text on ${plural(bad.length, "page")}.`,
        items: bad.slice(0, 20).flatMap((p) => d.psi[p.url].contrast.slice(0, 4).map((c) => item(`${path(p.url)}: "${c.text || c.selector}" ${c.ratio ? `${c.ratio}:1` : ""}${c.fg ? ` (${c.fg} on ${c.bg})` : ""}${c.need ? `, needs ${c.need}` : ""}`, p.url))) };
      if (!full) return { state: "review", summary: `No contrast failures on the ${audited.length} pages audited. ${psiMissing(d, "")}` };
      return { state: "pass", summary: `No contrast failures on all ${audited.length} pages (Google Lighthouse, mobile). Text over images is checked separately.` };
    } },
  { id: "a11y-text-size", section: "Launch checks", owner: "Designer", title: "Accessibility: text is large enough to read (12px or more on mobile)",
    run: (d) => {
      const { audited, full } = psiCover(d);
      if (!audited.length) return { state: "manual", summary: psiMissing(d, "Text size checking") };
      const bad = audited.filter((p) => d.psi[p.url].small?.length);
      if (bad.length) return { state: "review", summary: `Text under 12px on ${plural(bad.length, "page")}. Fine for small print, not for body copy.`,
        items: bad.slice(0, 20).flatMap((p) => d.psi[p.url].small.slice(0, 3).map((x) => item(`${path(p.url)}: ${x.size} on ${x.selector || "text"} (${x.coverage || "?"} of the page's text)`, p.url))) };
      if (!full) return { state: "review", summary: `No text under 12px on the ${audited.length} pages audited. ${psiMissing(d, "")}` };
      return { state: "pass", summary: `No text under 12px on mobile across all ${audited.length} pages.` };
    } },
  { id: "a11y-lang", section: "Launch checks", owner: "Designer", title: "Accessibility: every page sets its language (for screen readers)",
    run: (d) => htmlRule(d, { bad: (p) => !p.lang, count: () => 1, noun: "page", rest: "without a language set", perPage: true, describe: () => "no lang attribute on <html>",
      passText: (n) => `All ${n} pages set a language.` }) },
  { id: "a11y-labels", section: "Launch checks", owner: "Designer", title: "Accessibility: every form field has a label",
    run: (d) => {
      const r = htmlRule(d, { bad: (p) => p.unlabelledCount > 0, count: (p) => p.unlabelledCount, noun: "form field", rest: "without a label",
        describe: (p) => p.unlabelled.slice(0, 3).join(", "), passText: (n) => `Every form field has a label, across all ${n} pages.` });
      return withPsiFails(d, r, ["label", "select-name"]);
    } },
  { id: "a11y-names", section: "Launch checks", owner: "Designer", title: "Accessibility: every button and link has a name (icon-only links need a label)",
    run: (d) => {
      const r = htmlRule(d, { bad: (p) => p.noNameButtonCount + p.noNameLinkCount > 0, count: (p) => p.noNameButtonCount + p.noNameLinkCount, noun: "button or link", rest: "without a name",
        describe: (p) => [...p.noNameButtons, ...p.noNameLinks].slice(0, 3).join(", "), passText: (n) => `Every button and link has a readable name, across all ${n} pages.` });
      return withPsiFails(d, r, ["button-name", "link-name", "input-button-name"]);
    } },
  { id: "a11y-zoom", section: "Launch checks", owner: "Designer", title: "Accessibility: pinch-to-zoom is not disabled",
    run: (d) => htmlRule(d, { bad: (p) => p.zoomBlocked, count: () => 1, noun: "page", rest: "blocking pinch-to-zoom", perPage: true, describe: (p) => `viewport "${p.viewport}"`,
      passText: (n) => `Zoom allowed on all ${n} pages.` }) },
  { id: "a11y-other", section: "Launch checks", owner: "Designer", title: "Accessibility: no other automated accessibility errors (Google Lighthouse)",
    run: (d) => {
      const { audited, full } = psiCover(d);
      if (!audited.length) return { state: "manual", summary: psiMissing(d, "This check") };
      const fails = {};
      for (const p of audited) for (const o of d.psi[p.url].other || []) (fails[o.title] ||= []).push({ p, o });
      const keys = Object.keys(fails);
      const scores = audited.map((p) => d.psi[p.url].a11yScore).filter((n) => n != null);
      const low = scores.length ? Math.min(...scores) : null;
      if (keys.length) return { state: "fail", summary: `${plural(keys.length, "type")} of accessibility error found. Lowest Lighthouse accessibility score: ${low}.`,
        items: keys.slice(0, 20).map((k) => item(`${k} — ${plural(fails[k].length, "page")} (e.g. ${path(fails[k][0].p.url)}${fails[k][0].o.examples?.[0] ? `: ${fails[k][0].o.examples[0].slice(0, 80)}` : ""})`, fails[k][0].p.url)) };
      if (!full) return { state: "review", summary: `No errors on the ${audited.length} pages audited. ${psiMissing(d, "")}` };
      return { state: "pass", summary: `No automated accessibility errors across all ${audited.length} pages. Lowest Lighthouse accessibility score: ${low}.` };
    } },
  { id: "a11y-text-images", section: "Launch checks", owner: "Designer", title: "Accessibility: text over images or gradients is readable",
    run: () => ({ state: "manual", summary: "Automated tools can't measure contrast against a photo or gradient. Check banners and hero images by eye." }) },
  { id: "a11y-overall", section: "Launch checks", owner: "Designer", title: "Accessibility: design is readable and easy to use overall",
    run: () => ({ state: "manual", summary: "Judgement call: font choice, line length, spacing, clear buttons." }) },

{ id: "dev-forms", section: "Launch checks", owner: "Developer", title: "Forms submit correctly, validation works and emails are formatted correctly",
    run: (d) => {
      const withForms = okPages(d).filter((p) => p.forms > 0);
      const tools = [...new Set(withForms.flatMap((p) => p.formTools || []))];
      return { state: "manual", summary: withForms.length
        ? `${plural(withForms.length, "page")} with forms${tools.length ? ` (${tools.join(", ")})` : ""}. Submit each one and check the email that arrives.`
        : "No forms found in the page HTML. Check for any loaded by JavaScript or pop-ups.", items: listPages(withForms) };
    } },
  { id: "dev-images-load", section: "Launch checks", owner: "Developer", title: "Images load properly (no broken images)",
    run: (d) => {
      const info = d.imageInfo || {};
      const urls = Object.keys(info);
      const broken = urls.filter((u) => !info[u].status || info[u].status >= 400);
      if (broken.length) return { state: "fail", summary: `${plural(broken.length, "image")} not loading.`,
        items: broken.slice(0, 30).map((u) => item(`${info[u].status || info[u].error || "no response"}: ${path(u)} — on ${path(d.imageSources?.[u] || "")}`, u)) };
      if (!d.complete?.images || !d.complete?.pages) return { state: "review", summary: `All ${plural(urls.length, "image")} checked load fine, but not every image could be checked.` };
      return { state: "pass", summary: `All ${plural(urls.length, "image")} across the site load.` };
    } },
  { id: "dev-images-optimised", section: "Launch checks", owner: "Developer", title: "Images are optimised (compressed, modern formats, sensible sizes)",
    run: (d) => {
      const info = d.imageInfo || {};
      const heavy = Object.keys(info).filter((u) => info[u].status < 400 && info[u].bytes > 400_000).sort((a, b) => info[b].bytes - info[a].bytes);
      const { audited, full } = psiCover(d);
      const psiIssues = audited.flatMap((p) => (d.psi[p.url].imageIssues || []).map((x) => ({ ...x, page: p.url })));
      const byUrl = {};
      for (const x of psiIssues) if (!byUrl[x.url] || byUrl[x.url].wastedKb < x.wastedKb) byUrl[x.url] = x;
      const items = [
        ...heavy.slice(0, 20).map((u) => item(`${Math.round(info[u].bytes / 1024)} KB: ${path(u)}`, u)),
        ...Object.values(byUrl).sort((a, b) => b.wastedKb - a.wastedKb).slice(0, 20).map((x) => item(`${x.audit}: ${path(x.url)} (could save ${x.wastedKb} KB)`, x.url)),
      ];
      if (items.length) return { state: "fail", summary: `${plural(heavy.length, "image")} over 400 KB${audited.length ? `, ${plural(Object.keys(byUrl).length, "image")} Lighthouse says could be smaller` : ""}.`, items };
      if (!audited.length) return { state: "review", summary: `No images over 400 KB. ${psiMissing(d, "Format and sizing checks")}` };
      if (!full || !d.complete?.images) return { state: "review", summary: `No images over 400 KB and no Lighthouse image warnings on the ${audited.length} pages audited, but not everything was covered.` };
      return { state: "pass", summary: `No images over 400 KB, and Lighthouse found no compression, format or sizing savings across all ${audited.length} pages.` };
    } },
  { id: "dev-speed", section: "Launch checks", owner: "Developer", title: "Page speed: GTmetrix (Pro, London) load time 0.6–1.6s, A PageSpeed and A YSlow",
    run: (d) => {
      const home = d.psi?.[d.start?.finalUrl] || Object.values(d.psi || {}).find((x) => x.ok);
      const lh = home?.ok && home.perfScore != null ? ` Google Lighthouse (mobile) homepage: performance ${home.perfScore}/100, largest content shown in ${(home.lcp / 1000).toFixed(1)}s.` : "";
      return { state: "manual", summary: `GTmetrix grades need a GTmetrix Pro test.${lh} Server response ${d.start?.homeMs ?? "?"} ms.`, links: [item("Open GTmetrix", "https://gtmetrix.com/")] };
    } },
{ id: "dev-browsers", section: "Launch checks", owner: "Developer", title: "Works in Chrome, Safari, Edge and Firefox",
    run: () => ({ state: "manual", summary: "Needs testing in each browser." }) },
{ id: "dev-cms", section: "Launch checks", owner: "Developer", title: "CMS editing works correctly (if applicable)",
    run: (d) => ({ state: "manual", summary: d.start?.platform ? `Built on ${d.start.platform}. Log in and test editing.` : "No CMS detected from the front end. Test editing if there is one." }) },
  { id: "dev-https", section: "Launch checks", owner: "Developer", title: "Security: HTTPS works and http:// redirects to https://",
    run: (d) => {
      const s = d.start || {};
      const problems = [];
      if (!s.https?.cert?.valid) problems.push(item(`SSL problem: ${sslReason(s.https?.cert?.error)}`));
      if (!s.httpRedirect?.toHttps) problems.push(item(`http:// does not redirect to https:// (ends at ${s.httpRedirect?.finalUrl || "nothing"})`));
      if (problems.length) return { state: "fail", summary: `${plural(problems.length, "problem")} found.`, items: problems };
      return { state: "pass", summary: `Valid certificate and http:// redirects to ${s.httpRedirect.finalUrl}.` };
    } },
  { id: "dev-mixed", section: "Launch checks", owner: "Developer", title: "Security: no mixed content warnings",
    run: (d) => htmlRule(d, { bad: (p) => p.mixed?.length, count: (p) => p.mixed.length, noun: "file", rest: "loaded over http",
      describe: (p) => p.mixed.slice(0, 3).join(", "), passText: (n) => `No files loaded over http on all ${n} pages.` }) },
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

  { id: "am-links", section: "Launch checks", owner: "Account Manager", title: "No broken internal links (404 errors)",
    run: (d) => {
      const st = d.linkStatus || {};
      const broken = Object.keys(st).filter((u) => !st[u].status || st[u].status >= 400);
      const checked = Object.keys(st).length;
      const byUrl = Object.fromEntries((d.pages || []).map((p) => [p.url, p]));
      const pageName = (u) => { const p = byUrl[u]; return p?.title ? `the "${p.title.replace(/\s*[|–-].*$/, "").trim()}" page` : `the page ${path(u)}`; };
      const why = (x) => !x.status ? "did not respond at all" : x.status === 404 || x.status === 410 ? "goes to a page that does not exist (404)" : x.status === 403 || x.status === 401 ? "goes to a page visitors are not allowed to see" : x.status >= 500 ? "goes to a page showing a server error" : `returns an error (${x.status})`;
      if (broken.length) return { state: "fail", summary: `${plural(broken.length, "broken internal link")} found. Each one below says what the link is called, where it is, and where it points.`,
        items: broken.slice(0, 40).map((u) => item(`The "${d.linkTexts?.[u] || "(no text)"}" link on ${pageName(d.linkSources?.[u] || "")} ${why(st[u])}. It points to ${path(u)}`, d.linkSources?.[u] || u)) };
      if (!d.complete?.links || !d.complete?.pages) return { state: "review", summary: `No broken links among the ${plural(checked, "link")} checked, but not every link could be checked.` };
      return { state: "pass", summary: `All ${plural(checked, "internal link")} work.` };
    } },
  { id: "am-menus", section: "Launch checks", owner: "Account Manager", title: "Menus, buttons and dropdowns work",
    run: () => ({ state: "manual", summary: "Click through the main menu, mobile menu, dropdowns and buttons." }) },
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
  { id: "am-placeholder", section: "Launch checks", owner: "Account Manager", title: "Content: no placeholder text",
    run: (d) => htmlRule(d, { bad: (p) => p.placeholders?.length, count: (p) => p.placeholders.length, noun: "possible placeholder", rest: "found",
      describe: (p) => `"…${p.placeholders[0]}…"`, passText: (n) => `No placeholder text (lorem ipsum, sample page, TBC…) on all ${n} pages.` }) },
  { id: "am-typos", section: "Launch checks", owner: "Account Manager", title: "Content: no typos and content is accurate",
    run: (d) => {
      const words = {};
      for (const p of okPages(d)) for (const w of p.typos || []) (words[w.toLowerCase()] ||= { w, pages: [] }).pages.push(p.url);
      const list = Object.values(words).sort((a, b) => a.pages.length - b.pages.length || a.w.localeCompare(b.w));
      if (!list.length) return { state: "manual", summary: "Spell check (British English) found nothing. Accuracy still needs a read." };
      return { state: "review", summary: `${plural(list.length, "word")} not in the British English dictionary. Many will be names or industry terms; words on one page are the most likely typos.`,
        items: list.slice(0, 60).map((x) => item(`"${x.w}" on ${x.pages.length === 1 ? path(x.pages[0]) : plural(x.pages.length, "page")}`, x.pages[0])) };
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

// Lighthouse can spot label/name problems in content added by JavaScript.
function withPsiFails(d, r, ids) {
  const { audited } = psiCover(d);
  const extra = [];
  for (const p of audited) for (const id of ids) for (const ex of d.psi[p.url].ownFails?.[id] || []) extra.push(item(`${path(p.url)}: ${String(ex).slice(0, 100)} (Lighthouse)`, p.url));
  if (!extra.length) return r;
  return { state: "fail", summary: r.state === "fail" ? r.summary : `${plural(extra.length, "problem")} found by Google Lighthouse.`, items: [...(r.items || []), ...extra.slice(0, 20)] };
}

export function evaluateLaunch(d) {
  return LAUNCH_CHECKS.map((c) => {
    let r;
    try { r = c.run(d) || { state: "manual" }; } catch (e) { r = { state: "manual", summary: `Could not evaluate: ${e.message}` }; }
    return { ...c, run: undefined, ...r, items: r.items || [], links: r.links || [] };
  });
}

export const STATE_LABEL = { pass: "Passed automatically", fail: "Problems found", review: "Worth a look", manual: "Manual check" };
