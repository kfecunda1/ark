"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Settings → Document checklists' grid (components/settings/document-
// checklist-grid.tsx) — one checkbox per (product, document_type)
// cell. The RLS insert/update/delete policies already confine this to
// admins; the isCurrentUserAdmin() check just turns a denied RLS
// write into a clean message instead of a raw Postgres error, same
// reasoning as deleteProject/deleteContact.
export async function setProductRequiredDocument(
  product: string,
  documentType: string,
  required: boolean
): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "Only admins can edit document checklists." };
    }

    const supabase = await createClient();
    const { error } = required
      ? await supabase
          .from("product_required_documents")
          .upsert({ product, document_type: documentType }, { onConflict: "product,document_type" })
      : await supabase
          .from("product_required_documents")
          .delete()
          .eq("product", product)
          .eq("document_type", documentType);

    if (error) {
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
      return { error: "Only admins can change this setting." };
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
