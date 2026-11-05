// Minimal CSV serializer for the backup export (components/settings/
// export-backup-button.tsx) — every table export is a flat array of
// Supabase rows, so this doesn't need to handle anything fancier than
// RFC 4180 quoting plus JSON-stringifying the occasional jsonb column
// (e.g. activity_log.details).
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);

  function cell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const lines = [headers.map(cell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => cell(row[h])).join(","));
  }
  return lines.join("\n");
}
