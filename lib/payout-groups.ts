import { createClient } from "@/lib/supabase/server";
import type { PayoutGroup } from "@/lib/types";

// Admin-managed data (supabase/migrations/025_payouts.sql's
// `payout_groups` table, Settings → Groups) — same shape and reasoning
// as lib/statuses.ts. RLS on this table is admin-only for every
// operation (including select), so these two will return an empty
// list for a non-admin caller rather than erroring — callers are
// already only ever invoked from admin-gated pages (Settings, the
// Payouts route).
//
// Always ordered by sort_order, same "keep the existing order" reason
// every other admin-managed list here follows.
export async function getAllPayoutGroups(): Promise<PayoutGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payout_groups").select("*").order("sort_order");
  if (error) {
    console.error("[getAllPayoutGroups] query failed:", error.message);
  }
  return (data as PayoutGroup[] | null) ?? [];
}

export async function getActivePayoutGroups(): Promise<PayoutGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payout_groups").select("*").eq("active", true).order("sort_order");
  if (error) {
    console.error("[getActivePayoutGroups] query failed:", error.message);
  }
  return (data as PayoutGroup[] | null) ?? [];
}
