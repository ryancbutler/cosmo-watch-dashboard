import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COSMO · Your family, in view",
  description: "A private, read-only view of your family's COSMO watches.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
