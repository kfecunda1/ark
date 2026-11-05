"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface NoteFormState {
  error: string | null;
}

// See the matching helper in lib/actions/projects.ts: converts a
// genuinely unexpected exception (network failure, …) into the same
// returned-error shape every normal Supabase-error path already uses,
// so callers never see a save silently fail.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

interface NoteLinks {
  project_id: string | null;
  contact_id: string | null;
}

// supabase/migrations/014_notes_projects_reminders.sql re-added
// project_id — a note links to a project, a contact, or nothing, never
// more than one (notes_at_most_one_link). The form posts a single
// link_type + link_id pair (components/notes/note-link-picker.tsx)
// rather than two separate fields, so only one can ever be set here.
function parseLink(formData: FormData): NoteLinks {
  const linkType = formData.get("link_type")?.toString();
  const linkId = formData.get("link_id")?.toString().trim() || null;

  if (linkType === "project" && linkId) return { project_id: linkId, contact_id: null };
  if (linkType === "contact" && linkId) return { project_id: null, contact_id: linkId };
  return { project_id: null, contact_id: null };
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
  if (links.project_id) {
    revalidatePath(`/projects/${links.project_id}`);
    revalidatePath("/dashboard");
  }
  if (links.contact_id) revalidatePath(`/contacts/${links.contact_id}`);
}

export async function createNote(_prevState: NoteFormState, formData: FormData): Promise<NoteFormState> {
  let payload;
  try {
    payload = buildNotePayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("notes").insert({ ...payload, created_by: user?.id ?? null });

    if (error) {
      return { error: error.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
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

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("notes").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidateForLinks(payload);
  redirect("/notes");
}

export async function deleteNote(noteId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("notes")
      .select("project_id, contact_id")
      .eq("id", noteId)
      .maybeSingle();

    const { error } = await supabase.from("notes").delete().eq("id", noteId);

    if (error) {
      return { error: error.message };
    }

    revalidateForLinks(existing ?? { project_id: null, contact_id: null });
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Below: the project Timeline's "Note" composer and inline controls.
// These write the same `notes` table as the standalone Notes page
// above, just scoped to a single project and without a redirect — the
// Timeline stays on the project page after a save.

export async function addProjectNote(
  projectId: string,
  content: string,
  dueDate: string | null
): Promise<{ error: string | null }> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: '"Text" is required.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("notes").insert({
      project_id: projectId,
      content: trimmed,
      is_reminder: !!dueDate,
      due_date: dueDate,
      created_by: user?.id ?? null,
    });

    if (error) {
      return { error: error.message };
    }

    revalidateForLinks({ project_id: projectId, contact_id: null });
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function updateProjectNote(
  noteId: string,
  projectId: string,
  content: string,
  dueDate: string | null
): Promise<{ error: string | null }> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: '"Text" is required.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("notes")
      .update({ content: trimmed, is_reminder: !!dueDate, due_date: dueDate })
      .eq("id", noteId);

    if (error) {
      return { error: error.message };
    }

    revalidateForLinks({ project_id: projectId, contact_id: null });
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Shared by the project Timeline, the standalone Notes page, and the
// Dashboard's unified due-today-and-overdue list — any of them can
// flip a reminder's done flag, so this looks up the note's own links
// rather than taking them as a parameter.
export async function setNoteReminderDone(noteId: string, done: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("notes")
      .select("project_id, contact_id")
      .eq("id", noteId)
      .maybeSingle();

    const { error } = await supabase.from("notes").update({ reminder_done: done }).eq("id", noteId);

    if (error) {
      return { error: error.message };
    }

    revalidateForLinks(existing ?? { project_id: null, contact_id: null });
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteProjectNote(noteId: string, projectId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("notes").delete().eq("id", noteId);

    if (error) {
      return { error: error.message };
    }

    revalidateForLinks({ project_id: projectId, contact_id: null });
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
