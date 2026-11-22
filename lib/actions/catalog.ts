"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Products and document_types (011_settings_tables.sql) are identically
// shaped admin-managed lists — one name, one active flag, one
// sort_order — so one set of add/rename actions serves the Settings
// page's Products and Document Types sections instead of duplicating
// the same two functions twice. RLS itself (both tables' insert/update
// policies require is_admin()) is the real gate; these actions don't
// re-check admin-ness themselves, same as every other action in this
// app that relies on RLS rather than an app-level check.
export type CatalogTable = "products" | "document_types";

// statuses (019_statuses.sql) and payout_groups (025_payouts.sql) share
// that same active/sort_order shape for hide-show and reorder purposes
// — but not for add/rename: each also has required columns
// (kind/color, default_share_pct) that addCatalogItem/renameCatalogItem
// below don't set, so they only ever appear here, on
// setCatalogItemActive/moveCatalogItem, never on those two. Their own
// add/rename actions live in lib/actions/statuses.ts and lib/actions/
// payout-groups.ts instead.
export type SortableCatalogTable = CatalogTable | "statuses" | "payout_groups";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

export async function addCatalogItem(table: CatalogTable, name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "nameRequired" };
  }

  try {
    const supabase = await createClient();
    const { data: last } = await supabase
      .from(table)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

    const { error } = await supabase.from(table).insert({ name: trimmed, sort_order: nextSortOrder });
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function renameCatalogItem(
  table: CatalogTable,
  id: string,
  name: string
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "nameRequired" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from(table).update({ name: trimmed }).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Document Types' own "Spanish name" field (Settings) — deliberately
// not folded into renameCatalogItem above, which is shared with
// Products: products have no name_es column at all (supabase/
// migrations/031_spanish.sql — their codes stay the same in every
// language), so this only ever targets document_types, never the
// shared CatalogTable union. Blank clears it back to null (falls back
// to the English name for a Spanish-language viewer), not an error.
export async function updateDocumentTypeNameEs(id: string, nameEs: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const trimmed = nameEs.trim();
    const { error } = await supabase
      .from("document_types")
      .update({ name_es: trimmed || null })
      .eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function setCatalogItemActive(
  table: SortableCatalogTable,
  id: string,
  active: boolean
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from(table).update({ active }).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface CatalogSortRef {
  id: string;
  sort_order: number;
}

// Reorders by swapping sort_order with the adjacent item — the caller
// (components/settings/manageable-list.tsx) already has the full
// current list in hand (it's rendering it), so it passes that along
// rather than this action re-fetching it.
export async function moveCatalogItem(
  table: SortableCatalogTable,
  items: CatalogSortRef[],
  id: string,
  direction: "up" | "down"
): Promise<{ error: string | null }> {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((item) => item.id === id);
  if (index === -1) {
    return { error: "itemNotFound" };
  }

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sorted.length) {
    return { error: null };
  }

  const current = sorted[index];
  const neighbor = sorted[neighborIndex];

  try {
    const supabase = await createClient();

    const { error: firstError } = await supabase
      .from(table)
      .update({ sort_order: neighbor.sort_order })
      .eq("id", current.id);
    if (firstError) {
      return { error: firstError.message };
    }

    const { error: secondError } = await supabase
      .from(table)
      .update({ sort_order: current.sort_order })
      .eq("id", neighbor.id);
    if (secondError) {
      return { error: secondError.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
