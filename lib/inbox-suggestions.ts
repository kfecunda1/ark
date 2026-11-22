// Smart filing suggestions for "To file" inbox items — pure, read-only
// matching over data already fetched for the Inbox page (app/(app)/
// inbox/page.tsx); nothing here writes anything. Two independent
// suggestions are produced: a filing destination (buildInboxSuggestions)
// and a document type (suggestDocumentType) — see components/inbox/
// inbox-tabs.tsx for how they're shown ("Suggested: X — File here").
import { projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import type { DocumentTypeRecord, InboxItem } from "@/lib/types";

// Generic words common in company/entity names that would otherwise
// produce false-positive matches across unrelated receivers/projects
// (e.g. two different "... Group" receivers both "matching" on
// "group"). Punctuation is already stripped before this is checked, so
// "S.A." arrives as "s"/"a" and is excluded by the length filter alone.
const GENERIC_WORDS = new Set([
  "ltd",
  "llc",
  "inc",
  "corp",
  "sa",
  "srl",
  "gmbh",
  "sarl",
  "group",
  "company",
  "co",
  "the",
  "and",
  "for",
  "international",
  "holdings",
  "holding",
  "limited",
]);

function normalizeWords(text: string, minLength = 3): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= minLength);
}

function distinctiveWords(name: string): string[] {
  return normalizeWords(name).filter((w) => !GENERIC_WORDS.has(w));
}

export interface SuggestedDestination {
  type: "project" | "contact";
  id: string;
  label: string;
}

export interface InboxSuggestionInput {
  projects: { id: string; name: string; nickname?: string | null }[];
  contacts: { id: string; full_name: string; nickname?: string | null }[];
  people: { id: string; first_name: string; last_name: string | null }[];
  receiverIntermediaries: { person_id: string; receiver_id: string }[];
  projectIntermediaries: { person_id: string; project_id: string }[];
}

function itemWordSet(item: InboxItem): Set<string> {
  const text = [item.file_name, item.text_or_caption, item.forwarded_from].filter(Boolean).join(" ");
  return new Set(normalizeWords(text));
}

function scoreAgainst(words: string[], itemWords: Set<string>): number {
  let score = 0;
  for (const w of words) {
    if (itemWords.has(w)) score += w.length;
  }
  return score;
}

// Up to `limit` best-matching project/receiver destinations for a
// single "To file" item — direct name matches, plus matches on an
// intermediary/contact person's name resolved to whichever
// receiver(s)/project(s) they're an intermediary for (a person is
// never itself a valid filing destination).
export function buildInboxSuggestions(
  item: InboxItem,
  input: InboxSuggestionInput,
  limit = 3
): SuggestedDestination[] {
  const itemWords = itemWordSet(item);
  if (itemWords.size === 0) return [];

  const scored = new Map<string, { dest: SuggestedDestination; score: number }>();

  function consider(dest: SuggestedDestination, score: number) {
    if (score <= 0) return;
    const key = `${dest.type}:${dest.id}`;
    const existing = scored.get(key);
    if (!existing || score > existing.score) {
      scored.set(key, { dest, score });
    }
  }

  for (const project of input.projects) {
    const words = [...distinctiveWords(project.name), ...(project.nickname ? distinctiveWords(project.nickname) : [])];
    consider({ type: "project", id: project.id, label: projectDisplayName(project) }, scoreAgainst(words, itemWords));
  }

  for (const contact of input.contacts) {
    const words = [
      ...distinctiveWords(contact.full_name),
      ...(contact.nickname ? distinctiveWords(contact.nickname) : []),
    ];
    consider({ type: "contact", id: contact.id, label: receiverDisplayName(contact) }, scoreAgainst(words, itemWords));
  }

  const receiverIdsByPerson = new Map<string, string[]>();
  for (const ri of input.receiverIntermediaries) {
    receiverIdsByPerson.set(ri.person_id, [...(receiverIdsByPerson.get(ri.person_id) ?? []), ri.receiver_id]);
  }
  const projectIdsByPerson = new Map<string, string[]>();
  for (const pi of input.projectIntermediaries) {
    projectIdsByPerson.set(pi.person_id, [...(projectIdsByPerson.get(pi.person_id) ?? []), pi.project_id]);
  }
  const contactById = new Map(input.contacts.map((c) => [c.id, receiverDisplayName(c)]));
  const projectById = new Map(input.projects.map((p) => [p.id, projectDisplayName(p)]));

  for (const person of input.people) {
    const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ");
    const words = distinctiveWords(fullName);
    const score = scoreAgainst(words, itemWords);
    if (score <= 0) continue;

    for (const receiverId of receiverIdsByPerson.get(person.id) ?? []) {
      const label = contactById.get(receiverId);
      if (label) consider({ type: "contact", id: receiverId, label }, score);
    }
    for (const projectId of projectIdsByPerson.get(person.id) ?? []) {
      const label = projectById.get(projectId);
      if (label) consider({ type: "project", id: projectId, label }, score);
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.dest);
}

// Groups of interchangeable tokens for the document-type guess below —
// a filename containing any one of a group counts toward a document
// type whose own name contains any other member of that same group
// (e.g. a file called "MT103.pdf" should still suggest a document type
// named "SWIFT/MT103").
const SYNONYM_GROUPS: string[][] = [
  ["swift", "mt103", "mt760", "mt799", "mt202", "mt799a"],
  ["pof", "proof", "funds"],
  ["doa", "deed", "authorization", "authorisation"],
  ["pgl", "guarantee", "letter"],
  ["cis", "client", "information", "sheet"],
  ["kyc"],
];
const SYNONYM_GROUP_BY_WORD = new Map<string, number>();
SYNONYM_GROUPS.forEach((group, i) => group.forEach((w) => SYNONYM_GROUP_BY_WORD.set(w, i)));

function wordMatches(candidateWord: string, itemWords: Set<string>): boolean {
  if (itemWords.has(candidateWord)) return true;
  const groupIndex = SYNONYM_GROUP_BY_WORD.get(candidateWord);
  if (groupIndex == null) return false;
  return SYNONYM_GROUPS[groupIndex].some((w) => itemWords.has(w));
}

// Best-guess active document type for a "To file" item's file name
// (also checking the caption, in case the type is named in the message
// rather than the file) — null if nothing scores above zero. Type
// codes like "CIS"/"DOA"/"PGL"/"POF" are only 3 letters, so the normal
// minLength=3 word filter already keeps them without a special case.
export function suggestDocumentType(item: InboxItem, documentTypes: DocumentTypeRecord[]): string | null {
  const text = [item.file_name, item.text_or_caption].filter(Boolean).join(" ");
  const itemWords = new Set(normalizeWords(text, 2));
  if (itemWords.size === 0) return null;

  let best: { name: string; score: number } | null = null;
  for (const dt of documentTypes) {
    if (!dt.active) continue;
    const words = normalizeWords(dt.name, 2).filter((w) => !GENERIC_WORDS.has(w));
    if (words.length === 0) continue;
    let score = 0;
    for (const w of words) {
      if (wordMatches(w, itemWords)) score += w.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { name: dt.name, score };
    }
  }
  return best?.name ?? null;
}
