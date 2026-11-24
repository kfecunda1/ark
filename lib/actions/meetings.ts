"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildDocumentPath, withPreservedExtension } from "@/lib/storage";
import type { NoteDocumentType } from "@/lib/types";

export interface MeetingFormState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

export interface ActionItemInput {
  text: string;
  dueDate: string | null;
}

interface MeetingLinks {
  project_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
}

// Same single link_type/link_id pair as lib/actions/notes.ts's own
// parseLink — components/notes/note-link-picker.tsx is shared by both
// forms.
function parseLink(formData: FormData): MeetingLinks {
  const linkType = formData.get("link_type")?.toString();
  const linkId = formData.get("link_id")?.toString().trim() || null;

  if (linkType === "project" && linkId) return { project_id: linkId, contact_id: null, opportunity_id: null };
  if (linkType === "contact" && linkId) return { project_id: null, contact_id: linkId, opportunity_id: null };
  if (linkType === "opportunity" && linkId) return { project_id: null, contact_id: null, opportunity_id: linkId };
  return { project_id: null, contact_id: null, opportunity_id: null };
}

function parseParticipantIds(formData: FormData): string[] {
  return [...new Set(formData.getAll("participant_person_ids").map((v) => v.toString().trim()).filter(Boolean))];
}

// Staged client-side as a JSON array (components/notes/action-items-
// editor.tsx) rather than indexed field pairs — simpler to parse and
// immune to index-matching bugs if a row is removed from the middle of
// the list before submit.
function parseActionItems(formData: FormData): ActionItemInput[] {
  const raw = formData.get("action_items_json")?.toString();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        text: typeof item?.text === "string" ? item.text.trim() : "",
        dueDate: typeof item?.dueDate === "string" && item.dueDate.trim() ? item.dueDate.trim() : null,
      }))
      .filter((item) => item.text.length > 0);
  } catch {
    return [];
  }
}

function buildMeetingPayload(formData: FormData) {
  const title = formData.get("title")?.toString().trim();
  if (!title) {
    throw new Error("titleRequired");
  }

  const meetingDate = formData.get("meeting_date")?.toString().trim();
  if (!meetingDate) {
    throw new Error("meetingDateRequired");
  }

  const summary = formData.get("content")?.toString().trim();

  return {
    title,
    // notes.content is NOT NULL — an empty summary falls back to the
    // title rather than forcing the user to type something redundant
    // just to satisfy that.
    content: summary || title,
    kind: "meeting" as const,
    meeting_date: meetingDate,
    is_reminder: false,
    due_date: null,
    ...parseLink(formData),
  };
}

async function insertActionItems(
  supabase: SupabaseServerClient,
  meetingId: string,
  projectId: string | null,
  items: ActionItemInput[],
  userId: string | null
): Promise<{ error: string | null }> {
  if (items.length === 0) return { error: null };

  if (projectId) {
    const { error } = await supabase.from("project_steps").insert(
      items.map((item) => ({
        project_id: projectId,
        kind: "next_step" as const,
        body: item.text,
        due_date: item.dueDate,
        author_id: userId,
        source_note_id: meetingId,
      }))
    );
    if (error) return { error: error.message };
    return { error: null };
  }

  const { error } = await supabase.from("notes").insert(
    items.map((item) => ({
      content: item.text,
      is_reminder: Boolean(item.dueDate),
      due_date: item.dueDate,
      created_by: userId,
      source_note_id: meetingId,
    }))
  );
  if (error) return { error: error.message };
  return { error: null };
}

function revalidateForMeeting(links: MeetingLinks) {
  revalidatePath("/notes");
  if (links.project_id) {
    revalidatePath(`/projects/${links.project_id}`);
    revalidatePath("/dashboard");
  }
  if (links.contact_id) revalidatePath(`/receivers/${links.contact_id}`);
  if (links.opportunity_id) {
    revalidatePath(`/opportunities/${links.opportunity_id}`);
    revalidatePath("/dashboard");
  }
}

