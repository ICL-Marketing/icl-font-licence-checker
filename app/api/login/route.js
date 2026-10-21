import { cookies } from "next/headers";
import { COOKIE, DOMAIN, MIN_PASSWORD, cookieOptions, makeSession, readSession, normEmail, emailAllowed, teamPasswordIsValid, hashPassword, checkPassword } from "@/lib/auth";
import { storeConfigured, getUser, setUser, counterIncr, counterGet } from "@/lib/store";

export const dynamic = "force-dynamic";

// Too many wrong tries for one email (or from one address) and sign-in pauses for 15 minutes.
const LOCK = 8, WINDOW = 15 * 60;
const ipOf = (request) => (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
async function locked(email, ip) { return (await counterGet(`auth:fail:${email}`)) >= LOCK || (await counterGet(`auth:failip:${ip}`)) >= LOCK * 3; }
async function failed(email, ip) { await counterIncr(`auth:fail:${email}`, WINDOW); await counterIncr(`auth:failip:${ip}`, WINDOW); }
const no = (error, status = 401, extra = {}) => Response.json({ ok: false, error, ...extra }, { status });
async function signIn(email) { (await cookies()).set(COOKIE, makeSession(email), cookieOptions); return Response.json({ ok: true, email }); }

// Who is signed in, and their details for emails (first name and role; the name defaults to the email's).
const firstFrom = (email) => { const w = String(email || "").split("@")[0].split(/[._-]+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
export async function GET() {
  const email = readSession((await cookies()).get(COOKIE)?.value) || "";
  const user = email ? await getUser(email) : null;
  return Response.json({ email, profile: { name: user?.profile?.name || firstFrom(email), role: user?.profile?.role || "" } });
}

// { email, password } signs in. The first time ({ email, teamPassword, newPassword }) sets the person's own password.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  // Signed in and saving your own details: { profile: { name, role } }.
  if (b.profile && !b.email) {
    const me = readSession((await cookies()).get(COOKIE)?.value);
    const user = me ? await getUser(me) : null;
    if (!user) return no("Not signed in");
    const profile = { name: String(b.profile.name || "").trim().slice(0, 40), role: String(b.profile.role || "").trim().slice(0, 60) };
    await setUser(me, { ...user, profile });
    return Response.json({ ok: true, profile });
  }
  const email = normEmail(b.email), ip = ipOf(request);
  if (!emailAllowed(email)) return no(`Use your @${DOMAIN} email address.`, 400);
  if (!storeConfigured()) return no("Sign-in needs the shared store (Redis) to be set up.", 503);
  if (await locked(email, ip)) return no("Too many tries. Wait 15 minutes, then try again.", 429);
  const user = await getUser(email);

  if (b.newPassword !== undefined) {
    if (user) return no("This email already has a password. Sign in with it instead.", 409);
    if (!teamPasswordIsValid(b.teamPassword)) { await failed(email, ip); return no("The team password isn't right."); }
    const pw = String(b.newPassword || "");
    if (pw.length < MIN_PASSWORD) return no(`Use at least ${MIN_PASSWORD} characters.`, 400);
    if (teamPasswordIsValid(pw)) return no("Choose your own password, not the team one.", 400);
    await setUser(email, { hash: hashPassword(pw), createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
    return signIn(email);
  }

  if (!user) return no("First time? Create your password.", 404, { needsSetup: true });
  if (!checkPassword(String(b.password || ""), user.hash)) { await failed(email, ip); return no("Wrong email or password."); }
  await setUser(email, { ...user, lastLogin: new Date().toISOString() });
  return signIn(email);
}

export async function DELETE() {
  (await cookies()).delete(COOKIE);
  return Response.json({ ok: true });
}
