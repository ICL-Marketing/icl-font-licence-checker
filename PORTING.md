# Moving Website Checker into a Laravel + plain JavaScript system

This app runs on Vercel (Next.js) for now. It is laid out so it can be moved
into ICL's own Laravel systems without redesigning anything.

## The shape of the app

```
Browser (one page, React today -> Blade + plain JS later)
   |  small JSON POST requests, one short job each (max ~50s)
   v
/api/* endpoints (Next.js route handlers -> Laravel controllers)
   |
   v
lib/*.js  (plain JavaScript, no framework code)
```

**The browser drives every long job.** A full-site scan is many short requests
(10 pages at a time) so nothing needs a queue worker or long-running process.
Keep this pattern in Laravel: a controller per endpoint, each finishing well
inside the PHP max execution time.

## Endpoints to recreate (same JSON in, same JSON out)

| Endpoint | Input | Output | Logic lives in |
|---|---|---|---|
| `POST /api/login` | `{password}` | sets cookie | `lib/auth.js` (one shared password, HMAC cookie) |
| `POST /api/scan` | `{site, pages, mode: fonts/images}` | one site's fonts (`status, fonts[], ignoredFonts, platform…`) or first image batch (`images[], pageQueue[], hasSitemap`) | `lib/scanner.js` → `scanSite()` |
| `POST /api/scan-pages` | `{site, urls[≤12]}` | `{done[], remaining[], images[], links[]}` | `lib/scanner.js` → `sweepPages()` |
| `POST /api/launch` step `start` | `{url}` | site facts: SSL, http→https, robots, sitemap, MX, `pageQueue[]` | `lib/launch.js` → `launchStart()` |
| `POST /api/launch` step `pages` | `{urls[≤12]}` | per-page facts (title, description, alt, mixed content, trackers, a11y, typos…) | `lib/launch.js` → `launchPages()` |
| `POST /api/launch` step `urls` | `{urls[≤40]}` | status + size of each link/image | `lib/launch.js` → `checkUrls()` |
| `POST /api/launch` step `psi` | `{url}` | compact Google PageSpeed result | `lib/launch.js` → `psiAudit()`, `compactPsi()` |
| `POST /api/export` | `{kind, results}` or `{kind:"launch", launch}` | `.xlsx` | `app/api/export/route.js` (ExcelJS → PhpSpreadsheet) |
| `POST /api/signoff-log` | `{site, url, scannedAt, checks, signed, log}` | `.docx` | `app/api/signoff-log/route.js` (docx → PhpWord) |
| `GET/POST /api/signoffs`, `/api/team` | | shared sign-offs / team names | `lib/store.js` (replace with DB tables) |
| `GET/POST /api/clients` | | shared client list (name, websites, account manager, contacts, emails) | `lib/clients.js`, `data/clients.json` (seed from the Web Clients sheet) |
| `POST/PUT /api/clients/file` | `.xlsx` upload / `{clients}` | client rows / `.xlsx` download | `app/api/clients/file/route.js` (ExcelJS → PhpSpreadsheet) |
| `GET /api/marker` | | Marker.io connection test (lists MCP tools) | `lib/marker.js` (small MCP-over-HTTP client; Guzzle in PHP) |
| `POST /api/marker` | `{title, description, project}` | `{ok, link}` snag created in Marker.io | `lib/marker.js` → `createIssue()` |

## Plain-JavaScript logic that can be reused directly in the browser

These files import nothing from React or Next.js. They can be served as-is to
a Blade page (or translated to PHP if the team prefers server-side):

- `lib/fontlink.js` – issue labels, colours, free-route links, stock-library links, licence signal.
- `lib/email.js` – client email templates (segments → text/HTML).
- `lib/launchChecks.js` – the 40 launch checks and how each is judged (`evaluateLaunch(data)`).
- `data/sites.js`, `data/team.js`, `data/fa-free.json`, `data/fa5-free.json` – reference lists.

Server-only files (need PHP equivalents): `lib/scanner.js`, `lib/launch.js`.

## PHP equivalents for the Node libraries

| Node | PHP |
|---|---|
| cheerio (HTML parsing) | symfony/dom-crawler |
| fontkit (font metadata) | dompdf/php-font-lib (**needs the brotli extension or a decoder for .woff2**) |
| exifr (image credit tags) | built-in `exif_read_data()` |
| image-size | built-in `getimagesize()` |
| exceljs | phpoffice/phpspreadsheet |
| docx | phpoffice/phpword |
| nspell + dictionary-en-gb (spell check) | `enchant` extension, or the same Hunspell `.dic` file with a PHP reader |
| node:tls / node:dns (certificate, MX) | `stream_socket_client` + `openssl_x509_parse`, `dns_get_record` |

## Data kept in the browser today (becomes database tables)

| localStorage key | Contents | Suggested table |
|---|---|---|
| `flc-results-v2` | per-site font and image results | `scans` (site, kind, json, scanned_at) |
| `flc-launch-v1` | per-site launch check data | `launch_scans` |
| `flc-launch-signoffs-v1` | `{site: {checkId: {name, at}}}` | `signoffs` |
| `flc-launch-log-v1` | sign-off history entries | `signoff_log` |
| `flc-team-v1` | team names and roles | `settings` |
| `flc-clients-v1` | client list | `clients` |
| `flc-email-edits-v1` | edited email text | `email_edits` |

## Settings / environment

- `CHECKER_PASSWORD` – shared login password.
- `PSI_API_KEY` – Google PageSpeed Insights key (free).
- `MARKER_MCP_URL`, `MARKER_MCP_TOKEN` – Marker.io MCP server address and personal access token (expires every 90 days).
