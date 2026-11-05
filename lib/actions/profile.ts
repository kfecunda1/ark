"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Only ever sends { full_name } — profiles_update_self already confines
// this to the caller's own row, and 011_settings_tables.sql's
// profiles_protect_role trigger refuses any attempt to smuggle a role
// change into the same UPDATE, so there's no need to double-check
// either restriction here.
export async function updateOwnFullName(fullName: string): Promise<{ error: string | null }> {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { error: "Display name is required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in." };
    }

    const { error } = await supabase.from("profiles").update({ full_name: trimmed }).eq("id", user.id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
