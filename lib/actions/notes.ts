"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface NoteFormState {
  error: string | null;
}

interface NoteLinks {
  lead_id: string | null;
  contact_id: string | null;
}

// The link picker submits a single "link_type" + "link_id" pair (or
// link_type="" for no link) rather than two separate fields, since a
// note can point at most one of lead/contact.
function parseLink(formData: FormData): NoteLinks {
  const linkType = formData.get("link_type")?.toString().trim();
  const linkId = formData.get("link_id")?.toString().trim() || null;

  return {
    lead_id: linkType === "lead" ? linkId : null,
    contact_id: linkType === "contact" ? linkId : null,
  };
}

function buildNotePayload(formData: FormData) {
  const title = formData.get("title")?.toString().trim() || null;
  const content = formData.get("content")?.toString().trim();
  if (!content) {
    throw new Error('"Content" is required.');
  }

  const isReminder = formData.get("is_reminder") === "on";
  const dueDate = formData.get("due_date")?.toString().trim() || null;
  if (isReminder && !dueDate) {
    throw new Error('"Due date" is required for a reminder.');
  }

  return {
    title,
    content,
    is_reminder: isReminder,
    due_date: isReminder ? dueDate : null,
    ...parseLink(formData),
  };
}

function revalidateForLinks(links: NoteLinks) {
  revalidatePath("/notes");
  if (links.lead_id) revalidatePath(`/projects/${links.lead_id}`);
  if (links.contact_id) revalidatePath(`/contacts/${links.contact_id}`);
}

export async function createNote(_prevState: NoteFormState, formData: FormData): Promise<NoteFormState> {
  let payload;
  try {
    payload = buildNotePayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("notes").insert({ ...payload, created_by: user?.id ?? null });

  if (error) {
    return { error: error.message };
  }

  revalidateForLinks(payload);
  redirect("/notes");
}

export async function updateNote(
  id: string,
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  let payload;
  try {
    payload = buildNotePayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("notes").update(payload).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateForLinks(payload);
  redirect("/notes");
}

export async function deleteNote(noteId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("notes")
    .select("lead_id, contact_id")
    .eq("id", noteId)
    .maybeSingle();

  const { error } = await supabase.from("notes").delete().eq("id", noteId);

  if (error) {
    return { error: error.message };
  }

  revalidateForLinks(existing ?? { lead_id: null, contact_id: null });
  return { error: null };
}
