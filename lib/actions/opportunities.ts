"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { buildDocumentPath, withPreservedExtension } from "@/lib/storage";
import { namesAreSimilar, type SimilarMatch } from "@/lib/dedup";
import type { Opportunity, OpportunityDocumentType } from "@/lib/types";

export interface OpportunityFormState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

const MAX_PRODUCT_OPTIONS = 3;

function buildOpportunityPayload(formData: FormData) {
  const title = formData.get("title")?.toString().trim();
  if (!title) {
    throw new Error("titleRequired");
  }

  return {
    title,
    intermediary_person_id: formData.get("intermediary_person_id")?.toString().trim() || null,
    notes_summary: formData.get("notes_summary")?.toString().trim() || null,
  };
}

// 0-3, unlike projects' own 1-3 (parseProductOptions in lib/actions/
// projects.ts) — an opportunity is allowed to carry no product guess at
// all yet.
function parseOpportunityProductOptions(formData: FormData): string[] {
  const raw = formData
    .getAll("product_options")
    .map((v) => v.toString().trim())
    .filter(Boolean);
  const unique = [...new Set(raw)];
  if (unique.length > MAX_PRODUCT_OPTIONS) {
    throw new Error(`An opportunity can have at most ${MAX_PRODUCT_OPTIONS} products.`);
  }
  return unique;
}

