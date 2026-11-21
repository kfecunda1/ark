"use client";

import { useEffect } from "react";

// Registers public/sw.js — a deliberate no-cache passthrough, never a
// real cache (see that file's own comment for why one exists at all).
// Production-only: a service worker sitting in front of the Next.js
// dev server just gets in the way of hot reloading and has no
// installability benefit there anyway. Rendered once from the root
// layout so it's registered the same way on every page, login
// included.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have, not a requirement — a failed
      // registration (unsupported browser, blocked, …) should never
      // surface as a user-facing error.
    });
  }, []);

  return null;
}
