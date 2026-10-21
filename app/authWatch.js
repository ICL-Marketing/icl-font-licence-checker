"use client";
import { useEffect } from "react";

// When a sign-in runs out mid-session, any call to our API answers 401 "Not signed in":
// go to the sign-in page (and come back to the same page after) instead of showing the error.
export default function AuthWatch() {
  useEffect(() => {
    const original = window.fetch;
    let leaving = false;
    window.fetch = async (...args) => {
      const res = await original(...args);
      try {
        const url = new URL(typeof args[0] === "string" ? args[0] : args[0]?.url || "", window.location.href);
        if (res.status === 401 && url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/login") && !leaving && window.location.pathname !== "/login") {
          leaving = true;
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        }
      } catch {}
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  return null;
}
