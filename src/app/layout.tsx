import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/opspilot/styles/marketing.css";
import "@/opspilot/styles/refinements.css";
export const metadata: Metadata = {
  title: "OpsPilot — Your business, beautifully connected",
  description: "Your Entire Business. One Operating System. Bring your customers, finances, projects, people, and inventory together in one thoughtful workspace.",
  applicationName: "OpsPilot",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en" suppressHydrationWarning><body>{children}</body></html>; }
