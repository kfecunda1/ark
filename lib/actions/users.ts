"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { UserRole } from "@/lib/types";

// A very long ban is Supabase Auth's only way to deactivate a user —
// there's no literal "permanent", so this is the commonly recommended
// effectively-permanent value (10 years). "none" un-bans.
const BAN_DURATION = "87600h";
const MIN_TEMP_PASSWORD_LENGTH = 16;

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// ----------------------------------------------------------------------------
// Every action below starts here: confirm, on the server and against the
// caller's own session (never trusting anything the client claims), that
// whoever is asking is a currently-active admin. Everything after that
// point uses the service-role client — never anything the browser could
// have influenced.
// ----------------------------------------------------------------------------

interface CallingAdmin {
  id: string;
  label: string;
}

async function requireActiveAdmin(): Promise<CallingAdmin | { error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active, full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    const row = profile as { role: string | null; active: boolean; full_name: string | null; email: string | null } | null;

    // Note: is_registered_user() (and so every RLS policy, including
    // this very select) already requires active = true — a deactivated
    // admin's own session can't even read this far, so `row` being null
    // covers that case too, not just "never had a profile".
    if (!row || row.role !== "admin" || row.active !== true) {
      return { error: "You must be an active admin to do this." };
    }

    return { id: user.id, label: row.full_name?.trim() || row.email || "Admin" };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

async function logUserActivity(
  admin: CallingAdmin,
  targetId: string,
  action: "created" | "updated",
  summary: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("activity_log").insert({
      entity_type: "user",
      entity_id: targetId,
      action,
      summary,
      details,
      actor_id: admin.id,
      actor_label: admin.label,
    });
    if (error) {
      console.error("[logUserActivity] failed to write activity log:", error.message);
    }
  } catch (err) {
    console.error("[logUserActivity] unexpected error:", unexpectedErrorMessage(err));
  }
}

// ----------------------------------------------------------------------------
// List
// ----------------------------------------------------------------------------

export interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole | null;
  active: boolean;
  last_sign_in_at: string | null;
}

