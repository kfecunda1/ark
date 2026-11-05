"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Products and document_types (supabase/migrations/011_settings_tables.
// sql) are identically shaped admin-managed lists — one name, one
// active flag, one sort_order — so one set of actions serves the
// Settings page's Products and Document Types sections instead of
// duplicating the same five functions twice. RLS itself (both tables'
// insert/update policies require is_admin()) is the real gate; these
// actions don't re-check admin-ness themselves, same as every other
// action in this app that relies on RLS rather than an app-level check.
export type CatalogTable = "products" | "document_types";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function addCatalogItem(table: CatalogTable, name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
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
    return { error: "Name is required." };
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

export async function setCatalogItemActive(
  table: CatalogTable,
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
  table: CatalogTable,
  items: CatalogSortRef[],
  id: string,
  direction: "up" | "down"
): Promise<{ error: string | null }> {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((item) => item.id === id);
  if (index === -1) {
    return { error: "Item not found." };
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
