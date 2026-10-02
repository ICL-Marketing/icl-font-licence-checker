// Client-friendly emails. One for fonts, one for stock images. Each returns
// null when the site has nothing the client needs to answer. Pure functions,
// safe in the browser.

function pagePath(url) {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    return p ? p : "the home page";
  } catch {
    return "";
  }
}
function pageLabel(url) {
  const p = pagePath(url);
  if (!p) return "";
  return p === "the home page" ? p : `the ${p} page`;
}
function fileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()); } catch { return url; }
}
export function isFreeLib(flag) {
  return /free/i.test(flag || "");
}
function foundryName(f) {
  const m = f.meta?.manufacturer || "";
  return m.replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|the|co)\b\.?/gi, "").replace(/[\s.,]+$/g, "").replace(/\s*,\s*$/, "").replace(/\s+/g, " ").trim();
}
function altFromFix(fix) {
  const m = /Free alternative on Google Fonts: ([^.]+)\./.exec(fix || "");
  return m ? m[1].trim() : "";
}

const INTRO = (site, what, count) =>
`Hi [Client name],

As part of looking after your website, we have recently run a ${what} licence check across every site we manage. ${what === "font" ? "Font designers" : "Stock photo agencies"} have started using automated tools to track down their work online and send out fees, so we would rather get ahead of it than wait for a letter. The check itself is part of our service, so there is nothing to pay for it.

The check found ${count} item${count === 1 ? "" : "s"} on ${site} that we would like to confirm with you. Please reply with whatever you can on each point, using the numbers for reference:

`;

const OUTRO = `

What happens next: once we hear back, we will make any changes needed. In most cases the fix is quick and nothing changes visually on the site. If you are not sure about any of these, just say so and we will take it from there.

Kind regards,

[Your name]
ICL Digital`;

export function buildFontEmail(r) {
  if (!r || r.status === "RUNNING" || r.status === "UNREACHABLE") return null;
  const fonts = (r.fonts || []).filter((f) => f.status === "PROBLEM" || f.status === "CHECK");
  if (!fonts.length) return null;
  const items = fonts.map((f, idx) => {
    const n = idx + 1;
    const where = f.foundOn?.length ? pageLabel(f.foundOn[0]) : "";
    const whereTxt = where ? ` (used on ${where}${f.foundOn?.length > 1 ? " and others" : ""})` : "";
    const foundry = foundryName(f);
    const alt = altFromFix(f.fix);
    const isFaPro = /font awesome/i.test(f.family) && /pro/i.test(f.note || f.family);
    let found, need, next;
    if (isFaPro) {
      found = "The site uses the paid Pro version of the Font Awesome icon set, installed directly on the website.";
      need = "Do you have a Font Awesome Pro subscription, or was one set up by a previous developer? If so, please send us the account details or receipt.";
      next = "If there is no subscription, we can switch the site to the free version. The icons look the same for almost all uses.";
    } else if (f.status === "PROBLEM") {
      found = `The font "${f.family}" is installed directly on the website${foundry ? `. It is a paid typeface from ${foundry}` : ". It is a paid typeface"}, and we have not been able to find a licence that covers using it on your website.`;
      need = "Do you, or a designer who worked with you previously, hold a web licence for this font? If so, please send us a copy of the licence or the purchase receipt.";
      if (f.adobe === "yes") {
        next = "Good news: this font is available through our Adobe Fonts subscription. If no licence exists, we can switch it over to that at no cost to you, and the site will look exactly the same.";
      } else if (f.adobe === "no") {
        next = `If no licence exists, there are two options: buy a web licence for the font, or switch to a very similar free font${alt ? ` (for example ${alt})` : ""}. We can advise on which makes sense and handle the change.`;
      } else {
        next = `If no licence exists, we will check whether it is available through our Adobe Fonts subscription (no cost to you). If not, the options are a web licence for the font or a very similar free font${alt ? ` such as ${alt}` : ""}, and we can handle either.`;
      }
    } else {
      found = `The font "${f.family}" is installed directly on the website, and we could not identify who owns it or where it came from.`;
      need = "Could you tell us whether this font was supplied by you, by a designer, or as part of your brand guidelines? If you have any paperwork or a receipt for it, please send it over.";
      next = "Once we know where it came from we can confirm whether anything needs to change. If it turns out to be a paid font with no licence, we will offer the same options as above.";
    }
    return `${n}. Font: ${f.family}${whereTxt}\n   What we found: ${found}\n   What we need from you: ${need}\n   Next step: ${next}`;
  });
  const count = items.length;
  return {
    site: r.site, count, kind: "fonts",
    subject: `${r.site} – website font licence check (${count} font${count === 1 ? "" : "s"} to confirm)`,
    body: INTRO(r.site, "font", count) + items.join("\n\n") + OUTRO,
  };
}

export function buildImageEmail(r) {
  if (!r || r.imgStatus !== "DONE") return null;
  const images = (r.images || []).filter((i) => i.flag && !isFreeLib(i.flag));
  if (!images.length) return null;
  const items = images.map((i, idx) => {
    const n = idx + 1;
    const onPage = i.page ? ` (on ${pageLabel(i.page)})` : "";
    const credit = i.meta ? ` The file also carries a credit tag (${i.meta.slice(0, 80)}).` : "";
    return `${n}. Image: ${fileName(i.url)}${onPage}\n` +
      `   What we found: The file name suggests this image came from ${i.flag}.${credit}\n` +
      `   What we need from you: Do you have the purchase record or licence for this image? A receipt, an order number, or the account it was bought under is enough.\n` +
      `   Next step: If there is no record, we can replace it with a licensed or free alternative, or buy a licence for it.`;
  });
  const count = items.length;
  return {
    site: r.site, count, kind: "images",
    subject: `${r.site} – website image licence check (${count} image${count === 1 ? "" : "s"} to confirm)`,
    body: INTRO(r.site, "stock image", count) + items.join("\n\n") + OUTRO,
  };
}
