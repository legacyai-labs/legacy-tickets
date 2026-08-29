import type { Metadata, Viewport } from "next";
import { SignedIn } from "@/components/SignedIn";
import "../tokens.css";
import "./globals.css";
import "./fonts.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Legacy AI — Tickets",
  description:
    "The Ticket Board — the operative memory for bugs, tasks and ideas; humans and the Autopilot file, retrieve and work them.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Re-apply the stored logo-toggle theme before first paint (no flash). */
const THEME_INIT = `try{if(localStorage.getItem("legacy-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {children}
        <SignedIn />
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
