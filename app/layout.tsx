import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SyncInit } from "@/components/SyncInit";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";
import { PlayerProvider } from "@/lib/playerContext";
import { PaywallHost } from "@/components/paywall/PaywallHost";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * Absolute base for og:/twitter: URLs — link previews (creator profiles are
 * shared as links) need absolute URLs, and relative ones are dropped without
 * this. Vercel injects VERCEL_PROJECT_PRODUCTION_URL; the localhost fallback
 * keeps dev renders from throwing.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Loro",
  description: "Learn Spanish one swipe at a time.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Loro",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0d0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        <ServiceWorkerCleanup />
        <SyncInit />
        {/*
          The shared player is mounted here, above every route, because it must
          survive navigation: iOS blesses a player instance, and a remount
          throws that blessing away (see lib/playerContext.tsx). It costs
          nothing on routes that never play — the iframe and the IFrame API
          script are only fetched on the first actual request to play.
        */}
        <PlayerProvider>{children}</PlayerProvider>
        {/* Renders nothing unless a save is refused by the free-tier limit, and
            nothing can refuse one while PAYWALL_ENABLED is false. Mounted here
            so a blocked save opens the paywall from whichever screen it
            happened on, without every save surface knowing the paywall
            exists. */}
        <PaywallHost />
      </body>
    </html>
  );
}