export async function listUsers(): Promise<{ users: UserRow[]; error: string | null }> {
  const admin = await requireActiveAdmin();
  if ("error" in admin) {
    return { users: [], error: admin.error };
  }

  try {
    const supabase = await createClient();
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, active")
      .order("full_name");
    if (profilesError) {
      return { users: [], error: profilesError.message };
    }

    const service = createServiceClient();
    const { data: authData, error: authError } = await service.auth.admin.listUsers();
    if (authError) {
      return { users: [], error: authError.message };
    }
    const lastSignInById = new Map(authData.users.map((u) => [u.id, u.last_sign_in_at ?? null]));

    const profiles =
      (profilesData as { id: string; full_name: string | null; email: string | null; role: string | null; active: boolean }[] | null) ??
      [];

    const users: UserRow[] = profiles.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: p.role as UserRole | null,
      active: p.active,
      last_sign_in_at: lastSignInById.get(p.id) ?? null,
    }));

    return { users, error: null };
  } catch (err) {
    return { users: [], error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Add user
// ----------------------------------------------------------------------------

export async function addUser(
  fullName: string,
  email: string,
  role: UserRole,
  temporaryPassword: string
): Promise<{ error: string | null }> {
  const admin = await requireActiveAdmin();
  if ("error" in admin) {
    return { error: admin.error };
  }

  const trimmedName = fullName.trim();
  const trimmedEmail = email.trim();
  if (!trimmedName) return { error: "Full name is required." };
  if (!trimmedEmail) return { error: "Email is required." };
  if (role !== "admin" && role !== "member") return { error: "Invalid role." };
  if (temporaryPassword.length < MIN_TEMP_PASSWORD_LENGTH) {
    return { error: `Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.` };
  }

  const service = createServiceClient();

  try {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: trimmedEmail,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return { error: createError?.message ?? "Failed to create the user." };
    }

    const newUserId = created.user.id;

    const { error: profileError } = await service.from("profiles").insert({
      id: newUserId,
      full_name: trimmedName,
      email: trimmedEmail,
      role,
      active: true,
      must_change_password: true,
    });

    if (profileError) {
      // Don't leave an auth user with no profile behind — they'd never
      // be able to do anything (is_registered_user() requires a row).
      const { error: deleteError } = await service.auth.admin.deleteUser(newUserId);
      if (deleteError) {
        console.error("[addUser] failed to roll back orphaned auth user:", deleteError.message);
      }
      return { error: profileError.message };
    }

    await logUserActivity(admin, newUserId, "created", trimmedName, {});

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Reset password
// ----------------------------------------------------------------------------

export async function resetUserPassword(
  userId: string,
  temporaryPassword: string
): Promise<{ error: string | null }> {
  const admin = await requireActiveAdmin();
  if ("error" in admin) {
    return { error: admin.error };
  }

  if (temporaryPassword.length < MIN_TEMP_PASSWORD_LENGTH) {
    return { error: `Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.` };
  }

  const service = createServiceClient();

  try {
    const { data: targetProfile } = await service
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const target = targetProfile as { full_name: string | null; email: string | null } | null;
    const targetLabel = target?.full_name?.trim() || target?.email || "User";

    const { error: authError } = await service.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
    });
    if (authError) {
      return { error: authError.message };
    }

    const { error: profileError } = await service
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", userId);
    if (profileError) {
      return { error: profileError.message };
    }

    await logUserActivity(admin, userId, "updated", targetLabel, { event: "password_reset" });

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Deactivate / reactivate
// ----------------------------------------------------------------------------

export async function setUserActive(userId: string, active: boolean): Promise<{ error: string | null }> {
  const admin = await requireActiveAdmin();
  if ("error" in admin) {
    return { error: admin.error };
  }

  if (userId === admin.id && !active) {
    return { error: "You can't deactivate your own account." };
  }

  const service = createServiceClient();

  try {
    const { data: targetProfile } = await service
      .from("profiles")
      .select("full_name, email, active")
      .eq("id", userId)
      .maybeSingle();
    const target = targetProfile as { full_name: string | null; email: string | null; active: boolean } | null;
    if (!target) {
      return { error: "User not found." };
    }
    const targetLabel = target.full_name?.trim() || target.email || "User";

    const { error: authError } = await service.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : BAN_DURATION,
    });
    if (authError) {
      return { error: authError.message };
    }

    // protect_last_active_admin() (supabase/migrations/012_user_
    // management.sql) can still refuse this update — e.g. deactivating
    // the only other active admin — and its exception message surfaces
    // through `error.message` exactly as written, no translation needed.
    const { error: profileError } = await service.from("profiles").update({ active }).eq("id", userId);
    if (profileError) {
      return { error: profileError.message };
    }

    await logUserActivity(admin, userId, "updated", targetLabel, { active: [target.active, active] });

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Change role
// ----------------------------------------------------------------------------

export async function setUserRole(userId: string, role: UserRole): Promise<{ error: string | null }> {
  const admin = await requireActiveAdmin();
  if ("error" in admin) {
    return { error: admin.error };
  }

  if (userId === admin.id) {
    return { error: "You can't change your own role." };
  }
  if (role !== "admin" && role !== "member") {
    return { error: "Invalid role." };
  }

  const service = createServiceClient();

  try {
    const { data: targetProfile } = await service
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", userId)
      .maybeSingle();
    const target = targetProfile as { full_name: string | null; email: string | null; role: string | null } | null;
    if (!target) {
      return { error: "User not found." };
    }
    const targetLabel = target.full_name?.trim() || target.email || "User";

    // protect_last_active_admin() can still refuse this (demoting the
    // last active admin); see the matching note in setUserActive above.
    const { error: profileError } = await service.from("profiles").update({ role }).eq("id", userId);
    if (profileError) {
      return { error: profileError.message };
    }

    await logUserActivity(admin, userId, "updated", targetLabel, { role: [target.role, role] });

    revalidatePath("/settings");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
