/** @type {import('next').NextConfig} */
const nextConfig = {
  // One self-contained Node server (server.js), for Docker / Google Cloud Run.
  output: "standalone",
  // Which version is live: shown small at the bottom of the page.
  env: { NEXT_PUBLIC_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_SHA || "local").slice(0, 7), NEXT_PUBLIC_BUILT_AT: new Date().toISOString() },
  // The spell checker reads its dictionary from disk at runtime.
  outputFileTracingIncludes: {
    "/api/launch": ["./node_modules/dictionary-en-gb/index.aff", "./node_modules/dictionary-en-gb/index.dic"],
    // The headless browser for screenshots of one part of a page.
    "/api/shot": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
