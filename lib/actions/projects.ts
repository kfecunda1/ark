"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getContactProductRatio } from "@/lib/actions/contacts";
import { STAGE_LABELS } from "@/lib/projects";
import { parseMoneyFormValue } from "@/lib/money";
import { syncProjectIntermediaries } from "@/lib/intermediaries";
import type { Currency, ProjectDocumentType, ProjectPriority, ProjectStage, ProjectStatus } from "@/lib/types";

export interface ProjectFormState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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

const REQUIRED_FIELDS = ["name"] as const;
const MAX_PRODUCT_OPTIONS = 3;

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

  const matchedContactId = formData.get("matched_contact_id")?.toString().trim();

  return {
    name: (formData.get("name") as string).trim(),
    stage,
    status,
    matched_contact_id: matchedContactId || null,
    contact_person_id: formData.get("contact_person_id")?.toString().trim() || null,
    ratio_presented: formData.get("ratio_presented")?.toString().trim() || null,
    ratio_real: formData.get("ratio_real")?.toString().trim() || null,
    total_face_value: parseMoneyFormValue(formData.get("total_face_value")?.toString()),
    currency: (formData.get("currency")?.toString().trim() || "USD") as Currency,
    priority: formData.get("priority") as ProjectPriority,
    is_recovery: formData.get("is_recovery") === "on",
  };
}

// A project has 1-3 product options, submitted as repeated same-named
// fields (see components/projects/project-form.tsx's product option
// rows) — not a single "product_type" anymore.
function parseProductOptions(formData: FormData): string[] {
  const raw = formData
    .getAll("product_options")
    .map((v) => v.toString().trim())
    .filter(Boolean);
  const unique = [...new Set(raw)];

  if (unique.length === 0) {
    throw new Error("At least one product is required.");
  }
  if (unique.length > MAX_PRODUCT_OPTIONS) {
    throw new Error(`A project can have at most ${MAX_PRODUCT_OPTIONS} products.`);
  }
  return unique;
}

// The create/edit form's "Intermediary chain" picker (components/
// projects/intermediary-chain-editor.tsx) stages its order purely
// locally and submits it as repeated, already-ordered hidden fields —
// unlike product_options, duplicates can't occur (the picker excludes
// anyone already in the chain) and there's no 1-3 cap, so no extra
// validation is needed beyond trimming/filtering blanks.
function parseIntermediaryPersonIds(formData: FormData): string[] {
  return formData
    .getAll("intermediary_person_ids")
    .map((v) => v.toString().trim())
    .filter(Boolean);
}

