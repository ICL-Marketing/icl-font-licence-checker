# ICL font licence checker

Internal web app that scans ICL's live sites and reports, per site, every
web font in use, where it is served from, and whether the licence looks OK,
needs a human check, or looks like a problem. Also flags images whose
filename or embedded metadata points at a stock library.

Built after the Glosrose / Paratype "Circe" ticket: a commercial font's
desktop `.otf` files had been uploaded to the server instead of loading via
the Adobe Fonts kit. The checker is designed to catch that pattern across
all sites.

Free to run: Next.js on Vercel's free plan, no database, no API keys.

## Deploy (once, about 5 minutes)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** this repo. Framework is detected
   automatically. Deploy.
3. In the Vercel project: **Settings → Environment Variables** add
   `CHECKER_PASSWORD` = a shared team password. Redeploy.
4. Open the URL, sign in with the password, press **Run check**.

With no `CHECKER_PASSWORD` set the app is open (fine for local dev only).

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

## How to use

1. The site list is prefilled with the ICL Live Sites spreadsheet. Edit it
   if needed (one domain per line).
2. Press **Run check**. Sites are scanned 4 at a time, about 5 to 15
   seconds each, so the full list takes roughly 10 minutes. Leave the tab
   open.
3. Results sort worst first. Click a tile to filter, click a site to see
   the fonts, evidence and action.
4. **Download Excel** gives a workbook with Summary, Fonts, Images and
   CSS-families sheets.
5. Results are remembered in your browser until you press **Clear**.

## What the statuses mean

| Status | Meaning |
|--------|---------|
| **PROBLEM** | Font file on our own server whose metadata names a commercial foundry (Paratype, Monotype, Hoefler, Fontsmith...) or Adobe/Typekit, or whose family is a known commercial typeface (Circe, Proxima Nova, Gotham, Gilroy, Avenir...). Raw `.otf`/`.ttf` on the server makes it worse: desktop font, not web font. |
| **CHECK** | Needs a human: Adobe Fonts / fonts.com / cloud.typography kits (is the subscription still active and ours?), Font Awesome kits (Free or Pro?), font files with no licence text, base64-embedded fonts, or sites that could not be fetched. |
| **OK** | Google Fonts / Bunny Fonts, or a file carrying an open licence (OFL, Apache, MIT, GPL), or a known free family / icon set. |
| **NO WEB FONTS** | Only system fonts. |

Site status = worst font on the site.

## How it works

1. Fetches the homepage (tries https, www, http) and a few internal links.
2. Finds every stylesheet, `@import`, `<link>`/`<script>` to a font
   service, and every `@font-face` rule, including inline CSS.
3. Downloads each self-hosted font file and reads the embedded name table
   (family, copyright, manufacturer, designer, licence text, licence URL,
   vendor ID). This is the same data Paratype's scanner reads.
4. Flags image filenames like `shutterstock_123456.jpg` and reads
   EXIF/XMP/IPTC copyright and credit tags from images on the crawled pages.

Each site is scanned in its own request (`/api/scan`) so the work stays
inside Vercel's function time limit. The browser runs the queue.

## Limits

- Fonts loaded only by JavaScript after page load can be missed.
- Only the homepage plus a few pages are crawled. Raise "Pages per site"
  for deeper checks.
- "OK" means the licence text looks open. "PROBLEM" means investigate, not
  guilty.
- Image checking is filename and metadata only. It cannot tell whether a
  stock image was paid for. Treat it as a list to cross-check against
  purchase records.
- Results live in the browser's local storage, not a database. Download
  the Excel file to keep a record.

## Fix pattern for a PROBLEM font

1. Find out where the file came from (ask whoever built the site, check
   the copyright/manufacturer shown in the evidence column).
2. If it is on Adobe Fonts and we have Creative Cloud: add it to an Adobe
   Fonts web project, embed the kit `<link>`, delete the `.otf`/`.ttf`
   files from the server. Keep a screenshot of the kit as proof.
3. If it is a commercial font we have no web licence for: buy a web font
   licence for that domain (keep the receipt), or swap to a free
   equivalent on Google Fonts.
4. Press **Re-scan** on that site to confirm it is clean.

## Project layout

```
app/page.js            UI: site list, progress, tiles, per-site cards
app/login/page.js      Password screen
app/api/scan/route.js  Scans one site (POST { site, pages })
app/api/export/route.js  Builds the Excel workbook from results
app/api/login/route.js Sets / clears the session cookie
proxy.js               Redirects to /login when CHECKER_PASSWORD is set
lib/scanner.js         The scanner: crawl, CSS, font metadata, images
lib/auth.js            Cookie token helpers
data/sites.js          Default site list
```
