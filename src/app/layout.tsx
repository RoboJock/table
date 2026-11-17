import type { Metadata } from "next";
import { Fraunces, Figtree } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "../components/AppShell";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Table",
  description: "A shared table for a small group, with membership rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <Suspense fallback={<p className="status">Loading…</p>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
