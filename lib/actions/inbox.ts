"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { addProjectDocument, findProjectDocumentsByHash } from "@/lib/actions/projects";
import { addContactDocument, findContactDocumentsByHash } from "@/lib/actions/contacts";
import { buildDocumentPath, computeFileHash, withPreservedExtension } from "@/lib/storage";
import type { InboxItem } from "@/lib/types";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

export type InboxFileTarget =
  | { type: "project"; id: string; trancheId: string | null }
  | { type: "contact"; id: string };

export interface InboxDuplicateMatch {
  label: string;
  fileName: string;
  href: string;
}

export interface FileInboxItemResult {
  error: string | null;
  // Present only alongside the "errors.duplicateSameTarget" key — the
  // file name that's already attached, since the error key alone can't
  // carry it (see lib/i18n/index.ts's resolveError: a key is a stable
  // string with no interpolation slot of its own).
  duplicateFileName?: string;
  // Present (and error null) when a cross-record hash match was found
  // and this call hasn't been told to go ahead anyway — same "warning,
  // never blocking" shape as the main Documents section's own
  // duplicate check (components/projects/project-documents.tsx).
  needsConfirm?: boolean;
  matches?: InboxDuplicateMatch[];
}

async function loadInboxItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string
): Promise<{ item: InboxItem | null; error: string | null }> {
  const { data, error } = await supabase.from("inbox_items").select("*").eq("id", itemId).maybeSingle();
  if (error) return { item: null, error: error.message };
  if (!data) return { item: null, error: "notFound" };
  return { item: data as InboxItem, error: null };
}

