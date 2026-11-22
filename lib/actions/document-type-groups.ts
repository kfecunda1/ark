"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

// Settings → Document checklists' "Document Groups" area — adding/
// removing a group's member document types. The RLS insert/delete
// policies already confine this to admins; the isCurrentUserAdmin()
// check just turns a denied RLS write into a clean message instead of
// a raw Postgres error, same reasoning as setProductRequiredDocument.
export async function addDocumentTypeGroupMember(
  groupId: string,
  documentType: string
): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanEditChecklists" };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("document_type_group_members")
      .upsert({ group_id: groupId, document_type: documentType }, { onConflict: "group_id,document_type" });
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

export async function removeDocumentTypeGroupMember(
  groupId: string,
  documentType: string
): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanEditChecklists" };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("document_type_group_members")
      .delete()
      .eq("group_id", groupId)
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