export async function createOpportunityWithId(
  formData: FormData
): Promise<{ id: string | null; error: string | null }> {
  let payload: ReturnType<typeof buildOpportunityPayload>;
  let products: string[];
  try {
    payload = buildOpportunityPayload(formData);
    products = parseOpportunityProductOptions(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("opportunities")
      .insert({ ...payload, created_by: user?.id ?? null })
      .select("id")
      .single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "failedToCreateOpportunity" };
    }

    const opportunityId = data.id;

    if (products.length > 0) {
      const { error: productsError } = await supabase
        .from("opportunity_products")
        .insert(products.map((product, index) => ({ opportunity_id: opportunityId, product, sort_order: index + 1 })));
      if (productsError) {
        await supabase.from("opportunities").delete().eq("id", opportunityId);
        return { id: null, error: productsError.message };
      }
    }

    revalidatePath("/opportunities");
    return { id: opportunityId, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

// Reconciles opportunity_products with what the edit form submitted —
// same insert-new-before-deleting-removed shape as lib/actions/
// projects.ts's syncProjectProducts, minus the final_product
// resettlement (opportunities have no such concept).
async function syncOpportunityProducts(
  supabase: SupabaseServerClient,
  opportunityId: string,
  submitted: string[]
): Promise<{ error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("opportunity_products")
    .select("id, product")
    .eq("opportunity_id", opportunityId);
  if (existingError) {
    return { error: existingError.message };
  }

  const existingRows = (existing as { id: string; product: string }[] | null) ?? [];
  const existingByProduct = new Map(existingRows.map((r) => [r.product, r.id]));
  const submittedSet = new Set(submitted);

  const toInsert = submitted.filter((p) => !existingByProduct.has(p));
  const toDelete = existingRows.filter((r) => !submittedSet.has(r.product));

  if (toInsert.length > 0) {
    const startOrder = existingRows.length + 1;
    const { error } = await supabase
      .from("opportunity_products")
      .insert(toInsert.map((product, i) => ({ opportunity_id: opportunityId, product, sort_order: startOrder + i })));
    if (error) return { error: error.message };
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("opportunity_products")
      .delete()
      .in(
        "id",
        toDelete.map((r) => r.id)
      );
    if (error) return { error: error.message };
  }

  return { error: null };
}

export async function updateOpportunity(
  id: string,
  _prevState: OpportunityFormState,
  formData: FormData
): Promise<OpportunityFormState> {
  let payload: ReturnType<typeof buildOpportunityPayload>;
  let products: string[];
  try {
    payload = buildOpportunityPayload(formData);
    products = parseOpportunityProductOptions(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("opportunities").update(payload).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    const syncResult = await syncOpportunityProducts(supabase, id, products);
    if (syncResult.error) {
      return { error: syncResult.error };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
  return { error: null };
}

export async function deleteOpportunity(opportunityId: string): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "onlyAdminsCanDeleteOpportunities" };
    }

    const supabase = await createClient();

    const { data: documents } = await supabase
      .from("opportunity_documents")
      .select("file_path")
      .eq("opportunity_id", opportunityId);
    const filePaths = ((documents as { file_path: string | null }[] | null) ?? [])
      .map((d) => d.file_path)
      .filter((p): p is string => Boolean(p));

    const { error } = await supabase.from("opportunities").delete().eq("id", opportunityId);
    if (error) {
      return { error: error.message };
    }

    if (filePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from("opportunity-documents").remove(filePaths);
      if (storageError) {
        console.error("[deleteOpportunity] failed to remove storage files:", storageError.message);
      }
    }

    revalidatePath("/opportunities");
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// The Inbox's "+ New opportunity" quick-create (components/inbox/
// file-into-panel.tsx) — same minimal shape as quickCreateContact/
// quickCreatePerson.
export async function quickCreateOpportunity(input: {
  title: string;
  intermediaryPersonId?: string | null;
}): Promise<{ opportunity: Opportunity | null; error: string | null }> {
  const title = input.title.trim();
  if (!title) {
    return { opportunity: null, error: "titleRequired" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        title,
        intermediary_person_id: input.intermediaryPersonId || null,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();

    if (error || !data) {
      return { opportunity: null, error: error?.message ?? "failedToCreateOpportunity" };
    }

    revalidatePath("/opportunities");
    return { opportunity: data as Opportunity, error: null };
  } catch (err) {
    return { opportunity: null, error: unexpectedErrorMessage(err) };
  }
}

// Name-similarity check — the Inbox's quick-create "Similar: X — use
// this instead?" (components/inbox/quick-create-panel.tsx). Warning
// only, never blocks creating. Opportunities have no nickname, so this
// only ever compares against the typed title.
export async function findSimilarOpportunities(title: string): Promise<SimilarMatch[]> {
  if (!title.trim()) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("opportunities").select("id, title").eq("status", "open");
    if (error) {
      console.error("[findSimilarOpportunities] query failed:", error.message);
      return [];
    }

    const rows = (data as { id: string; title: string }[] | null) ?? [];
    return rows
      .filter((row) => namesAreSimilar(row.title, title))
      .map((row) => ({ id: row.id, label: row.title, href: `/opportunities/${row.id}` }));
  } catch (err) {
    console.error("[findSimilarOpportunities] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// ----------------------------------------------------------------------------
// Documents — same shape as lib/actions/projects.ts's addProjectDocument/
// addProjectDocumentLink/deleteProjectDocument/renameProjectDocument/
// findProjectDocumentsByHash, minus any tranche_id (opportunities have
// no tranches to move a document between).
// ----------------------------------------------------------------------------

export async function addOpportunityDocument(
  opportunityId: string,
  documentType: OpportunityDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null; id?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("opportunity_documents")
      .insert({
        opportunity_id: opportunityId,
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

    revalidatePath(`/opportunities/${opportunityId}`);
    return { error: null, id: (data as { id: string }).id };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function addOpportunityDocumentLink(
  opportunityId: string,
  documentType: OpportunityDocumentType,
  name: string,
  url: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("opportunity_documents").insert({
      opportunity_id: opportunityId,
      document_type: documentType,
      file_name: name,
      url,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/opportunities/${opportunityId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteOpportunityDocument(documentId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("opportunity_documents")
      .select("opportunity_id, file_path")
      .eq("id", documentId)
      .maybeSingle();

    const { error } = await supabase.from("opportunity_documents").delete().eq("id", documentId);
    if (error) {
      return { error: error.message };
    }

    if (existing?.file_path) {
      const { error: storageError } = await supabase.storage.from("opportunity-documents").remove([existing.file_path]);
      if (storageError) {
        console.error("[deleteOpportunityDocument] failed to remove storage file:", storageError.message);
      }
    }

    if (existing?.opportunity_id) {
      revalidatePath(`/opportunities/${existing.opportunity_id}`);
    }
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function renameOpportunityDocument(documentId: string, newName: string): Promise<{ error: string | null }> {
  if (!newName.trim()) {
    return { error: "nameCannotBeEmpty" };
  }

  try {
    const supabase = await createClient();

    const { data: existing, error: readError } = await supabase
      .from("opportunity_documents")
      .select("opportunity_id, file_name")
      .eq("id", documentId)
      .maybeSingle();
    if (readError || !existing) {
      return { error: readError?.message ?? "documentNotFound" };
    }

    const finalName = withPreservedExtension(existing.file_name, newName);
    const { error } = await supabase.from("opportunity_documents").update({ file_name: finalName }).eq("id", documentId);
    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/opportunities/${existing.opportunity_id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface OpportunityDocumentHashMatch {
  documentId: string;
  opportunityId: string;
  opportunityLabel: string;
  fileName: string;
}

export async function findOpportunityDocumentsByHash(hash: string): Promise<OpportunityDocumentHashMatch[]> {
  if (!hash) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("opportunity_documents")
      .select("id, opportunity_id, file_name")
      .eq("file_hash", hash);

    if (error) {
      console.error("[findOpportunityDocumentsByHash] query failed:", error.message);
      return [];
    }

    const rows = (data as { id: string; opportunity_id: string; file_name: string }[] | null) ?? [];
    if (rows.length === 0) return [];

    const opportunityIds = [...new Set(rows.map((r) => r.opportunity_id))];
    const { data: opportunitiesData } = await supabase.from("opportunities").select("id, title").in("id", opportunityIds);
    const titleById = new Map(
      ((opportunitiesData as { id: string; title: string }[] | null) ?? []).map((o) => [o.id, o.title])
    );

    return rows.map((row) => ({
      documentId: row.id,
      opportunityId: row.opportunity_id,
      opportunityLabel: titleById.get(row.opportunity_id) ?? "Opportunity",
      fileName: row.file_name,
    }));
  } catch (err) {
    console.error("[findOpportunityDocumentsByHash] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// ----------------------------------------------------------------------------
// Notes — same minimal shape as lib/actions/contacts.ts's addContactNote.
// ----------------------------------------------------------------------------

export async function addOpportunityNote(opportunityId: string, formData: FormData): Promise<{ error: string | null }> {
  const content = formData.get("content")?.toString().trim();
  if (!content) {
    return { error: "contentRequired" };
  }

  const isReminder = formData.get("is_reminder") === "on";
  const dueDate = formData.get("due_date")?.toString().trim() || null;
  if (isReminder && !dueDate) {
    return { error: "dueDateRequiredForReminder" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("notes").insert({
      title: formData.get("title")?.toString().trim() || null,
      content,
      is_reminder: isReminder,
      due_date: isReminder ? dueDate : null,
      opportunity_id: opportunityId,
      created_by: user?.id ?? null,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/opportunities/${opportunityId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Close / reopen
// ----------------------------------------------------------------------------

export async function closeOpportunity(opportunityId: string, reason: string | null): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("opportunities")
      .update({ status: "closed", closed_reason: reason?.trim() || null })
      .eq("id", opportunityId);
    if (error) {
      return { error: error.message };
    }
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${opportunityId}`);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function reopenOpportunity(opportunityId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("opportunities")
      .update({ status: "open", closed_reason: null })
      .eq("id", opportunityId);
    if (error) {
      return { error: error.message };
    }
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${opportunityId}`);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Convert to project / attach to receiver
//
// Both move every opportunity_documents row into the target's own
// documents table — a real storage move (download from opportunity-
// documents, re-upload into project-documents/contact-documents under a
// fresh path, then remove the original) for an uploaded file; a link
// row just copies straight across, nothing to move in storage. Every
// note on the opportunity is simply re-pointed (project_id/contact_id
// set, opportunity_id cleared) — no storage involved there at all.
// Either failure path leaves the opportunity exactly as it was (still
// 'open', nothing moved) rather than a half-moved state: all document
// moves are attempted before the opportunity itself is updated, and the
// first one to fail stops the rest.
// ----------------------------------------------------------------------------

async function moveOpportunityAssets(
  supabase: SupabaseServerClient,
  opportunityId: string,
  target: { type: "project" | "contact"; id: string }
): Promise<{ error: string | null }> {
  const targetTable = target.type === "project" ? "project_documents" : "contact_documents";
  const targetBucket = target.type === "project" ? "project-documents" : "contact-documents";
  const targetIdColumn = target.type === "project" ? "project_id" : "contact_id";

  const { data: docsData, error: docsError } = await supabase
    .from("opportunity_documents")
    .select("*")
    .eq("opportunity_id", opportunityId);
  if (docsError) return { error: docsError.message };

  const docs =
    (docsData as
      | { id: string; document_type: string; file_path: string | null; file_name: string; file_hash: string | null; url: string | null }[]
      | null) ?? [];

  for (const doc of docs) {
    if (doc.url) {
      const { error: insertError } = await supabase.from(targetTable).insert({
        [targetIdColumn]: target.id,
        document_type: doc.document_type,
        file_name: doc.file_name,
        url: doc.url,
      });
      if (insertError) return { error: insertError.message };
    } else if (doc.file_path) {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("opportunity-documents")
        .download(doc.file_path);
      if (downloadError || !blob) {
        return { error: downloadError?.message ?? "couldNotReadFile" };
      }

      const newPath = buildDocumentPath(doc.file_name);
      const { error: uploadError } = await supabase.storage.from(targetBucket).upload(newPath, blob, {
        contentType: blob.type || "application/octet-stream",
      });
      if (uploadError) return { error: uploadError.message };

      const { error: insertError } = await supabase.from(targetTable).insert({
        [targetIdColumn]: target.id,
        document_type: doc.document_type,
        file_name: doc.file_name,
        file_path: newPath,
        file_hash: doc.file_hash,
      });
      if (insertError) {
        await supabase.storage.from(targetBucket).remove([newPath]);
        return { error: insertError.message };
      }

      const { error: removeError } = await supabase.storage.from("opportunity-documents").remove([doc.file_path]);
      if (removeError) {
        console.error("[moveOpportunityAssets] failed to remove source storage file:", removeError.message);
      }
    }

    const { error: deleteError } = await supabase.from("opportunity_documents").delete().eq("id", doc.id);
    if (deleteError) return { error: deleteError.message };
  }

  const noteLinkColumn = target.type === "project" ? { project_id: target.id } : { contact_id: target.id };
  const { error: notesError } = await supabase
    .from("notes")
    .update({ ...noteLinkColumn, opportunity_id: null })
    .eq("opportunity_id", opportunityId);
  if (notesError) return { error: notesError.message };

  return { error: null };
}

// Called client-side right after the new project (pre-filled from this
// opportunity — components/opportunities/convert-to-project-button.tsx
// navigates to /projects/new?fromOpportunity=<id>, and components/
// projects/project-form.tsx's create flow calls this once the project
// itself has actually been saved). The intermediary chain entry and the
// product options are seeded by the form itself (same create flow every
// other project uses) — this only moves documents/notes and marks the
// opportunity converted.
export async function convertOpportunityToProject(
  opportunityId: string,
  projectId: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const moveResult = await moveOpportunityAssets(supabase, opportunityId, { type: "project", id: projectId });
    if (moveResult.error) return { error: moveResult.error };

    const { error } = await supabase
      .from("opportunities")
      .update({ status: "converted", converted_to_type: "project", converted_to_id: projectId })
      .eq("id", opportunityId);
    if (error) return { error: error.message };

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${opportunityId}`);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function attachOpportunityToReceiver(
  opportunityId: string,
  receiverId: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const moveResult = await moveOpportunityAssets(supabase, opportunityId, { type: "contact", id: receiverId });
    if (moveResult.error) return { error: moveResult.error };

    const { error } = await supabase
      .from("opportunities")
      .update({ status: "converted", converted_to_type: "receiver", converted_to_id: receiverId })
      .eq("id", opportunityId);
    if (error) return { error: error.message };

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${opportunityId}`);
    revalidatePath(`/receivers/${receiverId}`);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
