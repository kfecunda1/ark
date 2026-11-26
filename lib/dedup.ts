// Fuzzy "is this basically the same name" check for the Inbox's quick-
// create duplicate warning (components/inbox/quick-create-panel.tsx) —
// "same or very similar name or nickname (case-insensitive, ignore
// punctuation and legal suffixes like LLC, GmbH, AG, S.A, Ltd, Corp)".
// Pure string logic, no DB access, so it's safe to import from either
// a server action (the real check, against real candidates) or a
// client component (none currently do, but nothing here needs server-
// only guarding).

// Longest-first so "s a" doesn't swallow part of a longer suffix that
// also ends in those letters before the real (longer) one is tried.
const LEGAL_SUFFIXES = [
  "corporation",
  "incorporated",
  "limited",
  "company",
  "gmbh",
  "ltd",
  "corp",
  "inc",
  "llc",
  "s a",
  "sa",
  "ag",
  "co",
  "plc",
  "bv",
  "nv",
].sort((a, b) => b.length - a.length);

export function normalizeNameForDedup(name: string): string {
  let s = name
    .toLowerCase()
    .trim()
    // Punctuation (periods, commas, quotes, parens, dashes, slashes) ->
    // space, so "S.A." and "S A" normalize the same way.
    .replace(/[.,'"()[\]{}\-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const suffix of LEGAL_SUFFIXES) {
    const re = new RegExp(`\\s${suffix.replace(/ /g, "\\s")}$`);
    if (re.test(s)) {
      s = s.replace(re, "").trim();
      break;
    }
  }

  return s;
}

// Classic edit distance — short strings only (receiver/project/
// opportunity names), so the plain O(n*m) table is plenty fast.
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) table[i][0] = i;
  for (let j = 0; j < cols; j++) table[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
    }
  }
  return table[rows - 1][cols - 1];
}

// Exact match after normalizing (case/punctuation/legal suffix), one
// fully containing the other (e.g. "Acme" vs "Acme Trading"), or close
// enough by edit distance relative to length (typos, minor spelling
// variants) — never on an empty normalized string, which would
// otherwise trivially "match" everything.
export function namesAreSimilar(a: string, b: string): boolean {
  const na = normalizeNameForDedup(a);
  const nb = normalizeNameForDedup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;

  const distance = levenshteinDistance(na, nb);
  const longer = Math.max(na.length, nb.length);
  return distance <= Math.max(1, Math.floor(longer * 0.2));
}

// Shared shape for the Inbox's quick-create "Similar: X — use this
// instead?" banner — one match found by a findSimilar* function
// (lib/actions/projects.ts, lib/actions/contacts.ts, lib/actions/
// opportunities.ts), whichever entity type it's for.
export interface SimilarMatch {
  id: string;
  label: string;
  href: string;
}

// True if `candidate` (an existing record's name, or nickname) is
// similar to either the typed name or nickname.
export function isSimilarToEither(
  candidateName: string,
  name: string,
  nickname: string | null | undefined
): boolean {
  if (namesAreSimilar(candidateName, name)) return true;
  if (nickname && namesAreSimilar(candidateName, nickname)) return true;
  return false;
}
