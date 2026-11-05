import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "Contacts" became "Receivers" in the UI (supabase/migrations/016_
  // receivers_and_people.sql's comment, AGENTS.md's UI-naming-vs-
  // database-naming note) — old bookmarks/links to /contacts still
  // resolve, permanently redirected to the new /receivers URLs. The
  // underlying `contacts` table/route data is unchanged; only the path
  // moved.
  async redirects() {
    return [
      { source: "/contacts", destination: "/receivers", permanent: true },
      { source: "/contacts/:path*", destination: "/receivers/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
