import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClauseGuard AI — Autonomous Contract Redlining",
  description:
    "Enterprise contract review powered by LangGraph, Auto-Merging Playbook RAG, and Human-in-the-Loop approval.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
