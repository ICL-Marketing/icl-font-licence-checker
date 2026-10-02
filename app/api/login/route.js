import { cookies } from "next/headers";
import { COOKIE, makeToken, passwordIsValid } from "@/lib/auth";

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));
  if (!passwordIsValid(password)) {
    return Response.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }
  const store = await cookies();
  store.set(COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(COOKIE);
  return Response.json({ ok: true });
}
