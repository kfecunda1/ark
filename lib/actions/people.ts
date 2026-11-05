"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

export interface PersonFormState {
  error: string | null;
}

// See the matching helper in lib/actions/projects.ts: converts a
// genuinely unexpected exception (network failure, …) into the same
// returned-error shape every normal Supabase-error path already uses,
// so callers never see a save silently fail.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

function buildPersonPayload(formData: FormData) {
  const firstName = formData.get("first_name")?.toString().trim();
  if (!firstName) {
    throw new Error('"First name" is required.');
  }

  return {
    first_name: firstName,
    last_name: formData.get("last_name")?.toString().trim() || null,
    phone: formData.get("phone")?.toString().trim() || null,
    email: formData.get("email")?.toString().trim() || null,
  };
}

// ----------------------------------------------------------------------------
// Duplicate detection — a warning only, same "Add anyway" pattern as
// lib/actions/projects.ts's findDuplicateProjects. A small, private
// two-user table, so this reads every row and compares in JS rather
// than building an escaped .or() filter string.
// ----------------------------------------------------------------------------

export interface DuplicatePersonMatch {
  id: string;
  label: string;
  meta: string;
}

export async function findDuplicatePeople(input: {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  excludePersonId?: string;
}): Promise<DuplicatePersonMatch[]> {
  const firstName = input.firstName.trim().toLowerCase();
  const lastName = (input.lastName ?? "").trim().toLowerCase();
  const email = (input.email ?? "").trim().toLowerCase();
  if (!firstName && !email) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("people").select("*");
    if (error) {
      console.error("[findDuplicatePeople] query failed:", error.message);
      return [];
    }

    const rows = (data as Person[] | null) ?? [];
    const matches = rows.filter((row) => {
      if (input.excludePersonId && row.id === input.excludePersonId) return false;
      const sameEmail = Boolean(email) && (row.email ?? "").trim().toLowerCase() === email;
      const sameName =
        Boolean(firstName) &&
        row.first_name.trim().toLowerCase() === firstName &&
        (row.last_name ?? "").trim().toLowerCase() === lastName;
      return sameEmail || sameName;
    });

    return matches.map((row) => ({
      id: row.id,
      label: personLabel(row),
      meta: row.email ?? row.phone ?? "",
    }));
  } catch (err) {
    console.error("[findDuplicatePeople] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// Returns the new person's id instead of redirecting, so the caller
// (components/people/person-form.tsx) can run the duplicate check and
// show "Add anyway" before committing — same pattern as
// createProjectWithId in lib/actions/projects.ts.
export async function createPersonWithId(formData: FormData): Promise<{ id: string | null; error: string | null }> {
  let payload: ReturnType<typeof buildPersonPayload>;
  try {
    payload = buildPersonPayload(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("people").insert(payload).select("id").single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "Failed to create contact." };
    }

    revalidatePath("/people");
    return { id: data.id, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

export async function updatePerson(
  id: string,
  _prevState: PersonFormState,
  formData: FormData
): Promise<PersonFormState> {
  let payload: ReturnType<typeof buildPersonPayload>;
  try {
    payload = buildPersonPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("people").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  redirect(`/people/${id}`);
}

// The detail page's Archive toggle (components/archive-toggle-
// button.tsx, via lib/actions/archive.ts's setArchived dispatcher) —
// everyone can archive/unarchive, unlike delete below.
export async function togglePersonArchived(id: string, archived: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("people")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/people");
    revalidatePath(`/people/${id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Admin-only (also enforced by the people_delete_admin RLS policy,
// supabase/migrations/017_archive_receivers_people.sql). Blocked
// outright while any project or receiver still links to this person as
// its Contact Person — same "archive or unlink first" rule as
// deleteContact in lib/actions/contacts.ts. A person has no products,
// documents, or notes of its own to cascade-clean (both FKs into
// `people` are ON DELETE SET NULL, never CASCADE), so this is a plain
// delete once the link check clears.
export async function deletePerson(id: string): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "Only admins can delete contacts." };
    }

    const supabase = await createClient();

    const [{ count: projectCount }, { count: receiverCount }] = await Promise.all([
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("contact_person_id", id),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("contact_person_id", id),
    ]);

    if ((projectCount ?? 0) > 0 || (receiverCount ?? 0) > 0) {
      const parts: string[] = [];
      if (projectCount) parts.push(`${projectCount} project${projectCount === 1 ? "" : "s"}`);
      if (receiverCount) parts.push(`${receiverCount} receiver${receiverCount === 1 ? "" : "s"}`);
      return { error: `Linked to ${parts.join(" and ")}. Archive instead, or unlink first.` };
    }

    const { error } = await supabase.from("people").delete().eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/people");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Used by components/entity-picker.tsx's inline "+ New contact" row
// wherever a Receiver or a Project links an optional "Contact person"
// — the single typed name is split on the first space into
// first_name/last_name, since `people` keeps them as separate columns
// but the picker only collects one text field. Same shape as
// quickCreateContact in lib/actions/contacts.ts.
export async function quickCreatePerson(input: { name: string }): Promise<{
  person: Person | null;
  error: string | null;
}> {
  const trimmed = input.name.trim();
  if (!trimmed) {
    return { person: null, error: "Name is required." };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);
  const lastName = rest.join(" ") || null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("people")
      .insert({ first_name: firstName, last_name: lastName })
      .select("*")
      .single();

    if (error || !data) {
      return { person: null, error: error?.message ?? "Failed to create contact." };
    }

    return { person: data as Person, error: null };
  } catch (err) {
    return { person: null, error: unexpectedErrorMessage(err) };
  }
}
