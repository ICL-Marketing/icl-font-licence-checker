import { execSync } from "node:child_process";

// The version shown next to "ICL Sales": v1.<number of commits>, so each push bumps it.
// Without full git history (e.g. a Docker build) it falls back to the short commit id.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || "local").slice(0, 7);
const git = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const count = git("git rev-parse --is-shallow-repository") === "false" ? git("git rev-list --count HEAD") : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // One self-contained Node server (server.js), for Docker / Google Cloud Run.
  output: "standalone",
  // Which version is live: shown small at the bottom of the page.
  env: { NEXT_PUBLIC_BUILD: commit, NEXT_PUBLIC_VERSION: count ? `v1.${count}` : commit, NEXT_PUBLIC_BUILT_AT: new Date().toISOString() },
  // The spell checker reads its dictionary from disk at runtime.
  outputFileTracingIncludes: {
    "/api/launch": ["./node_modules/dictionary-en-gb/index.aff", "./node_modules/dictionary-en-gb/index.dic"],
    // The headless browser for screenshots of one part of a page.
    "/api/shot": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
