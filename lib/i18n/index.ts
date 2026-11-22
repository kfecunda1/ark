import en from "@/lib/i18n/en";
import es from "@/lib/i18n/es";

// Client-safe — no server imports here at all (see lib/i18n/server.ts
// for the one that reads the current user's own language). Keeping
// this file itself import-free of anything server-only is what lets
// lib/i18n/es.ts's `Dictionary` type-check against `typeof en` without
// dragging next/headers into every client bundle that just wants the
// dictionary shape.
export type Lang = "en" | "es";

export type Dictionary = typeof en;

const DICTIONARIES: Record<Lang, Dictionary> = { en, es };

export function getDictionary(lang: Lang): Dictionary {
  return DICTIONARIES[lang];
}

export function isLang(value: string | null | undefined): value is Lang {
  return value === "en" || value === "es";
}

// A catalog item (StatusRecord, DocumentTypeRecord — both carry an
// optional name_es, supabase/migrations/031_spanish.sql) shows its
// Spanish name to a Spanish-language user once an admin has set one,
// and its plain English `name` otherwise — never a blank. Products
// have no name_es column at all (their codes, SBLC/MT103/…, stay the
// same in every language), so this never applies to them.
export function catalogLabel(item: { name: string; name_es?: string | null }, lang: Lang): string {
  if (lang === "es" && item.name_es && item.name_es.trim()) return item.name_es;
  return item.name;
}

// "follow the browser language until the user is known" (login/
// change-password pages, before there's a profile to read language
// from) — navigator.language is "es", "es-MX", "es-419", etc. for any
// Spanish variant; everything else falls back to English.
export function langFromBrowserLocale(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith("es") ? "es" : "en";
}

// Server actions that return `{ error: string | null }` return a
// stable KEY (one of Dictionary["errors"]'s own property names, e.g.
// "notSignedIn") for any expected/generic condition, never an already-
// translated sentence — the action has no reliable way to know the
// caller's language is the UI's, not the DB's. The calling component
// resolves it to display text through this helper at render time.
// Anything that *isn't* a recognized key (a raw Postgres/Supabase
// error message, which can't be enumerated up front) passes through
// unchanged — those stay in English regardless of `lang`; seeing one
// at all should be rare, since it means something failed below the
// validation layer.
export function resolveError(error: string | null, lang: Lang): string | null {
  if (error === null) return null;
  const errors = getDictionary(lang).errors as Record<string, string>;
  return errors[error] ?? error;
}
