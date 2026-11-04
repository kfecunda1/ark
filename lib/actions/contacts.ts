"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ContactFormState {
  error: string | null;
}

// See the matching helper in lib/actions/projects.ts: converts a
// genuinely unexpected exception (network failure, …) into the same
// returned-error shape every normal Supabase-error path already uses,
// so callers never see a save silently fail.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

function buildContactPayload(formData: FormData) {
  const fullName = formData.get("full_name")?.toString().trim();
  if (!fullName) {
    throw new Error('"Full Name" is required.');
  }

  return {
    full_name: fullName,
    phone: formData.get("phone")?.toString().trim() || null,
    email: formData.get("email")?.toString().trim() || null,
    notes: formData.get("notes")?.toString().trim() || null,
  };
}

// Capability rows are submitted as parallel same-named field arrays:
// capability_id (empty string for new rows) and capability_tag, paired by
// index.
function parseSubmittedCapabilities(formData: FormData): { id: string | null; tag: string }[] {
  const ids = formData.getAll("capability_id").map((v) => v.toString());
  const tags = formData.getAll("capability_tag").map((v) => v.toString().trim());

  return tags
    .map((tag, i) => ({ id: ids[i]?.trim() || null, tag }))
    .filter((c) => c.tag);
}

async function syncContactCapabilities(
  supabase: SupabaseServerClient,
  contactId: string,
  submitted: { id: string | null; tag: string }[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("contact_capabilities")
    .select("id, tag")
    .eq("contact_id", contactId);

  const existingById = new Map(((existing as { id: string; tag: string }[] | null) ?? []).map((c) => [c.id, c.tag]));
  const submittedIds = new Set(submitted.filter((c) => c.id).map((c) => c.id));

  const idsToDelete = [...existingById.keys()].filter((id) => !submittedIds.has(id));
  const toInsert = submitted.filter((c) => !c.id).map((c) => ({ contact_id: contactId, tag: c.tag }));
  const toUpdate = submitted.filter((c) => c.id && existingById.get(c.id) !== c.tag);

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("contact_capabilities").delete().in("id", idsToDelete);
    if (error) console.error("[syncContactCapabilities] failed to delete capabilities:", error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("contact_capabilities").insert(toInsert);
    if (error) console.error("[syncContactCapabilities] failed to insert capabilities:", error.message);
  }

  for (const capability of toUpdate) {
    const { error } = await supabase
      .from("contact_capabilities")
      .update({ tag: capability.tag })
      .eq("id", capability.id!);
    if (error) console.error("[syncContactCapabilities] failed to update capability:", error.message);
  }
}

export async function createContact(
  _prevState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  let payload;
  try {
    payload = buildContactPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  let newId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("contacts").insert(payload).select("id").single();

    if (error || !data) {
      return { error: error?.message ?? "Failed to create contact." };
    }
    newId = data.id;

    const capabilities = parseSubmittedCapabilities(formData);
    if (capabilities.length > 0) {
      const { error: capabilityError } = await supabase
        .from("contact_capabilities")
        .insert(capabilities.map((c) => ({ contact_id: newId, tag: c.tag })));
      if (capabilityError) {
        console.error("[createContact] failed to insert capabilities:", capabilityError.message);
      }
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/contacts");
  redirect(`/contacts/${newId}`);
}

export async function updateContact(
  id: string,
  _prevState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  let payload;
  try {
    payload = buildContactPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contacts").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }

    await syncContactCapabilities(supabase, id, parseSubmittedCapabilities(formData));
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${id}`);
}

// Used by the Contact Picker's inline "+ New Contact" flow: creates a
// contact without redirecting so the caller can select it immediately.
export async function quickCreateContact(input: {
  full_name: string;
  phone: string | null;
  email: string | null;
}): Promise<{ contact: Contact | null; error: string | null }> {
  const fullName = input.full_name.trim();
  if (!fullName) {
    return { contact: null, error: "Name is required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({ full_name: fullName, phone: input.phone || null, email: input.email || null })
      .select("*")
      .single();

    if (error || !data) {
      return { contact: null, error: error?.message ?? "Failed to create contact." };
    }

    revalidatePath("/contacts");
    return { contact: data as Contact, error: null };
  } catch (err) {
    return { contact: null, error: unexpectedErrorMessage(err) };
  }
}
