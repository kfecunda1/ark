// The one shared rule behind every nickname display surface
// (supabase/migrations/033_nicknames.sql): show the nickname when one
// is set, the full name otherwise. Client-safe (no server imports) —
// used from both server and client components alike, same as lib/
// i18n/index.ts's catalogLabel, which this deliberately mirrors.
//
// Two-argument core rather than a single `record` argument: Projects
// carry their full name as `name`, Receivers as `full_name` — two
// different field names on two different types, so one shared
// implementation only works taking the full name as a plain string.
// projectDisplayName/receiverDisplayName below are the one-argument
// convenience wrappers every call site actually reaches for.
export function displayName(fullName: string, nickname: string | null | undefined): string {
  const trimmed = nickname?.trim();
  return trimmed ? trimmed : fullName;
}

export function projectDisplayName(project: { name: string; nickname?: string | null }): string {
  return displayName(project.name, project.nickname);
}

export function receiverDisplayName(contact: { full_name: string; nickname?: string | null }): string {
  return displayName(contact.full_name, contact.nickname);
}

// True when the nickname is actually in effect (set and non-blank) —
// every "show the full name on hover / as a second line" call site
// only needs that extra treatment while this holds; when it's false,
// the short name and the full name are the same string, and repeating
// it as a title/second line would be pure noise.
export function hasDisplayNickname(nickname: string | null | undefined): boolean {
  return Boolean(nickname?.trim());
}