// Deletes the underlying storage object (if any) and marks the row
// filed — the row itself is kept, as history, with filed_to_type/
// filed_to_id recording where it went (supabase/migrations/022_
// telegram_inbox.sql) and filed_by/filed_at/filed_document_id
// (027_inbox_view.sql) recording who, when, and — for a Document,
// never a Note — which new row it became, for the Filed tab's own
// display.
async function markFiled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: InboxItem,
  target: { type: "project" | "contact"; id: string },
  documentId: string | null
): Promise<void> {
  if (item.storage_path) {
    const { error } = await supabase.storage.from("inbox").remove([item.storage_path]);
    if (error) {
      console.error("[markFiled] failed to remove inbox storage file:", error.message);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase
    .from("inbox_items")
    .update({
      status: "filed",
      filed_to_type: target.type,
      filed_to_id: target.id,
      storage_path: null,
      filed_by: user?.id ?? null,
      filed_at: new Date().toISOString(),
      filed_document_id: documentId,
    })
    .eq("id", item.id);
}

// A "To file" item's inline "Rename" action, before it's filed —
// updates only file_name, same "display name only" rule as
// renameProjectDocument/renameContactDocument (lib/actions/projects.ts
// / contacts.ts). Deliberately never activity-logged: inbox_items has
// no activity-log trigger at all, by design (022_telegram_inbox.sql).
export async function renameInboxItem(itemId: string, newName: string): Promise<{ error: string | null }> {
  if (!newName.trim()) {
    return { error: "nameRequired" };
  }

  try {
    const supabase = await createClient();
    const { item, error: loadError } = await loadInboxItem(supabase, itemId);
    if (loadError) return { error: loadError };
    if (!item) return { error: "notFound" };
    if (!item.file_name) return { error: "noFileToRename" };

    const finalName = withPreservedExtension(item.file_name, newName);
    const { error } = await supabase.from("inbox_items").update({ file_name: finalName }).eq("id", itemId);
    if (error) return { error: error.message };

    revalidatePath("/inbox");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function dismissInboxItem(itemId: string, dismissed: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("inbox_items")
      .update({ status: dismissed ? "dismissed" : "new" })
      .eq("id", itemId);
    if (error) return { error: error.message };
    revalidatePath("/inbox");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteInboxItem(itemId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { item, error: loadError } = await loadInboxItem(supabase, itemId);
    if (loadError) return { error: loadError };

    // Deleting a *filed* item throws away part of the paper trail for
    // something that became a real document/note elsewhere — admin
    // only, same as the Filed tab's own Delete button being hidden for
    // everyone else (components/inbox/inbox-tabs.tsx). A new or
    // dismissed item carries no such history, so anyone registered can
    // clean those up, matching inbox_items' own DELETE RLS policy.
    if (item?.status === "filed" && !(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanDeleteFiled" };
    }

    const { error } = await supabase.from("inbox_items").delete().eq("id", itemId);
    if (error) return { error: error.message };

    if (item?.storage_path) {
      const { error: storageError } = await supabase.storage.from("inbox").remove([item.storage_path]);
      if (storageError) {
        console.error("[deleteInboxItem] failed to remove storage file:", storageError.message);
      }
    }

    revalidatePath("/inbox");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// text_or_caption, if present, becomes the note's content; otherwise
// (a too-large file with no caption) a placeholder names the original
// file so the note isn't just blank.
function noteContent(item: InboxItem): string {
  const caption = item.text_or_caption?.trim();
  if (caption) return caption;
  if (item.file_name) return `(Forwarded from Telegram: ${item.file_name} — too large to save here.)`;
  return "(Forwarded from Telegram.)";
}

export async function fileInboxItemAsNote(
  itemId: string,
  target: { type: "project" | "contact"; id: string }
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { item, error: loadError } = await loadInboxItem(supabase, itemId);
    if (loadError) return { error: loadError };
    if (!item) return { error: "notFound" };

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from("notes").insert({
      content: noteContent(item),
      project_id: target.type === "project" ? target.id : null,
      contact_id: target.type === "contact" ? target.id : null,
      created_by: user?.id ?? null,
    });
    if (insertError) return { error: insertError.message };

    await markFiled(supabase, item, target, null);

    revalidatePath("/inbox");
    revalidatePath(target.type === "project" ? `/projects/${target.id}` : `/receivers/${target.id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function fileInboxItemAsDocument(
  itemId: string,
  target: InboxFileTarget,
  documentType: string,
  confirmDuplicate = false
): Promise<FileInboxItemResult> {
  try {
    const supabase = await createClient();
    const { item, error: loadError } = await loadInboxItem(supabase, itemId);
    if (loadError) return { error: loadError };
    if (!item) return { error: "notFound" };
    if (!item.storage_path) return { error: "noFileToFileAsDocument" };

    const { data: blob, error: downloadError } = await supabase.storage.from("inbox").download(item.storage_path);
    if (downloadError || !blob) {
      return { error: downloadError?.message ?? "couldNotReadFile" };
    }

    const hash = await computeFileHash(blob);

    const matches =
      target.type === "project" ? await findProjectDocumentsByHash(hash) : await findContactDocumentsByHash(hash);

    const sameTarget =
      target.type === "project"
        ? matches.find((m) => "projectId" in m && m.projectId === target.id)
        : matches.find((m) => "contactId" in m && m.contactId === target.id);
    if (sameTarget) {
      return { error: "duplicateSameTarget", duplicateFileName: sameTarget.fileName };
    }

    if (matches.length > 0 && !confirmDuplicate) {
      return {
        error: null,
        needsConfirm: true,
        matches: matches.map((m) =>
          target.type === "project" && "projectId" in m
            ? { label: m.projectLabel, fileName: m.fileName, href: `/projects/${m.projectId}` }
            : "contactId" in m
              ? { label: m.contactLabel, fileName: m.fileName, href: `/receivers/${m.contactId}` }
              : { label: "Unknown", fileName: m.fileName, href: "#" }
        ),
      };
    }

    const path = buildDocumentPath(item.file_name ?? "file");
    const bucket = target.type === "project" ? "project-documents" : "contact-documents";
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: item.mime_type ?? "application/octet-stream" });
    if (uploadError) return { error: uploadError.message };

    const addResult =
      target.type === "project"
        ? await addProjectDocument(target.id, documentType, path, item.file_name ?? "file", hash, target.trancheId)
        : await addContactDocument(target.id, documentType, path, item.file_name ?? "file", hash);

    if (addResult.error) {
      await supabase.storage.from(bucket).remove([path]);
      return { error: addResult.error };
    }

    await markFiled(supabase, item, target, addResult.id ?? null);

    revalidatePath("/inbox");
    revalidatePath(target.type === "project" ? `/projects/${target.id}` : `/receivers/${target.id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
