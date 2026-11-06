"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { StatusColor } from "@/lib/types";

// Statuses (supabase/migrations/019_statuses.sql) are shaped like
// products/document_types (lib/actions/catalog.ts) plus `kind` and
// `color`, which need their own add/rename — hide/show and reorder
// still go through catalog.ts's setCatalogItemActive/moveCatalogItem
// ("statuses" is one of SortableCatalogTable's tables there).
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function addStatus(
  name: string,
  kind: "open" | "completed" | "lost",
  color: StatusColor
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
  }

  try {
    const supabase = await createClient();
    const { data: last } = await supabase
      .from("statuses")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

    const { error } = await supabase
      .from("statuses")
      .insert({ name: trimmed, kind, color, sort_order: nextSortOrder });
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function updateStatus(
  id: string,
  name: string,
  kind: "open" | "completed" | "lost",
  color: StatusColor
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("statuses").update({ name: trimmed, kind, color }).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
