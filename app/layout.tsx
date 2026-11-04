import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { AmbientOrbs } from "@/components/ambient-orbs";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "ARK",
  description: "ARK — private project tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full`}>
      <body className="min-h-full bg-[#080b12] font-sans antialiased">
        <AmbientOrbs />
        {children}
      </body>
    </html>
  );
}
