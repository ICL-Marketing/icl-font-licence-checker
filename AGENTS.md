# Notes for AI agents

This is Next.js 16 (App Router, JavaScript, Tailwind v4). APIs and conventions
may differ from older versions: read the relevant guide in
`node_modules/next/dist/docs/` before writing code. `proxy.js` is the Next 16
name for middleware.

The scanner logic lives in `lib/scanner.js` and runs server-side only
(fontkit, cheerio, exifr). Keep one site per `/api/scan` request so each call
stays inside the serverless time limit; the browser drives the queue.
