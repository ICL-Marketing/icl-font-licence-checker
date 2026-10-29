import { NextResponse } from "next/server";
import { COOKIE, isConfigured, tokenIsValid } from "@/lib/auth";

export function proxy(request) {
  const { pathname } = request.nextUrl;
  // /api/cron and /api/mcp (the Claude connector) check their own secret key (or, for cron, the login) themselves.
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login") || pathname === "/api/cron" || pathname === "/api/mcp") {
    return NextResponse.next();
  }
  // No password configured = open (local dev). Set CHECKER_PASSWORD in production.
  if (!isConfigured()) return NextResponse.next();

  if (tokenIsValid(request.cookies.get(COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
