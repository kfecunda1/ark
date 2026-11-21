import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AmbientOrbs } from "@/components/ambient-orbs";
import { RegisterServiceWorker } from "@/components/register-service-worker";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

// The "ARK" wordmark only (components/sidebar.tsx, app/login/page.tsx)
// — weight 600 is the only one loaded, since nothing else uses this
// font. Body copy stays on DM Sans throughout.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "ARK",
  description: "ARK — private project tracker",
  // iOS home-screen install (app/manifest.ts covers Android/desktop
  // PWA installability) — capable + a title distinct from the browser
  // tab title, and a status bar style dark enough to blend with our
  // own near-black background instead of showing a contrasting bar.
  appleWebApp: {
    capable: true,
    title: "ARK",
    statusBarStyle: "black-translucent",
  },
  // Next's appleWebApp.capable only emits the modern, standards-track
  // "mobile-web-app-capable" meta tag — added here explicitly too,
  // since older iOS/Safari versions only ever recognized this
  // Apple-specific name for enabling standalone mode.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

// viewportFit: "cover" is what lets the page extend under the notch/
// Dynamic Island and home indicator in standalone mode at all — without
// it, every env(safe-area-inset-*) used throughout the app (TopBar,
// Sidebar, the main content area, the login/change-password pages)
// resolves to 0 and those areas just go unused letterboxing instead.
export const viewport: Viewport = {
  themeColor: "#080b12",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${spaceGrotesk.variable} h-full`}>
      <body className="min-h-full bg-[#080b12] font-sans antialiased">
        <RegisterServiceWorker />
        <AmbientOrbs />
        {children}
      </body>
    </html>
  );
}
