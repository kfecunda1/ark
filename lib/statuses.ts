import { createClient } from "@/lib/supabase/server";
import type { StatusRecord } from "@/lib/types";

// Statuses are now admin-managed data (supabase/migrations/019_
// statuses.sql's `statuses` table, Settings → Statuses) rather than a
// fixed list — same shape and reasoning as lib/products.ts. Server-
// only; client components receive the result as a prop.
//
// Always ordered by sort_order, so "keep the existing order on first
// load" (every seeded row's sort_order matches the old hard-coded
// list's order) holds everywhere without each caller re-sorting.
export async function getAllStatuses(): Promise<StatusRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("statuses").select("*").order("sort_order");
  if (error) {
    console.error("[getAllStatuses] query failed:", error.message);
  }
  return (data as StatusRecord[] | null) ?? [];
}

export async function getActiveStatuses(): Promise<StatusRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("statuses").select("*").eq("active", true).order("sort_order");
  if (error) {
    console.error("[getActiveStatuses] query failed:", error.message);
  }
  return (data as StatusRecord[] | null) ?? [];
}

// A project only really counts as "closed" once it's reached the Status
// stage and landed on a status whose kind marks it completed or lost.
// Used by the dashboard and list page instead of comparing against a
// hard-coded status name, since a status can be renamed freely.
export function isClosedStatus(status: string | null, statuses: StatusRecord[]): boolean {
  if (!status) return false;
  const kind = statuses.find((s) => s.name === status)?.kind;
  return kind === "completed" || kind === "lost";
}
