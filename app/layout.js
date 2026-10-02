import "./globals.css";

export const metadata = {
  title: "Font licence checker · ICL Digital",
  description: "Scans live sites for font licence risks and stock-image flags.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  );
}
