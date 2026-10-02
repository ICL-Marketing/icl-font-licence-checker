import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "flc_session";

function secret() {
  return process.env.CHECKER_PASSWORD || "";
}

export function isConfigured() {
  return Boolean(secret());
}

export function makeToken() {
  return createHmac("sha256", secret()).update("icl-font-licence-checker").digest("hex");
}

export function tokenIsValid(token) {
  if (!token || !isConfigured()) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(makeToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordIsValid(pw) {
  if (!isConfigured() || typeof pw !== "string") return false;
  const a = Buffer.from(pw);
  const b = Buffer.from(secret());
  return a.length === b.length && timingSafeEqual(a, b);
}
