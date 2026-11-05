"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Only ever sends { full_name } — profiles_update_self already confines
// this to the caller's own row, and 012_user_management.sql's
// profiles_protect_admin_fields trigger refuses any attempt to smuggle
// a role/active/must_change_password change into the same UPDATE, so
// there's no need to double-check either restriction here.
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

// Called by components/settings/change-password-form.tsx right after
// supabase.auth.updateUser() reports success on the client — that
// report is never trusted on its own. This independently re-
// authenticates, server-side, with the *new* password, which proves
// it actually took effect for this exact account before clearing
// must_change_password; the flag is then cleared through the
// service-role client specifically so this write can never be
// defeated by profiles_protect_admin_fields or any other RLS/trigger
// subtlety on the caller's own session (that trigger already allows a
// non-admin to clear this flag on their own row, but routing the
// write through the service role removes that path from the picture
// entirely, rather than depending on it).
//
// The only thing this can ever write is must_change_password = false,
// for the caller's own id taken from their verified session — never a
// value the client supplies, never another user's row, and never
// role/active. There is deliberately no "set it back to true" sibling
// — that only ever happens through lib/actions/users.ts, as an admin.
export async function confirmPasswordChanged(newPassword: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return { error: "Not signed in." };
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: newPassword,
    });
    if (verifyError) {
      return { error: "Could not confirm the password change. Please try again." };
    }

    const service = createServiceClient();
    const { error: clearError } = await service
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);
    if (clearError) {
      return { error: clearError.message };
    }

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
