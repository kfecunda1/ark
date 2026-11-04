"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildDocumentPath } from "@/lib/storage";
import { STATUS_LABELS, truncate } from "@/lib/procedures";
import type { BusinessLine, ProcedureSource, ProcedureStatus } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ProcedureFormState {
  error: string | null;
}

// Wallet rows are submitted as parallel same-named field arrays: wallet_id
// (empty string for new rows), wallet_address, and wallet_label, paired by
// index.
function parseSubmittedWallets(
  formData: FormData
): { id: string | null; address: string; label: string | null }[] {
  const ids = formData.getAll("wallet_id").map((v) => v.toString());
  const addresses = formData.getAll("wallet_address").map((v) => v.toString().trim());
  const labels = formData.getAll("wallet_label").map((v) => v.toString().trim());

  return addresses
    .map((address, i) => ({ id: ids[i]?.trim() || null, address, label: labels[i] || null }))
    .filter((w) => w.address);
}

async function syncProcedureWallets(
  supabase: SupabaseServerClient,
  procedureId: string,
  submitted: { id: string | null; address: string; label: string | null }[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("procedure_wallets")
    .select("id, wallet_address, label")
    .eq("procedure_id", procedureId);

  const existingById = new Map(
    ((existing as { id: string; wallet_address: string; label: string | null }[] | null) ?? []).map((w) => [
      w.id,
      w,
    ])
  );
  const submittedIds = new Set(submitted.filter((w) => w.id).map((w) => w.id));

  const idsToDelete = [...existingById.keys()].filter((id) => !submittedIds.has(id));
  const toInsert = submitted
    .filter((w) => !w.id)
    .map((w) => ({ procedure_id: procedureId, wallet_address: w.address, label: w.label }));
  const toUpdate = submitted.filter((w) => {
    if (!w.id) return false;
    const existingWallet = existingById.get(w.id);
    return existingWallet && (existingWallet.wallet_address !== w.address || existingWallet.label !== w.label);
  });

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("procedure_wallets").delete().in("id", idsToDelete);
    if (error) console.error("[syncProcedureWallets] failed to delete wallets:", error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("procedure_wallets").insert(toInsert);
    if (error) console.error("[syncProcedureWallets] failed to insert wallets:", error.message);
  }

  for (const wallet of toUpdate) {
    const { error } = await supabase
      .from("procedure_wallets")
      .update({ wallet_address: wallet.address, label: wallet.label })
      .eq("id", wallet.id!);
    if (error) console.error("[syncProcedureWallets] failed to update wallet:", error.message);
  }
}

// Document rows are submitted the same way: parallel document_id (empty
// for newly uploaded rows), document_path, and document_name arrays,
// paired by index, plus document_hash (empty string for a pre-migration-
// 020 row with no hash yet). Only fully-uploaded rows (non-empty path)
// count.
function parseSubmittedDocuments(
  formData: FormData
): { id: string | null; path: string; fileName: string; fileHash: string | null }[] {
  const ids = formData.getAll("document_id").map((v) => v.toString());
  const paths = formData.getAll("document_path").map((v) => v.toString().trim());
  const names = formData.getAll("document_name").map((v) => v.toString().trim());
  const hashes = formData.getAll("document_hash").map((v) => v.toString().trim());

  return paths
    .map((path, i) => ({
      id: ids[i]?.trim() || null,
      path,
      fileName: names[i] ?? "",
      fileHash: hashes[i] || null,
    }))
    .filter((d) => d.path);
}

async function syncProcedureDocuments(
  supabase: SupabaseServerClient,
  procedureId: string,
  submitted: { id: string | null; path: string; fileName: string; fileHash: string | null }[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("procedure_documents")
    .select("id, file_path")
    .eq("procedure_id", procedureId);

  const existingRows = (existing as { id: string; file_path: string }[] | null) ?? [];
  const existingById = new Map(existingRows.map((d) => [d.id, d.file_path]));
  const submittedIds = new Set(submitted.filter((d) => d.id).map((d) => d.id));

  const idsToDelete = [...existingById.keys()].filter((id) => !submittedIds.has(id));
  const toInsert = submitted
    .filter((d) => !d.id)
    .map((d) => ({ procedure_id: procedureId, file_path: d.path, file_name: d.fileName, file_hash: d.fileHash }));

  if (idsToDelete.length > 0) {
    const pathsToDelete = idsToDelete.map((id) => existingById.get(id)!);
    const { error } = await supabase.from("procedure_documents").delete().in("id", idsToDelete);
    if (error) {
      console.error("[syncProcedureDocuments] failed to delete documents:", error.message);
    } else {
      const { error: storageError } = await supabase.storage.from("procedure-documents").remove(pathsToDelete);
      if (storageError) {
        console.error("[syncProcedureDocuments] failed to remove storage files:", storageError.message);
      }
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("procedure_documents").insert(toInsert);
    if (error) console.error("[syncProcedureDocuments] failed to insert documents:", error.message);
  }
}

export interface CreateProcedureResult {
  id: string | null;
  error: string | null;
}

// Returns the new procedure's id instead of redirecting — the create
// form runs a duplicate check (findDuplicateProcedures) before calling
// this, and needs the chance to show a warning banner instead of
// navigating away, the same reason createLeadWithId doesn't redirect
// either. The caller navigates to /procedures itself on success.
export async function createProcedure(formData: FormData): Promise<CreateProcedureResult> {
  const source = formData.get("source")?.toString().trim() || null;
  const area = formData.get("area")?.toString().trim() || null;
  const title = formData.get("title")?.toString().trim();
  const rawContent = formData.get("raw_content")?.toString().trim();
  const contactId = formData.get("contact_id")?.toString().trim() || null;

  if (!title) return { id: null, error: '"title" is required.' };
  if (!rawContent) return { id: null, error: '"raw_content" is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedures")
    .insert({
      source: source as ProcedureSource | null,
      area: area as BusinessLine | null,
      title,
      raw_content: rawContent,
      contact_id: contactId,
      status: "unmatched",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Failed to create procedure." };
  }

  const wallets = parseSubmittedWallets(formData);
  if (wallets.length > 0) {
    const { error: walletError } = await supabase
      .from("procedure_wallets")
      .insert(wallets.map((w) => ({ procedure_id: data.id, wallet_address: w.address, label: w.label })));
    if (walletError) {
      console.error("[createProcedure] failed to insert wallets:", walletError.message);
    }
  }

  const documents = parseSubmittedDocuments(formData);
  if (documents.length > 0) {
    const { error: docError } = await supabase.from("procedure_documents").insert(
      documents.map((d) => ({
        procedure_id: data.id,
        file_path: d.path,
        file_name: d.fileName,
        file_hash: d.fileHash,
      }))
    );
    if (docError) {
      console.error("[createProcedure] failed to insert documents:", docError.message);
    }
  }

  revalidatePath("/procedures");
  return { id: data.id, error: null };
}

export async function updateProcedure(
  id: string,
  _prevState: ProcedureFormState,
  formData: FormData
): Promise<ProcedureFormState> {
  const source = formData.get("source")?.toString().trim() || null;
  const area = formData.get("area")?.toString().trim() || null;
  const title = formData.get("title")?.toString().trim();
  const rawContent = formData.get("raw_content")?.toString().trim();
  const contactId = formData.get("contact_id")?.toString().trim() || null;
  const status = formData.get("status")?.toString().trim();

  if (!title) return { error: '"title" is required.' };
  if (!rawContent) return { error: '"raw_content" is required.' };
  if (!status) return { error: '"status" is required.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({
      source: source as ProcedureSource | null,
      area: area as BusinessLine | null,
      title,
      raw_content: rawContent,
      contact_id: contactId,
      status: status as ProcedureStatus,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  await syncProcedureWallets(supabase, id, parseSubmittedWallets(formData));
  await syncProcedureDocuments(supabase, id, parseSubmittedDocuments(formData));

  revalidatePath("/procedures");
  revalidatePath(`/procedures/${id}`);
  redirect(`/procedures/${id}`);
}

// Matched-lead ids for a procedure, used to revalidate each affected
// lead's detail page after an action that changes the procedure (delete,
// archive) or its match set.
async function getMatchedLeadIds(supabase: SupabaseServerClient, procedureId: string): Promise<string[]> {
  const { data } = await supabase.from("procedure_lead_matches").select("lead_id").eq("procedure_id", procedureId);
  return ((data as { lead_id: string }[] | null) ?? []).map((m) => m.lead_id);
}

export async function deleteProcedure(procedureId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const matchedLeadIds = await getMatchedLeadIds(supabase, procedureId);

  const { data: documents } = await supabase
    .from("procedure_documents")
    .select("file_path")
    .eq("procedure_id", procedureId);

  const { error } = await supabase.from("procedures").delete().eq("id", procedureId);

  if (error) {
    return { error: error.message };
  }

  const filePaths = ((documents as { file_path: string }[] | null) ?? []).map((d) => d.file_path);
  if (filePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("procedure-documents").remove(filePaths);
    if (storageError) {
      console.error("[deleteProcedure] failed to remove storage files:", storageError.message);
    }
  }

  revalidatePath("/procedures");
  for (const leadId of matchedLeadIds) {
    revalidatePath(`/leads/${leadId}`);
  }
  return { error: null };
}

export async function addProcedureDocument(
  procedureId: string,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("procedure_documents").insert({
    procedure_id: procedureId,
    file_path: filePath,
    file_name: fileName,
    file_hash: fileHash,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/procedures/${procedureId}`);
  return { error: null };
}

export async function deleteProcedureDocument(documentId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("procedure_documents")
    .select("procedure_id, file_path")
    .eq("id", documentId)
    .maybeSingle();

  const { error } = await supabase.from("procedure_documents").delete().eq("id", documentId);

  if (error) {
    return { error: error.message };
  }

  if (existing?.file_path) {
    const { error: storageError } = await supabase.storage
      .from("procedure-documents")
      .remove([existing.file_path]);
    if (storageError) {
      console.error("[deleteProcedureDocument] failed to remove storage file:", storageError.message);
    }
  }

  if (existing?.procedure_id) {
    revalidatePath(`/procedures/${existing.procedure_id}`);
  }
  return { error: null };
}

// Status transitions around the match set: archived always takes
// precedence and is never overridden here. Otherwise, having one or more
// matches means 'matched'; having zero means 'unmatched'.
async function syncStatusToMatchCount(supabase: SupabaseServerClient, procedureId: string): Promise<void> {
  const { data: procedure } = await supabase
    .from("procedures")
    .select("status")
    .eq("id", procedureId)
    .maybeSingle();
  if (!procedure || procedure.status === "archived") return;

  const { count } = await supabase
    .from("procedure_lead_matches")
    .select("id", { count: "exact", head: true })
    .eq("procedure_id", procedureId);

  const nextStatus = (count ?? 0) > 0 ? "matched" : "unmatched";
  if (nextStatus !== procedure.status) {
    await supabase.from("procedures").update({ status: nextStatus }).eq("id", procedureId);
  }
}

export async function matchProcedureToLead(
  procedureId: string,
  leadId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedure_lead_matches")
    .insert({ procedure_id: procedureId, lead_id: leadId });

  if (error) {
    return { error: error.message };
  }

  await syncStatusToMatchCount(supabase, procedureId);

  revalidatePath("/procedures");
  revalidatePath(`/procedures/${procedureId}`);
  revalidatePath(`/leads/${leadId}`);
  return { error: null };
}

export async function unmatchProcedureFromLead(
  procedureId: string,
  leadId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedure_lead_matches")
    .delete()
    .eq("procedure_id", procedureId)
    .eq("lead_id", leadId);

  if (error) {
    return { error: error.message };
  }

  await syncStatusToMatchCount(supabase, procedureId);

  revalidatePath("/procedures");
  revalidatePath(`/procedures/${procedureId}`);
  revalidatePath(`/leads/${leadId}`);
  return { error: null };
}

export async function archiveProcedure(procedureId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const matchedLeadIds = await getMatchedLeadIds(supabase, procedureId);

  const { error } = await supabase
    .from("procedures")
    .update({ status: "archived" })
    .eq("id", procedureId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/procedures");
  revalidatePath(`/procedures/${procedureId}`);
  for (const leadId of matchedLeadIds) {
    revalidatePath(`/leads/${leadId}`);
  }
  return { error: null };
}

export interface ConvertProcedureToLeadResult {
  // Set only for a failure outside the per-document move loop (wallets,
  // or reading/deleting the procedure itself) — the procedure is left
  // completely untouched in that case.
  error: string | null;
  // Names of documents that failed to move. Any document not listed here
  // moved successfully (uploaded to lead-documents, recorded, and removed
  // from procedure-documents + procedure_documents). Non-empty here means
  // the procedure was NOT deleted, so the un-moved documents stay on it.
  failedDocuments: string[];
}

// Moves a procedure's wallets and documents onto an already-created lead,
// then deletes the procedure. Wallets are copied (the procedure has no
// wallets left to keep once it's deleted). Documents are moved one at a
// time — downloaded from procedure-documents, uploaded into
// lead-documents, recorded as a lead_documents row, then removed from
// procedure-documents — so a failure on one document doesn't block the
// others. The procedure is deleted only if every document moved
// cleanly; otherwise it's left in place (holding only the documents that
// didn't move) and the caller is told which ones failed so nothing is
// silently lost.
export async function convertProcedureToLead(
  procedureId: string,
  leadId: string
): Promise<ConvertProcedureToLeadResult> {
  const supabase = await createClient();

  const { data: walletsData, error: walletsError } = await supabase
    .from("procedure_wallets")
    .select("wallet_address, label")
    .eq("procedure_id", procedureId);
  if (walletsError) {
    return { error: walletsError.message, failedDocuments: [] };
  }

  const wallets = (walletsData as { wallet_address: string; label: string | null }[] | null) ?? [];
  if (wallets.length > 0) {
    const { error: insertWalletsError } = await supabase
      .from("lead_wallets")
      .insert(wallets.map((w) => ({ lead_id: leadId, wallet_address: w.wallet_address, label: w.label })));
    if (insertWalletsError) {
      return { error: insertWalletsError.message, failedDocuments: [] };
    }
  }

  const { data: documentsData, error: documentsError } = await supabase
    .from("procedure_documents")
    .select("id, file_path, file_name, file_hash")
    .eq("procedure_id", procedureId);
  if (documentsError) {
    return { error: documentsError.message, failedDocuments: [] };
  }
  const documents =
    (documentsData as { id: string; file_path: string; file_name: string; file_hash: string | null }[] | null) ?? [];

  const failedDocuments: string[] = [];

  for (const doc of documents) {
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("procedure-documents")
        .download(doc.file_path);
      if (downloadError || !blob) {
        throw new Error(downloadError?.message ?? "Download from procedure-documents failed.");
      }

      const newPath = buildDocumentPath(doc.file_name);
      const { error: uploadError } = await supabase.storage
        .from("lead-documents")
        .upload(newPath, blob, { contentType: blob.type || "application/octet-stream", upsert: false });
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: insertDocError } = await supabase.from("lead_documents").insert({
        lead_id: leadId,
        document_type: "Other",
        file_path: newPath,
        file_name: doc.file_name,
        file_hash: doc.file_hash,
      });
      if (insertDocError) {
        // Don't leave an orphaned upload behind if the DB row failed.
        await supabase.storage.from("lead-documents").remove([newPath]);
        throw new Error(insertDocError.message);
      }

      const { error: deleteSourceError } = await supabase.storage
        .from("procedure-documents")
        .remove([doc.file_path]);
      if (deleteSourceError) {
        // The document is already safely copied into lead-documents, so
        // this isn't data loss — just a leftover source file to clean up
        // by hand. Log it and keep going rather than counting it as a
        // failed move.
        console.error(
          `[convertProcedureToLead] moved "${doc.file_name}" but failed to delete the source file:`,
          deleteSourceError.message
        );
      }

      const { error: deleteRowError } = await supabase.from("procedure_documents").delete().eq("id", doc.id);
      if (deleteRowError) {
        console.error(
          `[convertProcedureToLead] moved "${doc.file_name}" but failed to remove its procedure_documents row:`,
          deleteRowError.message
        );
      }
    } catch (err) {
      failedDocuments.push(doc.file_name);
      console.error(`[convertProcedureToLead] failed to move document "${doc.file_name}":`, err);
    }
  }

  revalidatePath(`/procedures/${procedureId}`);
  revalidatePath(`/leads/${leadId}`);

  if (failedDocuments.length > 0) {
    return { error: null, failedDocuments };
  }

  const { error: deleteProcedureError } = await supabase.from("procedures").delete().eq("id", procedureId);
  if (deleteProcedureError) {
    return { error: deleteProcedureError.message, failedDocuments: [] };
  }

  revalidatePath("/procedures");
  return { error: null, failedDocuments: [] };
}

export interface ProcedureDocumentHashMatch {
  documentId: string;
  procedureId: string;
  fileName: string;
  procedureLabel: string;
}

// Every procedure_documents row with this exact file_hash, across all
// procedures. Same shape/purpose as leads.ts's findLeadDocumentsByHash —
// the caller decides "same record" vs "a different record" by comparing
// procedureId against the one it's uploading to.
export async function findProcedureDocumentsByHash(hash: string): Promise<ProcedureDocumentHashMatch[]> {
  if (!hash) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedure_documents")
    .select("id, procedure_id, file_name")
    .eq("file_hash", hash);

  if (error) {
    console.error("[findProcedureDocumentsByHash] query failed:", error.message);
    return [];
  }

  const rows = (data as { id: string; procedure_id: string; file_name: string }[] | null) ?? [];
  if (rows.length === 0) return [];

  const procedureIds = [...new Set(rows.map((r) => r.procedure_id))];
  const { data: proceduresData } = await supabase
    .from("procedures")
    .select("id, title, raw_content")
    .in("id", procedureIds);
  const proceduresById = new Map(
    ((proceduresData as { id: string; title: string | null; raw_content: string }[] | null) ?? []).map((p) => [
      p.id,
      p,
    ])
  );

  return rows.map((row) => {
    const procedure = proceduresById.get(row.procedure_id);
    return {
      documentId: row.id,
      procedureId: row.procedure_id,
      fileName: row.file_name,
      procedureLabel: procedure ? procedure.title || truncate(procedure.raw_content, 60) : "Procedure",
    };
  });
}

export interface DuplicateProcedureMatch {
  id: string;
  label: string;
  meta: string;
}

// Procedures whose title (trimmed, case-insensitive) or raw_content
// (trimmed, exact) matches the one about to be created. Scans every
// procedure regardless of status — an archived duplicate is still worth
// flagging — and the caller is told each match's status for the warning.
export async function findDuplicateProcedures(input: {
  title: string;
  rawContent: string;
}): Promise<DuplicateProcedureMatch[]> {
  const title = input.title.trim().toLowerCase();
  const rawContent = input.rawContent.trim();
  if (!title && !rawContent) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.from("procedures").select("id, title, raw_content, status");

  if (error) {
    console.error("[findDuplicateProcedures] query failed:", error.message);
    return [];
  }

  const rows = (data as { id: string; title: string | null; raw_content: string; status: ProcedureStatus }[] | null) ?? [];

  const matches = rows.filter(
    (row) => (title && (row.title ?? "").trim().toLowerCase() === title) || row.raw_content.trim() === rawContent
  );
  if (matches.length === 0) return [];

  return matches.map((row) => ({
    id: row.id,
    label: row.title || truncate(row.raw_content, 60),
    meta: STATUS_LABELS[row.status],
  }));
}
