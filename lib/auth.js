import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";

// Sign-in: each person uses their ICL email and their own password. The first time, they prove they're
// on the team with the shared team password (CHECKER_PASSWORD), then set their own.
export const COOKIE = "flc_session";
// Only ICL addresses, fixed in the code so no setting can widen it.
export const DOMAIN = "icldigital.com";
export const MIN_PASSWORD = 10;
const SESSION_DAYS = 30;

const teamPassword = () => process.env.CHECKER_PASSWORD || "";
// Sessions are signed with SESSION_SECRET (falls back to the team password, so nothing new is needed).
const sessionSecret = () => process.env.SESSION_SECRET || teamPassword();

export function isConfigured() {
  return Boolean(teamPassword());
}
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const emailAllowed = (e) => new RegExp(`^[^@\\s]+@${DOMAIN.replace(/\./g, "\\.")}$`).test(normEmail(e));

const sign = (data) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

// A session cookie: who it is and when it runs out, signed so it can't be made up or changed.
export function makeSession(email) {
  const body = Buffer.from(JSON.stringify({ e: normEmail(email), x: Date.now() + SESSION_DAYS * 86400000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function readSession(token) {
  if (!token || !isConfigured()) return null;
  const [body, mac] = String(token).split(".");
  if (!body || !mac || !same(mac, sign(body))) return null;
  try { const d = JSON.parse(Buffer.from(body, "base64url").toString()); return d.x > Date.now() && emailAllowed(d.e) ? d.e : null; } catch { return null; }
}
export const tokenIsValid = (token) => Boolean(readSession(token));
export const cookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400 };

export function teamPasswordIsValid(pw) {
  return isConfigured() && typeof pw === "string" && same(pw, teamPassword());
}

// Passwords are stored as a salted scrypt hash, never as themselves.
export function hashPassword(pw) {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(String(pw), salt, 64).toString("base64url")}`;
}
export function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  return same(scryptSync(String(pw), salt, 64).toString("base64url"), hash);
}
