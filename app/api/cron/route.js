// The morning lead scan (lib/morningScan.js).
//   GET  ?key=CRON_SECRET  the daily schedule (GitHub Actions): starts the scan and answers straight away.
//   GET  (signed in)       last run, settings, whether one is running and whether the secret is set.
//   POST (signed in)       {action: "run"} starts a scan now; {action: "config", on, modes} saves the settings.
// The proxy lets this route through without the team login; it checks the key or the login itself.
import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { COOKIE, tokenIsValid } from "@/lib/auth";
import { runMorningScan, morningConfig, morningRunning, MORNING_MODES } from "@/lib/morningScan";
import { getSetting, setSetting } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const keyOk = (k) => {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || !k) return false;
  const a = Buffer.from(String(k)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};
const signedIn = (request) => tokenIsValid(request.cookies.get(COOKIE)?.value);

async function start(by) {
  const cfg = await morningConfig();
  if (await morningRunning()) return Response.json({ started: false, reason: "A scan is already running." });
  after(() => runMorningScan({ modes: cfg.modes, by }).catch(() => {}));
  return Response.json({ started: true, modes: cfg.modes });
}

export async function GET(request) {
  const key = new URL(request.url).searchParams.get("key");
  if (key) {
    if (!keyOk(key)) return Response.json({ error: "Wrong key" }, { status: 401 });
    const cfg = await morningConfig();
    if (!cfg.on) return Response.json({ started: false, reason: "The morning scan is switched off in Settings." });
    return start("Morning scan");
  }
  if (!signedIn(request)) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ config: await morningConfig(), modes: MORNING_MODES, last: await getSetting("morning-scan").catch(() => null), running: await morningRunning(), secretSet: Boolean(process.env.CRON_SECRET) });
}

export async function POST(request) {
  if (!signedIn(request)) return Response.json({ error: "Not signed in" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  if (b.action === "run") return start("Run now (Settings)");
  if (b.action === "config") {
    const modes = (Array.isArray(b.modes) ? b.modes : []).filter((m) => MORNING_MODES.some(([k]) => k === m));
    await setSetting("morning-scan-config", { on: b.on !== false, modes });
    return Response.json({ config: await morningConfig() });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