// Returns the new meeting's id instead of redirecting, same reason as
// lib/actions/opportunities.ts's createOpportunityWithId: the caller
// (components/notes/meeting-form.tsx) still needs to upload staged
// attachments, which needs the meeting's own id first.
export async function createMeetingWithId(formData: FormData): Promise<{ id: string | null; error: string | null }> {
  let payload: ReturnType<typeof buildMeetingPayload>;
  let participantIds: string[];
  let actionItems: ActionItemInput[];
  try {
    payload = buildMeetingPayload(formData);
    participantIds = parseParticipantIds(formData);
    actionItems = parseActionItems(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("notes")
      .insert({ ...payload, created_by: user?.id ?? null })
      .select("id")
      .single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "failedToCreateMeeting" };
    }

    const meetingId = data.id;

    if (participantIds.length > 0) {
      const { error: participantsError } = await supabase
        .from("note_participants")
        .insert(participantIds.map((personId) => ({ note_id: meetingId, person_id: personId })));
      if (participantsError) {
        await supabase.from("notes").delete().eq("id", meetingId);
        return { id: null, error: participantsError.message };
      }
    }

    const actionItemsResult = await insertActionItems(supabase, meetingId, payload.project_id, actionItems, user?.id ?? null);
    if (actionItemsResult.error) {
      await supabase.from("notes").delete().eq("id", meetingId);
      return { id: null, error: actionItemsResult.error };
    }

    revalidateForMeeting(payload);
    return { id: meetingId, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

// Edit mode only touches the meeting's own fields and its participant
// list — action items and attachments are managed from the meeting's
// own detail page afterward, not re-generated here (same "create-time
// staging only" shape as lib/actions/opportunities.ts's updateOpportunity,
// which likewise never re-touches its Documents section).
export async function updateMeeting(
  id: string,
  _prevState: MeetingFormState,
  formData: FormData
): Promise<MeetingFormState> {
  let payload: ReturnType<typeof buildMeetingPayload>;
  let participantIds: string[];
  try {
    payload = buildMeetingPayload(formData);
    participantIds = parseParticipantIds(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("notes").update(payload).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    const { data: existingParticipants, error: existingError } = await supabase
      .from("note_participants")
      .select("id, person_id")
      .eq("note_id", id);
    if (existingError) {
      return { error: existingError.message };
    }

    const existingRows = (existingParticipants as { id: string; person_id: string }[] | null) ?? [];
    const existingByPerson = new Map(existingRows.map((r) => [r.person_id, r.id]));
    const submittedSet = new Set(participantIds);

    const toInsert = participantIds.filter((personId) => !existingByPerson.has(personId));
    const toDelete = existingRows.filter((r) => !submittedSet.has(r.person_id));

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("note_participants")
        .insert(toInsert.map((personId) => ({ note_id: id, person_id: personId })));
      if (insertError) return { error: insertError.message };
    }
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("note_participants")
        .delete()
        .in(
          "id",
          toDelete.map((r) => r.id)
        );
      if (deleteError) return { error: deleteError.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidateForMeeting(payload);
  revalidatePath(`/notes/${id}`);
  return { error: null };
}

// ----------------------------------------------------------------------------
// Attachments — same shape as lib/actions/opportunities.ts's
// addOpportunityDocument/addOpportunityDocumentLink/findOpportunityDocumentsByHash.
// ----------------------------------------------------------------------------

export async function addNoteDocument(
  noteId: string,
  documentType: NoteDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null; id?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("note_documents")
      .insert({
        note_id: noteId,
        document_type: documentType,
        file_path: filePath,
        file_name: fileName,
        file_hash: fileHash,
      })
      .select("id")
      .single();

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/notes/${noteId}`);
    return { error: null, id: (data as { id: string }).id };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function addNoteDocumentLink(
  noteId: string,
  documentType: NoteDocumentType,
  name: string,
  url: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("note_documents").insert({
      note_id: noteId,
      document_type: documentType,
      file_name: name,
      url,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/notes/${noteId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteNoteDocument(documentId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("note_documents")
      .select("note_id, file_path")
      .eq("id", documentId)
      .maybeSingle();

    const { error } = await supabase.from("note_documents").delete().eq("id", documentId);
    if (error) {
      return { error: error.message };
    }

    if (existing?.file_path) {
      const { error: storageError } = await supabase.storage.from("note-documents").remove([existing.file_path]);
      if (storageError) {
        console.error("[deleteNoteDocument] failed to remove storage file:", storageError.message);
      }
    }

    if (existing?.note_id) {
      revalidatePath(`/notes/${existing.note_id}`);
    }
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function renameNoteDocument(documentId: string, newName: string): Promise<{ error: string | null }> {
  if (!newName.trim()) {
    return { error: "nameCannotBeEmpty" };
  }

  try {
    const supabase = await createClient();

    const { data: existing, error: readError } = await supabase
      .from("note_documents")
      .select("note_id, file_name")
      .eq("id", documentId)
      .maybeSingle();
    if (readError || !existing) {
      return { error: readError?.message ?? "documentNotFound" };
    }

    const finalName = withPreservedExtension(existing.file_name, newName);
    const { error } = await supabase.from("note_documents").update({ file_name: finalName }).eq("id", documentId);
    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/notes/${existing.note_id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface NoteDocumentHashMatch {
  documentId: string;
  noteId: string;
  noteLabel: string;
  fileName: string;
}

export async function findNoteDocumentsByHash(hash: string): Promise<NoteDocumentHashMatch[]> {
  if (!hash) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("note_documents").select("id, note_id, file_name").eq("file_hash", hash);

    if (error) {
      console.error("[findNoteDocumentsByHash] query failed:", error.message);
      return [];
    }

    const rows = (data as { id: string; note_id: string; file_name: string }[] | null) ?? [];
    if (rows.length === 0) return [];

    const noteIds = [...new Set(rows.map((r) => r.note_id))];
    const { data: notesData } = await supabase.from("notes").select("id, title, content").in("id", noteIds);
    const labelById = new Map(
      ((notesData as { id: string; title: string | null; content: string }[] | null) ?? []).map((n) => [
        n.id,
        n.title?.trim() || n.content.slice(0, 60),
      ])
    );

    return rows.map((row) => ({
      documentId: row.id,
      noteId: row.note_id,
      noteLabel: labelById.get(row.note_id) ?? "Meeting",
      fileName: row.file_name,
    }));
  } catch (err) {
    console.error("[findNoteDocumentsByHash] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// ----------------------------------------------------------------------------
// Action items — "the meeting shows its action items" (project_steps
// when the meeting is project-linked, otherwise plain reminder notes —
// see insertActionItems above). Ticking one done reuses setProjectStepDone/
// setNoteReminderDone directly (lib/actions/project-steps.ts, lib/
// actions/notes.ts) — nothing new needed for that.
// ----------------------------------------------------------------------------

export interface MeetingActionItem {
  id: string;
  kind: "project_step" | "note";
  text: string;
  dueDate: string | null;
  done: boolean;
}

export async function getMeetingActionItems(meetingId: string, projectId: string | null): Promise<MeetingActionItem[]> {
  const supabase = await createClient();

  if (projectId) {
    const { data } = await supabase
      .from("project_steps")
      .select("id, body, due_date, done")
      .eq("source_note_id", meetingId)
      .order("created_at");
    return ((data as { id: string; body: string; due_date: string | null; done: boolean }[] | null) ?? []).map((row) => ({
      id: row.id,
      kind: "project_step" as const,
      text: row.body,
      dueDate: row.due_date,
      done: row.done,
    }));
  }

  const { data } = await supabase
    .from("notes")
    .select("id, content, due_date, reminder_done")
    .eq("source_note_id", meetingId)
    .order("created_at");
  return ((data as { id: string; content: string; due_date: string | null; reminder_done: boolean }[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      kind: "note" as const,
      text: row.content,
      dueDate: row.due_date,
      done: row.reminder_done,
    })
  );
}

// ----------------------------------------------------------------------------
// Inbox → "File as meeting summary" (components/inbox/inbox-tabs.tsx).
// Moves the inbox item's own file (if any) into note-documents as the
// new meeting's first attachment, and marks the item filed — same
// storage-move shape as lib/actions/opportunities.ts's
// moveOpportunityAssets, just for a single file instead of a whole
// batch.
// ----------------------------------------------------------------------------

export async function attachInboxItemToMeeting(
  inboxItemId: string,
  meetingId: string,
  documentType: NoteDocumentType
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: item, error: itemError } = await supabase
      .from("inbox_items")
      .select("storage_path, file_name, mime_type")
      .eq("id", inboxItemId)
      .maybeSingle();
    if (itemError) return { error: itemError.message };

    let documentId: string | null = null;

    if (item?.storage_path) {
      const { data: blob, error: downloadError } = await supabase.storage.from("inbox").download(item.storage_path);
      if (downloadError || !blob) {
        return { error: downloadError?.message ?? "couldNotReadFile" };
      }

      const newPath = buildDocumentPath(item.file_name ?? "file");
      const { error: uploadError } = await supabase.storage.from("note-documents").upload(newPath, blob, {
        contentType: item.mime_type ?? "application/octet-stream",
      });
      if (uploadError) return { error: uploadError.message };

      const { data: docRow, error: insertError } = await supabase
        .from("note_documents")
        .insert({
          note_id: meetingId,
          document_type: documentType,
          file_path: newPath,
          file_name: item.file_name ?? "file",
        })
        .select("id")
        .single();
      if (insertError) {
        await supabase.storage.from("note-documents").remove([newPath]);
        return { error: insertError.message };
      }
      documentId = (docRow as { id: string }).id;

      const { error: removeError } = await supabase.storage.from("inbox").remove([item.storage_path]);
      if (removeError) {
        console.error("[attachInboxItemToMeeting] failed to remove source storage file:", removeError.message);
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase
      .from("inbox_items")
      .update({
        status: "filed",
        filed_to_type: "note",
        filed_to_id: meetingId,
        storage_path: null,
        filed_by: user?.id ?? null,
        filed_at: new Date().toISOString(),
        filed_document_id: documentId,
      })
      .eq("id", inboxItemId);

    revalidatePath("/inbox");
    revalidatePath(`/notes/${meetingId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
