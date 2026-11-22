"use client";

import { useEffect, useState } from "react";
import { langFromBrowserLocale, type Lang } from "@/lib/i18n";

// The login and change-password pages have no signed-in profile yet
// (or, for change-password, one whose language may not reflect
// anything the person has actually chosen) to read a language from —
// both follow the browser's own language instead. Starts "en" (the
// SSR/first-paint default, matching what the server necessarily
// renders with no `navigator` to read) and corrects itself once
// mounted; same hydration-safe shape as components/projects/projects-
// board.tsx's useCoarsePointer, and the same reason the one
// synchronous setState call below is deliberately silenced rather than
// restructured around.
export function useBrowserLang(): Lang {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLang(langFromBrowserLocale(navigator.language));
  }, []);
  return lang;
}