// Returns the new project's id instead of redirecting, so the caller can
// upload staged documents (which needs the project's id) before
// navigating.
export async function createProjectWithId(
  formData: FormData
): Promise<{ id: string | null; error: string | null }> {
  let payload: ReturnType<typeof buildProjectPayload>;
  let products: string[];
  let intermediaryPersonIds: string[];
  try {
    payload = buildProjectPayload(formData);
    products = parseProductOptions(formData);
    intermediaryPersonIds = parseIntermediaryPersonIds(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // final_product starts null — it can only ever reference a row in
    // project_products (validate_final_product enforces this), and
    // that row doesn't exist until the insert just below.
    const { data, error } = await supabase
      .from("projects")
      .insert({ ...payload, created_by: user?.id ?? null })
      .select("id")
      .single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "Failed to create project." };
    }

    const projectId = data.id;

    const { error: productsError } = await supabase
      .from("project_products")
      .insert(products.map((product, index) => ({ project_id: projectId, product, sort_order: index + 1 })));

    if (productsError) {
      // Don't leave a project behind with no product options at all —
      // it's an invalid state nothing else in the app expects.
      await supabase.from("projects").delete().eq("id", projectId);
      return { id: null, error: productsError.message };
    }

    // A single option counts as final automatically.
    if (products.length === 1) {
      const { error: finalError } = await supabase
        .from("projects")
        .update({ final_product: products[0] })
        .eq("id", projectId);
      if (finalError) {
        return { id: null, error: finalError.message };
      }
    }

    if (intermediaryPersonIds.length > 0) {
      const intermediariesResult = await syncProjectIntermediaries(
        supabase,
        projectId,
        payload.matched_contact_id,
        intermediaryPersonIds
      );
      if (intermediariesResult.error) {
        // Same "don't leave an invalid/half-finished project behind"
        // reasoning as the product-options failure above.
        await supabase.from("projects").delete().eq("id", projectId);
        return { id: null, error: intermediariesResult.error };
      }
    }

    revalidatePath("/projects");
    return { id: projectId, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

// Reconciles a project's product_products rows with what the edit form
// submitted, then re-settles final_product: cleared if it's no longer
// among the submitted products, auto-set if exactly one option remains
// (and none was already final) — same "one option = automatically
// final" rule createProjectWithId applies at creation.
//
// Inserts new options *before* deleting removed ones — not the other
// order — because protect_last_project_product (supabase/migrations/
// 013_projects_restructure.sql) blocks deleting a project's very last
// option: replacing a project's sole option with a different one is a
// delete-then-insert from the form's point of view, but deleting first
// would momentarily leave zero rows and get refused.
async function syncProjectProducts(
  supabase: SupabaseServerClient,
  projectId: string,
  submitted: string[]
): Promise<{ error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("project_products")
    .select("id, product")
    .eq("project_id", projectId);
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
      .from("project_products")
      .insert(toInsert.map((product, i) => ({ project_id: projectId, product, sort_order: startOrder + i })));
    if (error) return { error: error.message };
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("project_products")
      .delete()
      .in(
        "id",
        toDelete.map((r) => r.id)
      );
    if (error) return { error: error.message };
  }

  const { data: projectRow } = await supabase.from("projects").select("final_product").eq("id", projectId).maybeSingle();
  const currentFinal = (projectRow as { final_product: string | null } | null)?.final_product ?? null;

  if (currentFinal && !submittedSet.has(currentFinal)) {
    const { error } = await supabase.from("projects").update({ final_product: null }).eq("id", projectId);
    if (error) return { error: error.message };
  } else if (!currentFinal && submitted.length === 1) {
    const { error } = await supabase.from("projects").update({ final_product: submitted[0] }).eq("id", projectId);
    if (error) return { error: error.message };
  }

  return { error: null };
}

export async function updateProject(
  id: string,
  _prevState: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  let payload: ReturnType<typeof buildProjectPayload>;
  let products: string[];
  let intermediaryPersonIds: string[];
  try {
    payload = buildProjectPayload(formData);
    products = parseProductOptions(formData);
    intermediaryPersonIds = parseIntermediaryPersonIds(formData);
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

    const syncResult = await syncProjectProducts(supabase, id, products);
    if (syncResult.error) {
      return { error: syncResult.error };
    }

    const intermediariesResult = await syncProjectIntermediaries(
      supabase,
      id,
      payload.matched_contact_id,
      intermediaryPersonIds
    );
    if (intermediariesResult.error) {
      return { error: intermediariesResult.error };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

// A quick stage change (the detail page's inline StageSelect). Moving
// into Status with no status on record yet defaults it to the first
// active, open-kind status (by sort_order) rather than failing the
// switch outright — the DB requires a non-null status once stage =
// status. Statuses are admin-managed now (supabase/migrations/019_
// statuses.sql), so there's no fixed "open" name to fall back to;
// falling back further to the first active status at all covers the
// pathological case where an admin hides every open-kind status.
// Moving *out* of Status clears status back to null, so a project
// isn't left showing a stale status from a visit to that stage it's no
// longer in; both directions keep the row valid against that same
// check constraint.
export async function updateProjectStage(
  id: string,
  stage: ProjectStage
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const payload: { stage: ProjectStage; status: ProjectStatus | null } = { stage, status: null };

    if (stage === "status") {
      const { data: current } = await supabase.from("projects").select("status").eq("id", id).maybeSingle();
      if (current?.status) {
        payload.status = current.status;
      } else {
        const { data: openStatus } = await supabase
          .from("statuses")
          .select("name")
          .eq("active", true)
          .eq("kind", "open")
          .order("sort_order")
          .limit(1)
          .maybeSingle();
        if (openStatus) {
          payload.status = (openStatus as { name: string }).name;
        } else {
          const { data: anyStatus } = await supabase
            .from("statuses")
            .select("name")
            .eq("active", true)
            .order("sort_order")
            .limit(1)
            .maybeSingle();
          payload.status = (anyStatus as { name: string } | null)?.name ?? null;
        }
      }
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
        amount: parseMoneyFormValue(amountRaw),
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
// Duplicate detection — a warning only. One matched contact can have
// several deals on the same product, so this never blocks a save; it
// just tells the Add Anyway banner what to show.
// ----------------------------------------------------------------------------

export interface DuplicateProjectMatch {
  id: string;
  label: string;
  meta: string;
}

// Projects sharing the same matched contact as the one about to be
// created/edited, and at least one overlapping product option.
// excludeProjectId leaves room for an eventual edit-mode check (not
// currently wired up — the edit form doesn't re-run this — but the
// signature already supports it rather than needing another one
// later). Scans every project regardless of archived state or stage.
export async function findDuplicateProjects(input: {
  matchedContactId: string;
  productOptions: string[];
  excludeProjectId?: string;
}): Promise<DuplicateProjectMatch[]> {
  if (!input.matchedContactId || input.productOptions.length === 0) return [];

  try {
    const supabase = await createClient();
    let candidateQuery = supabase
      .from("projects")
      .select("id, name, stage, status, archived_at")
      .eq("matched_contact_id", input.matchedContactId);
    if (input.excludeProjectId) {
      candidateQuery = candidateQuery.neq("id", input.excludeProjectId);
    }

    const { data: candidateRows, error } = await candidateQuery;
    if (error) {
      console.error("[findDuplicateProjects] query failed:", error.message);
      return [];
    }

    const candidates =
      (candidateRows as
        | { id: string; name: string; stage: ProjectStage; status: ProjectStatus | null; archived_at: string | null }[]
        | null) ?? [];
    if (candidates.length === 0) return [];

    const { data: optionRows, error: optionsError } = await supabase
      .from("project_products")
      .select("project_id, product")
      .in(
        "project_id",
        candidates.map((c) => c.id)
      )
      .in("product", input.productOptions);
    if (optionsError) {
      console.error("[findDuplicateProjects] options query failed:", optionsError.message);
      return [];
    }

    const matchingIds = new Set(
      ((optionRows as { project_id: string; product: string }[] | null) ?? []).map((r) => r.project_id)
    );
    const matches = candidates.filter((c) => matchingIds.has(c.id));
    if (matches.length === 0) return [];

    return matches.map((row) => {
      // row.status already holds the status's own display name directly
      // (supabase/migrations/019_statuses.sql) — no lookup needed, unlike
      // row.stage, which is still a fixed enum.
      const stageLabel = row.status ?? STAGE_LABELS[row.stage];
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

// ----------------------------------------------------------------------------
// Matched contact & final product — both can trigger the ratio
// auto-fill (snapshot, not live: once filled, or reported as
// differing, nothing here keeps watching for future changes), but only
// once a final product actually exists. Before that, there's nothing
// to look a single ratio up for — components/projects/project-product-
// options.tsx instead shows the matched contact's ratio per option as
// plain information, with no action that writes anything.
// ----------------------------------------------------------------------------

export interface RatioAutoFillResult {
  filled: boolean;
  differs: boolean;
  // True when the matched contact has no ratio of the applicable type
  // (recovery or normal, per isRecovery) on record for this product —
  // nothing to fill or compare, just a hint for the caller to show.
  missing: boolean;
  contactName: string;
  // The final product this ratio is for.
  productType: string;
  // Which ratio column was being read — recovery_ratio vs ratio — so
  // the caller can phrase "no ratio set" vs "no recovery ratio set".
  isRecovery: boolean;
  // The matched contact's ratio on record for this product. Set when
  // filled or differs; absent when missing.
  theirRatio?: string;
  // Only set when differs is true — the project's own ratio_real at the
  // moment of the check, so the caller can offer "Use <theirRatio>" /
  // "Keep <currentRatio>" without a second round trip.
  currentRatio?: string;
}

async function autoFillRatio(
  supabase: SupabaseServerClient,
  projectId: string,
  matchedContactId: string,
  finalProduct: string,
  currentRatioReal: string | null,
  isRecovery: boolean
): Promise<RatioAutoFillResult | null> {
  const { ratio, contactName } = await getContactProductRatio(matchedContactId, finalProduct, isRecovery);
  if (!contactName) return null;

  if (!ratio) {
    return { filled: false, differs: false, missing: true, contactName, productType: finalProduct, isRecovery };
  }

  if (!currentRatioReal) {
    await supabase.from("projects").update({ ratio_real: ratio }).eq("id", projectId);
    return { filled: true, differs: false, missing: false, contactName, productType: finalProduct, isRecovery, theirRatio: ratio };
  }
  if (currentRatioReal !== ratio) {
    // Never overwritten without an explicit "Use <theirRatio>" click
    // from the caller (see updateProjectRatioReal below) — this only
    // reports the difference.
    return {
      filled: false,
      differs: true,
      missing: false,
      contactName,
      productType: finalProduct,
      isRecovery,
      theirRatio: ratio,
      currentRatio: currentRatioReal,
    };
  }
  return null;
}

// The detail page's inline quick-picker for matched_contact_id — saves
// immediately (same pattern as StageSelect/StatusSelect) and, if the
// project already has a final product, runs the ratio auto-fill
// against it. The create/edit form has its own client-side version of
// the same check, since there the project may not be saved yet.
export async function updateProjectMatchedContact(
  projectId: string,
  matchedContactId: string | null
): Promise<{ error: string | null; autoFill: RatioAutoFillResult | null }> {
  try {
    const supabase = await createClient();

    const { data: current, error: readError } = await supabase
      .from("projects")
      .select("final_product, ratio_real, is_recovery")
      .eq("id", projectId)
      .maybeSingle();
    if (readError || !current) {
      return { error: readError?.message ?? "Project not found.", autoFill: null };
    }

    const { error } = await supabase
      .from("projects")
      .update({ matched_contact_id: matchedContactId })
      .eq("id", projectId);
    if (error) {
      return { error: error.message, autoFill: null };
    }

    const autoFill =
      matchedContactId && current.final_product
        ? await autoFillRatio(
            supabase,
            projectId,
            matchedContactId,
            current.final_product,
            current.ratio_real,
            current.is_recovery
          )
        : null;

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { error: null, autoFill };
  } catch (err) {
    return { error: unexpectedErrorMessage(err), autoFill: null };
  }
}

// The detail page's Recovery checkbox (components/projects/recovery-
// toggle.tsx) — saves immediately and, if the project already has both
// a final product and a matched contact, re-runs the ratio auto-fill
// against whichever ratio column the new is_recovery value now points
// at (recovery_ratio vs ratio). Same "snapshot, not live" rules as
// every other auto-fill trigger here.
export async function updateProjectIsRecovery(
  projectId: string,
  isRecovery: boolean
): Promise<{ error: string | null; autoFill: RatioAutoFillResult | null }> {
  try {
    const supabase = await createClient();

    const { data: current, error: readError } = await supabase
      .from("projects")
      .select("final_product, matched_contact_id, ratio_real")
      .eq("id", projectId)
      .maybeSingle();
    if (readError || !current) {
      return { error: readError?.message ?? "Project not found.", autoFill: null };
    }

    const { error } = await supabase.from("projects").update({ is_recovery: isRecovery }).eq("id", projectId);
    if (error) {
      return { error: error.message, autoFill: null };
    }

    const autoFill =
      current.final_product && current.matched_contact_id
        ? await autoFillRatio(
            supabase,
            projectId,
            current.matched_contact_id,
            current.final_product,
            current.ratio_real,
            isRecovery
          )
        : null;

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { error: null, autoFill };
  } catch (err) {
    return { error: unexpectedErrorMessage(err), autoFill: null };
  }
}

// The detail page's inline Contact Person quick-editor (components/
// contact-person-select.tsx) — a plain optional link, no ratio
// auto-fill side effect (unlike matched_contact_id).
export async function updateProjectContactPerson(
  projectId: string,
  personId: string | null
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update({ contact_person_id: personId }).eq("id", projectId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// The explicit "Use <theirRatio>" action from the ratio-differs prompt
// (both the detail page's MatchedContactSelect/ProjectProductOptions
// and, on save, the create/edit form go through this same path for the
// DB-persisted case) — the only way ratio_real is ever overwritten once
// it already holds a different value than the matched contact's.
export async function updateProjectRatioReal(projectId: string, ratio: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update({ ratio_real: ratio }).eq("id", projectId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Final product — "Choose as final" / "Make final instead" (product is
// one of the project's own options) and "Undo choice" (product is
// null). The DB's validate_final_product trigger double-checks that
// `product`, when given, is really one of this project's options, but
// this also checks it itself first so a bad call gets a plain error
// message instead of a raw Postgres exception.
// ----------------------------------------------------------------------------

export async function setProjectFinalProduct(
  projectId: string,
  product: string | null
): Promise<{ error: string | null; autoFill: RatioAutoFillResult | null }> {
  try {
    const supabase = await createClient();

    if (product) {
      const { data: option } = await supabase
        .from("project_products")
        .select("id")
        .eq("project_id", projectId)
        .eq("product", product)
        .maybeSingle();
      if (!option) {
        return { error: "That product is not one of this project's options.", autoFill: null };
      }
    }

    const { data: current, error: readError } = await supabase
      .from("projects")
      .select("matched_contact_id, ratio_real, is_recovery")
      .eq("id", projectId)
      .maybeSingle();
    if (readError || !current) {
      return { error: readError?.message ?? "Project not found.", autoFill: null };
    }

    const { error } = await supabase.from("projects").update({ final_product: product }).eq("id", projectId);
    if (error) {
      return { error: error.message, autoFill: null };
    }

    // Undoing (product === null) never auto-fills — there's no final
    // product left to look a ratio up for.
    const autoFill =
      product && current.matched_contact_id
        ? await autoFillRatio(
            supabase,
            projectId,
            current.matched_contact_id,
            product,
            current.ratio_real,
            current.is_recovery
          )
        : null;

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { error: null, autoFill };
  } catch (err) {
    return { error: unexpectedErrorMessage(err), autoFill: null };
  }
}
