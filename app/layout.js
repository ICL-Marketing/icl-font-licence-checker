import "./globals.css";
import AuthWatch from "@/app/authWatch";

export const metadata = {
  title: "ICL Digital · Sales",
  description: "Scans live sites for font licence risks and stock-image flags.",
  // ICL Digital's own favicon, loaded from the live site.
  icons: { icon: "https://icldigital.com/favicon.ico", apple: "https://icldigital.com/apple-touch-icon.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900"><AuthWatch />{children}</body>
    </html>
  );
}
