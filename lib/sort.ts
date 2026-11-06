// Shared by the Projects, Receivers, and Contacts (People) list pages'
// column sorting
// (components/sort-controls.tsx drives the URL; each page calls this
// with its own per-column value-extractor). One comparator handles
// every column because "empty values always last, regardless of
// direction" is the one rule every column follows the same way —
// including Stage/Status, whose getValue returns the column's position
// in its own pipeline order — Stage's fixed STAGES index, Status's
// admin-managed sort_order (lib/statuses.ts) — rather than alphabetic
// text, so numeric comparison is all this ever needs.
export type SortDirection = "asc" | "desc";

export function compareNullsLast<T>(
  a: T,
  b: T,
  getValue: (item: T) => number | string | null,
  direction: SortDirection
): number {
  const av = getValue(a);
  const bv = getValue(b);

  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;

  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return direction === "asc" ? cmp : -cmp;
}

export function parseSortDirection(value: string | undefined): SortDirection {
  return value === "desc" ? "desc" : "asc";
}
