"use server";

import { createClient } from "@/lib/supabase/server";

// "Warn (not block) if a nickname is already used by another receiver
// or project" — a single cross-table check, since a project and a
// receiver nicknamed the same thing would be just as confusing to spot
// in a list as two receivers sharing one. Deliberately not a DB unique
// constraint (supabase/migrations/033_nicknames.sql) — this is advisory
// only, checked from the form on blur, never on submit, and never
// blocks saving.
export interface NicknameMatch {
  id: string;
  type: "project" | "contact";
  // The matching record's own full name/full_name — shown so the
  // warning can name what it actually found, not just "something".
  label: string;
  href: string;
}

export async function findNicknameDuplicates(
  nickname: string,
  exclude?: { type: "project" | "contact"; id: string }
): Promise<NicknameMatch[]> {
  const trimmed = nickname.trim();
  if (!trimmed) return [];

  try {
    const supabase = await createClient();
    const [{ data: projectRows }, { data: contactRows }] = await Promise.all([
      // ilike with no wildcard characters is Postgres's own case-
      // insensitive exact-match form — "Acme" and "ACME" should warn
      // about each other, not just byte-identical nicknames.
      supabase.from("projects").select("id, name, nickname").ilike("nickname", trimmed),
      supabase.from("contacts").select("id, full_name, nickname").ilike("nickname", trimmed),
    ]);

    const matches: NicknameMatch[] = [];
    for (const row of (projectRows as { id: string; name: string; nickname: string | null }[] | null) ?? []) {
      if (exclude?.type === "project" && exclude.id === row.id) continue;
      matches.push({ id: row.id, type: "project", label: row.name, href: `/projects/${row.id}` });
    }
    for (const row of (contactRows as { id: string; full_name: string; nickname: string | null }[] | null) ?? []) {
      if (exclude?.type === "contact" && exclude.id === row.id) continue;
      matches.push({ id: row.id, type: "contact", label: row.full_name, href: `/receivers/${row.id}` });
    }
    return matches;
  } catch (err) {
    console.error("[findNicknameDuplicates] unexpected error:", err instanceof Error ? err.message : "unknown error");
    return [];
  }
}
