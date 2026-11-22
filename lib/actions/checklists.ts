"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

// Settings → Document checklists' grid (components/settings/document-
// checklist-grid.tsx) — one checkbox per (product, document_type)
// cell. The RLS insert/update/delete policies already confine this to
// admins; the isCurrentUserAdmin() check just turns a denied RLS
// write into a clean message instead of a raw Postgres error, same
// reasoning as deleteProject/deleteContact.
//
// Plain insert rather than upsert: product_required_documents' own
// uniqueness (supabase/migrations/032_checklist_groups.sql) is now two
// *partial* unique indexes (one per requirement form, since document_
// type/group_id are each nullable) — Postgres can only infer a partial
// index as an ON CONFLICT target when the predicate is repeated in the
// query, which postgrest-js's upsert() has no way to express. Simplest
// fix: insert plainly and treat a 23505 (unique_violation) as the
// success it actually is — the desired end state ("this requirement
// exists") already holds.
export async function setProductRequiredDocument(
  product: string,
  documentType: string,
  required: boolean
): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanEditChecklists" };
    }

    const supabase = await createClient();
    const { error } = required
      ? await supabase.from("product_required_documents").insert({ product, document_type: documentType })
      : await supabase
          .from("product_required_documents")
          .delete()
          .eq("product", product)
          .eq("document_type", documentType);

    if (error && error.code !== "23505") {
      return { error: error.message };
    }

    revalidatePath("/settings");
    revalidatePath("/projects");
    revalidatePath("/recovery");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Same as setProductRequiredDocument above, but for a requirement on a
// whole document_type_groups row instead of one plain document_type —
// the grid's "Group" rows call this one instead.
export async function setProductRequiredGroup(
  product: string,
  groupId: string,
  required: boolean
): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanEditChecklists" };
    }

    const supabase = await createClient();
    const { error } = required
      ? await supabase.from("product_required_documents").insert({ product, group_id: groupId })
      : await supabase
          .from("product_required_documents")
          .delete()
          .eq("product", product)
          .eq("group_id", groupId);

    if (error && error.code !== "23505") {
      return { error: error.message };
    }

    revalidatePath("/settings");
    revalidatePath("/projects");
    revalidatePath("/recovery");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Settings → Document checklists' "Automatically move a project from
// New to Documents received…" toggle — a separate action (not folded
// into lib/actions/app-settings.ts's updateAppSettings) so this
// section's own form doesn't need to resend default_currency/
// stuck_after_days/show_recovery just to flip one unrelated switch.
export async function updateAutoAdvanceOnDocuments(enabled: boolean): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanChangeThisSetting" };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("app_settings").update({ auto_advance_on_documents: enabled }).eq("id", true);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
