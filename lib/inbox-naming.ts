// "Pre-fill the name from the item: the caption or first text line if
// present, otherwise the file name without extension and without
// obvious noise (dates, "document_123", "IP2IP", product codes, "CIS",
// "POF", "DOA", "PGL", underscores)." — the Inbox's quick-create forms
// (components/inbox/project-quick-create-fields.tsx and friends) use
// this as a starting point only; the user can always edit it before
// saving. Pure string logic, usable from either the server (if ever
// needed) or a client component.

// The seeded defaults (supabase/migrations/001_ark_schema.sql /
// 011_settings_tables.sql) — an admin-renamed or newly added product/
// document type just won't get stripped, which is fine: this is a
// best-effort suggestion, not a requirement.
const NOISE_WORDS = [
  "SBLC",
  "MX103",
  "MT103",
  "IP-IP",
  "IP2IP",
  "API Cash",
  "API",
  "T2T",
  "S2S",
  "VISA",
  "GPI",
  "KTK",
  "CIS",
  "POF",
  "DOA",
  "PGL",
  "JSON",
  "document",
  "doc",
  "scan",
  "copy",
  "final",
  "signed",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function cleanFileNameForSuggestion(fileName: string): string {
  let name = stripFileExtension(fileName).replace(/_/g, " ");

  // Dates: 2026-11-21, 2026.11.21, 21-11-2026, 20261121.
  name = name.replace(/\b\d{4}[-.]\d{1,2}[-.]\d{1,2}\b/g, " ");
  name = name.replace(/\b\d{1,2}[-.]\d{1,2}[-.]\d{2,4}\b/g, " ");
  name = name.replace(/\b\d{8}\b/g, " ");

  for (const word of NOISE_WORDS) {
    name = name.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"), " ");
  }

  // Leftover standalone numbers (ids, counters — "document_123" is
  // already "document 123" by this point, and "document" was just
  // stripped above, leaving a bare "123").
  name = name.replace(/\b\d+\b/g, " ");

  return name.replace(/\s+/g, " ").trim();
}

export function suggestNameFromInboxItem(item: { text_or_caption?: string | null; file_name?: string | null }): string {
  const caption = item.text_or_caption?.trim();
  if (caption) {
    const firstLine = caption.split(/\r?\n/)[0]?.trim();
    if (firstLine) return firstLine.slice(0, 80);
  }
  if (item.file_name) {
    return cleanFileNameForSuggestion(item.file_name).slice(0, 80);
  }
  return "";
}
