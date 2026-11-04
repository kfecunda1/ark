"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS } from "@/lib/projects";
import type { Contact, ProjectDocumentType, ProjectPriority, ProjectStage } from "@/lib/types";

export interface ProjectFormState {
  error: string | null;
}

const REQUIRED_FIELDS = ["product_type", "procedure_type"] as const;

function buildProjectPayload(formData: FormData) {
  for (const field of REQUIRED_FIELDS) {
    if (!formData.get(field)?.toString().trim()) {
      throw new Error(`"${field.replace(/_/g, " ")}" is required.`);
    }
  }

  const primaryContactId = formData.get("primary_contact_id")?.toString().trim();
  if (!primaryContactId) {
    throw new Error('"Primary Contact" is required.');
  }

  const dealValueRaw = formData.get("deal_value")?.toString().trim();
  const followUpRaw = formData.get("follow_up_date")?.toString().trim();
  const assignedToRaw = formData.get("assigned_to")?.toString().trim();
  const counterpartyContactId = formData.get("counterparty_contact_id")?.toString().trim();

  return {
    product_type: (formData.get("product_type") as string).trim(),
    procedure_type: (formData.get("procedure_type") as string).trim(),
    priority: formData.get("priority") as ProjectPriority,
    stage: formData.get("stage") as ProjectStage,
    primary_contact_id: primaryContactId,
    counterparty_contact_id: counterpartyContactId || null,
    deal_value: dealValueRaw ? Number(dealValueRaw) : null,
    currency: formData.get("currency")?.toString().trim() || null,
    source: formData.get("source")?.toString().trim() || null,
    notes: formData.get("notes")?.toString().trim() || null,
    follow_up_date: followUpRaw || null,
    assigned_to: assignedToRaw || null,
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

  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").insert(payload).select("id").single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Failed to create project." };
  }

  revalidatePath("/projects");
  return { id: data.id, error: null };
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

  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(payload).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export async function updateProjectStage(
  id: string,
  stage: ProjectStage
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ stage }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return { error: null };
}

export async function toggleProjectArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ archived }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function addProjectDocument(
  projectId: string,
  documentType: ProjectDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("lead_documents").insert({
    lead_id: projectId,
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
}

export async function deleteProjectDocument(documentId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("lead_documents")
    .select("lead_id, file_path")
    .eq("id", documentId)
    .maybeSingle();

  const { error } = await supabase.from("lead_documents").delete().eq("id", documentId);

  if (error) {
    return { error: error.message };
  }

  if (existing?.file_path) {
    const { error: storageError } = await supabase.storage
      .from("lead-documents")
      .remove([existing.file_path]);
    if (storageError) {
      console.error("[deleteProjectDocument] failed to remove storage file:", storageError.message);
    }
  }

  if (existing?.lead_id) {
    revalidatePath(`/projects/${existing.lead_id}`);
  }
  return { error: null };
}

// Same "primary contact name, else product type" label the activity log
// (migration 019's activity_lead_label) and the reminders digest already
// used — kept as a small local helper rather than a shared export since
// callers here already have the contact rows in hand.
function projectLabel(project: { product_type: string }, contactName: string | null): string {
  return contactName || project.product_type || "Project";
}

export interface ProjectDocumentHashMatch {
  documentId: string;
  projectId: string;
  fileName: string;
  projectLabel: string;
}

// Every lead_documents row with this exact file_hash, across all
// projects. The caller (the upload UI) decides what "same record" vs "a
// different record" means by comparing projectId against the project
// it's uploading to — for a brand-new project that doesn't exist yet,
// every match is necessarily "a different record".
export async function findProjectDocumentsByHash(hash: string): Promise<ProjectDocumentHashMatch[]> {
  if (!hash) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_documents")
    .select("id, lead_id, file_name")
    .eq("file_hash", hash);

  if (error) {
    console.error("[findProjectDocumentsByHash] query failed:", error.message);
    return [];
  }

  const rows = (data as { id: string; lead_id: string; file_name: string }[] | null) ?? [];
  if (rows.length === 0) return [];

  const projectIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: projectsData } = await supabase
    .from("leads")
    .select("id, product_type, primary_contact_id")
    .in("id", projectIds);
  const projects =
    (projectsData as { id: string; product_type: string; primary_contact_id: string | null }[] | null) ?? [];
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const contactIds = projects.map((p) => p.primary_contact_id).filter((id): id is string => Boolean(id));
  let contactNameById = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase.from("contacts").select("id, full_name").in("id", contactIds);
    contactNameById = new Map(((contactsData as Pick<Contact, "id" | "full_name">[] | null) ?? []).map((c) => [c.id, c.full_name]));
  }

  return rows.map((row) => {
    const project = projectsById.get(row.lead_id);
    const contactName = project?.primary_contact_id ? (contactNameById.get(project.primary_contact_id) ?? null) : null;
    return {
      documentId: row.id,
      projectId: row.lead_id,
      fileName: row.file_name,
      projectLabel: project ? projectLabel(project, contactName) : "Project",
    };
  });
}

export interface DuplicateProjectMatch {
  id: string;
  label: string;
  meta: string;
}

// Projects sharing the same primary contact + product type + procedure
// type (compared trimmed and case-insensitively) as the one about to be
// created. Scans every project regardless of archived state or stage —
// including a closed-out duplicate is still useful information — and the
// caller is told the stage/archived state of each so it can show that in
// the warning.
export async function findDuplicateProjects(input: {
  primaryContactId: string;
  productType: string;
  procedureType: string;
}): Promise<DuplicateProjectMatch[]> {
  const productType = input.productType.trim().toLowerCase();
  const procedureType = input.procedureType.trim().toLowerCase();
  if (!input.primaryContactId || !productType || !procedureType) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, product_type, procedure_type, stage, archived")
    .eq("primary_contact_id", input.primaryContactId);

  if (error) {
    console.error("[findDuplicateProjects] query failed:", error.message);
    return [];
  }

  const rows =
    (data as { id: string; product_type: string; procedure_type: string; stage: ProjectStage; archived: boolean }[] | null) ??
    [];

  const matches = rows.filter(
    (row) =>
      row.product_type.trim().toLowerCase() === productType &&
      row.procedure_type.trim().toLowerCase() === procedureType
  );
  if (matches.length === 0) return [];

  const { data: contactData } = await supabase
    .from("contacts")
    .select("full_name")
    .eq("id", input.primaryContactId)
    .maybeSingle();
  const contactName = (contactData as { full_name: string } | null)?.full_name ?? null;

  return matches.map((row) => ({
    id: row.id,
    label: projectLabel(row, contactName),
    meta: row.archived ? `Archived · ${STAGE_LABELS[row.stage]}` : STAGE_LABELS[row.stage],
  }));
}
