"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, STATUS_LABELS } from "@/lib/projects";
import type {
  Currency,
  ProductType,
  ProjectDocumentType,
  ProjectPriority,
  ProjectStage,
  ProjectStatus,
} from "@/lib/types";

export interface ProjectFormState {
  error: string | null;
}

// Supabase-js resolves query errors as a returned `{ error }` value, not
// a thrown exception — every `if (error) return { error: error.message }`
// below handles that normal case. This instead guards against the
// genuinely exceptional case (a network failure, Supabase unreachable,
// …), so that turns into a normal returned error too, rather than an
// uncaught exception the caller's `if (result.error)` check would never
// see — which is how a save can fail with nothing visible at all.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

const REQUIRED_FIELDS = ["name", "product_type"] as const;

function buildProjectPayload(formData: FormData) {
  for (const field of REQUIRED_FIELDS) {
    if (!formData.get(field)?.toString().trim()) {
      throw new Error(`"${field.replace(/_/g, " ")}" is required.`);
    }
  }

  const stage = formData.get("stage") as ProjectStage;
  const statusRaw = formData.get("status")?.toString().trim();
  // Only meaningful (and only ever submitted by the form) once stage is
  // Status — the DB's check constraint requires it then and nowhere
  // else, so this mirrors that rather than trusting a stray value.
  const status = stage === "status" ? ((statusRaw || null) as ProjectStatus | null) : null;
  if (stage === "status" && !status) {
    throw new Error('"Status" is required once Stage is Status.');
  }

  const clientContactId = formData.get("client_contact_id")?.toString().trim();
  const assignedContactId = formData.get("assigned_contact_id")?.toString().trim();
  const totalFaceValueRaw = formData.get("total_face_value")?.toString().trim();

  return {
    name: (formData.get("name") as string).trim(),
    product_type: formData.get("product_type") as ProductType,
    stage,
    status,
    client_contact_id: clientContactId || null,
    assigned_contact_id: assignedContactId || null,
    ratio_presented: formData.get("ratio_presented")?.toString().trim() || null,
    ratio_real: formData.get("ratio_real")?.toString().trim() || null,
    total_face_value: totalFaceValueRaw ? Number(totalFaceValueRaw) : null,
    currency: (formData.get("currency")?.toString().trim() || "USD") as Currency,
    priority: formData.get("priority") as ProjectPriority,
  };
}

