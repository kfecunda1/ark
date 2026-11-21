import type { MetadataRoute } from "next";

// Next.js's manifest file convention — automatically served at
// /manifest.webmanifest and linked from <head> on every page, no extra
// wiring needed. Icons live in public/icons/ (generated from one
// original ARK mark — app/globals.css's own steel-blue/silver palette,
// no third-party logo); app/icon.png and app/apple-icon.png (favicon
// and apple-touch-icon) are separate Next.js file conventions, from
// the same source artwork.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ARK",
    short_name: "ARK",
    description: "ARK — private project tracker",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#080b12",
    theme_color: "#080b12",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
