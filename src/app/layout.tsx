import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavelength",
  description:
    "A browser recreation of the party game Wavelength: two teams, a Psychic, and a hidden target on a dial.",
};

export const viewport: Viewport = {
  themeColor: "#0c0a09",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-stone-950 antialiased">{children}</body>
    </html>
  );
}