// Returns the new project's id instead of redirecting, so the caller can
// upload staged documents (which needs the project's id) before
// navigating.
export async function createProjectWithId(
  formData: FormData
): Promise<{ id: string | null; error: string | null }> {
  let payload;
  try {
    payload = buildProjectPayload(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("projects")
      .insert({ ...payload, created_by: user?.id ?? null })
      .select("id")
      .single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "Failed to create project." };
    }

    revalidatePath("/projects");
    return { id: data.id, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

export async function updateProject(
  id: string,
  _prevState: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  let payload;
  try {
    payload = buildProjectPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  // Deliberately not wrapped in the outer try/catch below: redirect()
  // works by throwing a special Next.js-internal value, and catching
  // that here would turn a successful save into a reported error
  // instead of the navigation it's supposed to be.
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

// A quick stage change (the detail page's inline StageSelect). Moving
// into Status with no status on record yet defaults it to "open" rather
// than failing the switch outright — the DB requires a non-null status
// once stage = status. Moving *out* of Status clears status back to
// null, so a project isn't left showing a stale status from a visit to
// that stage it's no longer in; both directions keep the row valid
// against that same check constraint.
export async function updateProjectStage(
  id: string,
  stage: ProjectStage
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const payload: { stage: ProjectStage; status: ProjectStatus | null } = { stage, status: null };

    if (stage === "status") {
      const { data: current } = await supabase.from("projects").select("status").eq("id", id).maybeSingle();
      payload.status = current?.status ?? "open";
    }

    const { error } = await supabase.from("projects").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// A quick status change (the detail page's inline StatusSelect, and the
// list page's per-row one). The Status control is always visible and
// usable regardless of the project's current stage — picking a status
// sets stage to "status" in the same update, which is what keeps this
// valid against the "status required once stage = status" check
// constraint no matter what stage the project was previously in.
export async function updateProjectStatus(
  id: string,
  status: ProjectStatus
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update({ status, stage: "status" }).eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function toggleProjectArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Tranches
//
// Tranche 1 and 2 are permanent slots the UI always shows, with or
// without a row in the DB yet (see components/projects/tranches-section.
// tsx); upsert on the (project_id, tranche_number) unique constraint lets
// one call create-or-update either way. Only tranche 3+ can be removed —
// 1 and 2 are cleared (amount/date set back to empty) instead.
// ----------------------------------------------------------------------------

export async function upsertProjectTranche(
  projectId: string,
  trancheNumber: number,
  amountRaw: string,
  sentOnRaw: string,
  notesRaw: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { error } = await supabase.from("project_tranches").upsert(
      {
        project_id: projectId,
        tranche_number: trancheNumber,
        amount: amountRaw.trim() ? Number(amountRaw) : null,
        sent_on: sentOnRaw.trim() || null,
        notes: notesRaw.trim() || null,
      },
      { onConflict: "project_id,tranche_number" }
    );

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteProjectTranche(
  projectId: string,
  trancheNumber: number
): Promise<{ error: string | null }> {
  if (trancheNumber <= 2) {
    return { error: "Tranche 1 and 2 can't be removed — clear the amount and date instead." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_tranches")
      .delete()
      .eq("project_id", projectId)
      .eq("tranche_number", trancheNumber);

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Documents
// ----------------------------------------------------------------------------

export async function addProjectDocument(
  projectId: string,
  documentType: ProjectDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("project_documents").insert({
      project_id: projectId,
      document_type: documentType,
      file_path: filePath,
      file_name: fileName,
      file_hash: fileHash,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteProjectDocument(documentId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("project_documents")
      .select("project_id, file_path")
      .eq("id", documentId)
      .maybeSingle();

    const { error } = await supabase.from("project_documents").delete().eq("id", documentId);

    if (error) {
      return { error: error.message };
    }

    if (existing?.file_path) {
      const { error: storageError } = await supabase.storage
        .from("project-documents")
        .remove([existing.file_path]);
      if (storageError) {
        console.error("[deleteProjectDocument] failed to remove storage file:", storageError.message);
      }
    }

    if (existing?.project_id) {
      revalidatePath(`/projects/${existing.project_id}`);
    }
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface ProjectDocumentHashMatch {
  documentId: string;
  projectId: string;
  projectLabel: string;
  fileName: string;
}

// Every project_documents row with this exact file_hash, across all
// projects. The caller (the upload UI) decides what "same record" vs "a
// different record" means by comparing projectId against the project
// it's uploading to — for a brand-new project that doesn't exist yet,
// every match is necessarily "a different record".
//
// Returns [] on failure (same as "no matches") rather than a separate
// error shape — this only ever gates a *warning* banner, never blocks
// the upload itself, so the caller (components/projects/project-
// documents.tsx / staged-document-picker.tsx) already wraps its own call
// to this in try/catch and shows its own error if the whole check fails.
export async function findProjectDocumentsByHash(hash: string): Promise<ProjectDocumentHashMatch[]> {
  if (!hash) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_documents")
      .select("id, project_id, file_name")
      .eq("file_hash", hash);

    if (error) {
      console.error("[findProjectDocumentsByHash] query failed:", error.message);
      return [];
    }

    const rows = (data as { id: string; project_id: string; file_name: string }[] | null) ?? [];
    if (rows.length === 0) return [];

    const projectIds = [...new Set(rows.map((r) => r.project_id))];
    const { data: projectsData } = await supabase.from("projects").select("id, name").in("id", projectIds);
    const projectNameById = new Map(
      ((projectsData as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name])
    );

    return rows.map((row) => ({
      documentId: row.id,
      projectId: row.project_id,
      projectLabel: projectNameById.get(row.project_id) ?? "Project",
      fileName: row.file_name,
    }));
  } catch (err) {
    console.error("[findProjectDocumentsByHash] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// ----------------------------------------------------------------------------
// Duplicate detection — a warning only. One client can have several
// deals of the same product, so this never blocks a save; it just tells
// the Add Anyway banner what to show.
// ----------------------------------------------------------------------------

export interface DuplicateProjectMatch {
  id: string;
  label: string;
  meta: string;
}

// Projects sharing the same client contact and product type as the one
// about to be created. Scans every project regardless of archived state
// or stage — including a closed-out duplicate is still useful
// information — and the caller is told the stage/status/archived state
// of each so it can show that in the warning.
export async function findDuplicateProjects(input: {
  clientContactId: string;
  productType: ProductType;
}): Promise<DuplicateProjectMatch[]> {
  if (!input.clientContactId) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, stage, status, archived_at")
      .eq("client_contact_id", input.clientContactId)
      .eq("product_type", input.productType);

    if (error) {
      console.error("[findDuplicateProjects] query failed:", error.message);
      return [];
    }

    const rows =
      (data as
        | { id: string; name: string; stage: ProjectStage; status: ProjectStatus | null; archived_at: string | null }[]
        | null) ?? [];
    if (rows.length === 0) return [];

    return rows.map((row) => {
      const stageLabel = row.status ? STATUS_LABELS[row.status] : STAGE_LABELS[row.stage];
      return {
        id: row.id,
        label: row.name,
        meta: row.archived_at ? `Archived · ${stageLabel}` : stageLabel,
      };
    });
  } catch (err) {
    console.error("[findDuplicateProjects] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}
