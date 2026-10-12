"use client";
// Where "Open in Outlook" goes. Outlook on the web can't be told which font to use, so its text can come
// out a different size from your signature; the Outlook app (a mailto link) always uses your own default font.
export const MAIL_KEY = "flc-mail-app";
export const mailApp = () => { try { return localStorage.getItem(MAIL_KEY) || "web"; } catch { return "web"; } };
export function mailHref(to, subject, body) {
  const t = encodeURIComponent(to || ""), sub = encodeURIComponent(subject || ""), b = encodeURIComponent(body || "");
  return mailApp() === "app" ? `mailto:${t}?subject=${sub}&body=${b}` : `https://outlook.office.com/mail/deeplink/compose?to=${t}&subject=${sub}&body=${b}`;
}
