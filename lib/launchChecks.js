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

// Plain-English versions of Google Lighthouse accessibility findings.
const PLAIN_A11Y = {
  "heading-order": "Headings skip levels (e.g. a Heading 2 followed by a Heading 5). Screen-reader users jump through headings, so keep them in order.",
  "aria-hidden-focus": "Some hidden sections still contain links or buttons you can tab to, so keyboard users land on invisible items.",
  "aria-hidden-body": "The whole page is marked hidden from screen readers.",
  "empty-heading": "Some headings are empty.",
  "list": "List formatting is broken: items inside a list are not marked as list items.",
  "listitem": "Some list items sit outside a list.",
  "definition-list": "A definition list is not structured correctly.",
  "dlitem": "Definition list items sit outside a list.",
  "duplicate-id-aria": "Two elements share the same ID, which confuses assistive technology.",
  "duplicate-id-active": "Two interactive elements share the same ID, which confuses assistive technology.",
  "frame-title": "An embedded frame (video, map or form) has no title.",
  "tabindex": "Some elements force a custom tab order, making keyboard navigation unpredictable.",
  "link-in-text-block": "Links inside paragraphs are shown only by colour, not underlined, so colour-blind users cannot spot them.",
  "target-size": "Some buttons or links are too small to tap easily on a phone.",
  "aria-allowed-attr": "Accessibility (ARIA) attributes are used on elements that do not support them.",
  "aria-valid-attr": "Some accessibility (ARIA) attributes are misspelt or invalid.",
  "aria-valid-attr-value": "Some accessibility (ARIA) attributes have invalid values.",
  "aria-required-attr": "Some accessibility (ARIA) roles are missing required attributes.",
  "aria-required-children": "Some accessibility (ARIA) roles are missing the child elements they need.",
  "aria-required-parent": "Some accessibility (ARIA) roles are missing the parent element they need.",
  "aria-roles": "Some accessibility (ARIA) roles are invalid.",
  "aria-allowed-role": "Some elements use an accessibility (ARIA) role that is not allowed on them.",
  "aria-prohibited-attr": "Some elements use an accessibility (ARIA) attribute that is not allowed on them.",
  "aria-text": "Text marked with an ARIA role contains focusable elements.",
  "aria-dialog-name": "A pop-up dialog has no name for screen readers.",
  "aria-command-name": "A custom button, link or menu item has no name for screen readers.",
  "aria-input-field-name": "A custom input field has no name for screen readers.",
  "aria-toggle-field-name": "A custom checkbox, switch or radio has no name for screen readers.",
  "aria-progressbar-name": "A progress bar has no name for screen readers.",
  "aria-meter-name": "A meter has no name for screen readers.",
  "aria-tooltip-name": "A tooltip has no name for screen readers.",
  "aria-treeitem-name": "A tree item has no name for screen readers.",
  "meta-refresh": "The page refreshes or redirects itself automatically.",
  "landmark-one-main": "The page does not mark where the main content starts.",
  "bypass": "There is no way to skip past repeated content such as the menu (a skip link).",
  "th-has-data-cells": "Some table header cells have no data cells.",
  "td-headers-attr": "Table cells refer to headers that do not exist.",
  "table-fake-caption": "A table uses a normal row as its caption instead of a real caption.",
  "table-duplicate-name": "A table's caption repeats its summary.",
  "label-content-name-mismatch": "A button's visible text differs from the name screen readers announce.",
  "object-alt": "Embedded objects have no alternative text.",
  "input-image-alt": "Image buttons have no alternative text.",
  "video-caption": "Videos have no captions.",
  "accesskeys": "Keyboard shortcuts (accesskeys) are duplicated.",
  "form-field-multiple-labels": "A form field has more than one label.",
  "skip-link": "The skip link does not point to anything.",
  "image-redundant-alt": "Image descriptions repeat words like \"image of\" or \"picture of\".",
  "nested-interactive": "A button or link sits inside another button or link.",
  "valid-lang": "A language code on the page is invalid.",
  "html-xml-lang-mismatch": "The page declares two different languages.",
  "identical-links-same-purpose": "Links with the same wording go to different places.",
  "offscreen-content-hidden": "Content moved off-screen is still read out by screen readers.",
  "focus-order-semantics": "Elements in the tab order are not interactive controls.",
};
const plainA11y = (o) => PLAIN_A11Y[o.id] || String(o.title || o.id).replace(/`/g, "").replace(/\[aria-hidden="true"\]/g, "Hidden");

// Tick/cross lines shown under a check: {ok: true | false | null, text}
const yes = (text) => ({ ok: true, text });
const no = (text) => ({ ok: false, text });
const maybe = (text) => ({ ok: null, text });

// Facts about analytics shared by three checks.
function trackingFacts(d) {
  const pages = okPages(d);
  const withGa = pages.filter((p) => p.ga?.length || p.gaLoader);
  const withGtm = pages.filter((p) => p.gtm?.length);
  const ga = [...new Set(pages.flatMap((p) => p.ga || []))];
  const ua = [...new Set(pages.flatMap((p) => p.ua || []))];
  const gtm = [...new Set(pages.flatMap((p) => p.gtm || []))];
  const other = [...new Set(pages.flatMap((p) => p.trackers || []))];
  const facts = [];
  if (withGa.length === pages.length && pages.length) facts.push(yes(`Google Analytics ${ga.join(", ")} on all ${pages.length} pages`));
  else if (withGa.length) facts.push(no(`Google Analytics ${ga.join(", ")} on ${withGa.length} of ${pages.length} pages`));
  else if (withGtm.length) facts.push(maybe("No Google Analytics tag in the page code (may be set up inside Tag Manager)"));
  else facts.push(no("Google Analytics not found"));
  if (ua.length) facts.push(no(`Old Universal Analytics ID still present (${ua.join(", ")}): it no longer collects data`));
  if (withGtm.length === pages.length && pages.length) facts.push(yes(`Google Tag Manager ${gtm.join(", ")} on all ${pages.length} pages`));
  else if (withGtm.length) facts.push(no(`Google Tag Manager ${gtm.join(", ")} on ${withGtm.length} of ${pages.length} pages`));
  else facts.push(no("Google Tag Manager not found"));
  for (const t of other) facts.push(yes(`${t} installed`));
  if (!other.length) facts.push(maybe("No other tracking tools detected (Meta Pixel, LinkedIn, Hotjar, Clarity…)"));
  return { pages, withGa, withGtm, ga, ua, gtm, other, facts };
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
      return elementRule(d, { htmlList: (p) => p.unlabelled || [], psiIds: ["label", "select-name"], problem: "has no label", noun: "form field",
        passText: (n) => `Every form field has a label, across all ${n} pages.` });
    } },
  { id: "a11y-names", section: "Launch checks", owner: "Designer", title: "Accessibility: every button and link has a name (icon-only links need a label)",
    run: (d) => {
      return elementRule(d, { htmlList: (p) => [...(p.noNameButtons || []), ...(p.noNameLinks || [])], psiIds: ["button-name", "link-name", "input-button-name"],
        problem: "has no text or label for screen readers", noun: "button or link", passText: (n) => `Every button and link has a readable name, across all ${n} pages.` });
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
      if (keys.length) return { state: "fail", summary: `${plural(keys.length, "type")} of accessibility problem found. Lowest Google accessibility score: ${low} out of 100.`,
        items: keys.slice(0, 20).map((k) => { const f = fails[k]; const ex = (f[0].o.examples || []).find((e) => e && !/^</.test(e)); return item(`${plainA11y(f[0].o)} Affects ${plural(f.length, "page")}, e.g. ${path(f[0].p.url)}${ex ? ` (near "${ex.slice(0, 50)}")` : ""}.`, f[0].p.url); }) };
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
      const facts = [
        s.https?.cert?.valid ? yes("HTTPS works with a valid certificate") : no(`HTTPS problem: ${sslReason(s.https?.cert?.error)}`),
        s.httpRedirect?.toHttps ? yes(`http:// redirects to ${s.httpRedirect.finalUrl}`) : no(`http:// does not redirect to https:// (ends at ${s.httpRedirect?.finalUrl || "nothing"})`),
      ];
      return { state: facts.every((f) => f.ok) ? "pass" : "fail", facts, summary: "" };
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
      return { state: found.length ? "manual" : "fail", facts: trackingFacts(d).facts, summary: found.length
        ? "Confirm data is arriving (GA Realtime, Tag Assistant)."
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
      const tf = trackingFacts(d);
      const facts = tf.facts.filter((f) => /Analytics/.test(f.text));
      if (!withGa.length && withGtm.length) return { state: "review", facts, summary: "Check inside Tag Manager or GA Realtime that Analytics is set up." };
      if (!withGa.length) return { state: "fail", facts, summary: "Google Analytics needs adding." };
      const missing = pages.filter((p) => !withGa.includes(p) && !withGtm.includes(p));
      if (missing.length) return { state: "fail", facts, summary: `Missing on ${plural(missing.length, "page")}.`, items: listPages(missing) };
      const cov = coverageNote(d);
      if (cov || withGa.length < pages.length) return { state: "review", facts, summary: `${withGa.length < pages.length ? "Some pages only via Tag Manager. " : ""}${cov}` };
      return { state: "pass", facts, summary: "" };
    } },
{ id: "sd-gtm", section: "Launch checks", owner: "Senior Developer", title: "Google Tag Manager is installed",
    run: (d) => {
      const pages = okPages(d);
      const withGtm = pages.filter((p) => p.gtm?.length);
      const facts = trackingFacts(d).facts.filter((f) => /Tag Manager/.test(f.text));
      if (!withGtm.length) return { state: "fail", facts, summary: "Google Tag Manager needs adding." };
      const missing = pages.filter((p) => !p.gtm?.length);
      if (missing.length) return { state: "fail", facts, summary: `Missing on ${plural(missing.length, "page")}.`, items: listPages(missing) };
      const cov = coverageNote(d);
      if (cov) return { state: "review", facts, summary: cov };
      return { state: "pass", facts, summary: "" };
    } },
{ id: "sd-client-tracking", section: "Launch checks", owner: "Senior Developer", title: "Any client-specific tracking tools are installed",
    run: (d) => {
      const other = [...new Set(okPages(d).flatMap((p) => p.trackers || []))];
      return { state: "manual", facts: trackingFacts(d).facts.filter((f) => !/Analytics|Tag Manager/.test(f.text)),
        summary: other.length ? "Confirm these are the ones the client needs." : "Confirm with the client what they need (some tools load inside Tag Manager)." };
    } },
{ id: "sd-sitemap", section: "Launch checks", owner: "Senior Developer", title: "XML sitemap is in place",
    run: (d) => {
      const sm = d.start?.sitemap || {};
      if (!sm.files?.length) return { state: "fail", facts: [no("No XML sitemap found (checked robots.txt, /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml)")], summary: "" };
      if (!sm.count) return { state: "fail", facts: [yes("Sitemap found"), no("It lists no pages")], summary: "", items: sm.files.map((f) => item(f, f)) };
      return { state: "pass", facts: [yes(`Sitemap found at ${path(sm.files[0])}`), yes(`Lists ${plural(sm.count, "page")}`)], summary: "", links: [item("Open sitemap", sm.files[0])] };
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
      if (!c.valid) return { state: "fail", facts: [no(`No valid certificate: ${sslReason(c.error)}`)], summary: "" };
      const soon = c.daysLeft != null && c.daysLeft < 14;
      const facts = [yes(`Certificate valid, issued by ${c.issuer || "unknown issuer"}`), soon ? no(`Expires in ${plural(c.daysLeft, "day")} (${c.validTo}): check it auto-renews`) : yes(`Expires ${c.validTo}${c.daysLeft != null ? ` (${c.daysLeft} days away)` : ""}`)];
      return { state: soon ? "review" : "pass", facts, summary: "" };
    } },
{ id: "la-robots", section: "Launch actions", owner: "Developer", title: "robots.txt allows search engines to index public content",
    run: (d) => {
      const r = d.start?.robots || {};
      const problems = [];
      if (r.blockedFor?.length) problems.push(item(`robots.txt blocks the whole site for: ${r.blockedFor.join("; ")}`));
      if (r.homeNoindex) problems.push(item(`Homepage is set to noindex (${[r.homeRobotsMeta, r.homeRobotsHeader].filter(Boolean).join(" / ")}). On WordPress: Settings → Reading → untick "Discourage search engines".`));
      const noindex = okPages(d).filter((p) => p.noindex && p.url !== d.start?.finalUrl);
      const info = noindex.length ? [item(`${plural(noindex.length, "page")} set to noindex (fine for thank-you or private pages):`), ...listPages(noindex, 15)] : [];
      const facts = [
        r.blockedFor?.length ? no(`robots.txt blocks the whole site for ${r.blockedFor.join("; ")}`) : r.found ? yes("robots.txt allows search engines to crawl the site") : maybe("No robots.txt file (crawling is allowed by default)"),
        r.homeNoindex ? no("Homepage is set to noindex") : yes("Homepage can be indexed"),
        noindex.length ? maybe(`${plural(noindex.length, "page")} set to noindex: check they should be`) : yes("No other pages are set to noindex"),
      ];
      if (problems.length) return { state: "fail", facts, summary: r.homeNoindex ? "On WordPress: Settings → Reading → untick \"Discourage search engines\"." : "", items: info };
      return { state: noindex.length ? "review" : "pass", facts, summary: "", items: info,
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

// One plain-English line per element, e.g. 'Link to /about on the "Services" page has no text or label.'
// Deduplicated across the HTML scan and Lighthouse (same page + same link/field).
function describeEl(snippet, pageLabel) {
  const sn = String(snippet || "");
  const href = /href="([^"]*)"/.exec(sn)?.[1];
  const type = /type="([^"]*)"/.exec(sn)?.[1];
  const nameAttr = /name="([^"]*)"/.exec(sn)?.[1];
  const id = /#([\w-]+)/.exec(sn)?.[1] || /id="([^"]*)"/.exec(sn)?.[1];
  const tag = /^<(\w+)/.exec(sn)?.[1]?.toLowerCase() || "";
  const cls = /\.([\w-]+)/.exec(sn)?.[1] || /class="([^"\s]+)/.exec(sn)?.[1];
  const short = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname).replace(/\/$/, ""); } catch { return u; } };
  let what, key;
  if (tag === "a" || href !== undefined) { what = href ? `Link to ${short(href)}` : "A link with no address"; key = `a:${href || cls || ""}`; }
  else if (tag === "button" || type === "submit" || type === "button" || type === "reset") { what = `A ${type === "submit" ? "submit " : ""}button${id ? ` (#${id})` : cls ? ` (${cls})` : ""}`; key = `b:${id || cls || type || ""}`; }
  else if (tag === "select") { what = `A dropdown${nameAttr ? ` (${nameAttr})` : id ? ` (#${id})` : ""}`; key = `s:${nameAttr || id || ""}`; }
  else if (tag === "textarea") { what = `A text box${nameAttr ? ` (${nameAttr})` : id ? ` (#${id})` : ""}`; key = `t:${nameAttr || id || ""}`; }
  else if (tag === "input" || type) { what = `The ${type || "text"} field${nameAttr ? ` "${nameAttr}"` : id ? ` #${id}` : ""}`; key = `i:${nameAttr || id || type || ""}`; }
  else { what = sn.replace(/<[^>]*>/g, "").trim().slice(0, 60) || "An element"; key = `x:${sn.slice(0, 80)}`; }
  return { text: `${what} on ${pageLabel}`, key: `${pageLabel}|${key}` };
}
function elementItems(d, { htmlList, psiIds, problem }) {
  const pages = okPages(d);
  const psi = d.psi || {};
  const seen = new Set();
  const out = [];
  for (const p of pages) {
    const label = p.title ? `the "${p.title.replace(/\s*[|–-].*$/, "").trim()}" page` : `the page ${path(p.url)}`;
    const snippets = [...htmlList(p), ...psiIds.flatMap((id) => psi[p.url]?.ownFails?.[id] || [])];
    for (const sn of snippets) {
      const e = describeEl(sn, label);
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      out.push(item(`${e.text} ${problem}.`, p.url));
    }
  }
  return out;
}
function elementRule(d, { htmlList, psiIds, problem, noun, passText }) {
  const items = elementItems(d, { htmlList, psiIds, problem });
  if (items.length) {
    const pagesHit = new Set(items.map((i) => i.href)).size;
    return { state: "fail", summary: `${plural(items.length, noun)} ${problem} on ${plural(pagesHit, "page")}.`, items: items.slice(0, 60) };
  }
  const cov = coverageNote(d);
  if (cov) return { state: "review", summary: `None found on the pages checked. ${cov}` };
  return { state: "pass", summary: passText(okPages(d).length) };
}


export function evaluateLaunch(d) {
  return LAUNCH_CHECKS.map((c) => {
    let r;
    try { r = c.run(d) || { state: "manual" }; } catch (e) { r = { state: "manual", summary: `Could not evaluate: ${e.message}` }; }
    return { ...c, run: undefined, ...r, items: r.items || [], links: r.links || [], facts: r.facts || [] };
  });
}

export const STATE_LABEL = { pass: "Passed automatically", fail: "Problems found", review: "Worth a look", manual: "Manual check" };
