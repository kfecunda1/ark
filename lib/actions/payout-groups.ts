"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Payout groups (supabase/migrations/025_payouts.sql) are shaped like
// statuses/products plus `default_share_pct` — hide/show and reorder
// still go through lib/actions/catalog.ts's setCatalogItemActive/
// moveCatalogItem ("payout_groups" is one of SortableCatalogTable's
// tables there). RLS on payout_groups is admin-only for every
// operation, so these actions don't re-check admin-ness themselves,
// same as every other action in this app that relies on RLS rather
// than an app-level check.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

function validateSharePct(value: number): string | null {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return "Default share must be a number between 0 and 100.";
  }
  return null;
}

export async function addPayoutGroup(name: string, defaultSharePct: number): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
  }
  const shareError = validateSharePct(defaultSharePct);
  if (shareError) {
    return { error: shareError };
  }

  try {
    const supabase = await createClient();
    const { data: last } = await supabase
      .from("payout_groups")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

    const { error } = await supabase
      .from("payout_groups")
      .insert({ name: trimmed, default_share_pct: defaultSharePct, sort_order: nextSortOrder });
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function updatePayoutGroup(
  id: string,
  name: string,
  defaultSharePct: number
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
  }
  const shareError = validateSharePct(defaultSharePct);
  if (shareError) {
    return { error: shareError };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("payout_groups")
      .update({ name: trimmed, default_share_pct: defaultSharePct })
      .eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    revalidatePath("/payouts");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
