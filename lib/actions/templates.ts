"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";

export interface TemplateFormState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

interface TemplatePayload {
  name: string;
  description: string | null;
  document_type: string | null;
}

function buildTemplatePayload(formData: FormData): TemplatePayload {
  const name = formData.get("name")?.toString().trim();
  if (!name) {
    throw new Error("nameRequired");
  }
  return {
    name,
    description: formData.get("description")?.toString().trim() || null,
    document_type: formData.get("document_type")?.toString().trim() || null,
  };
}

function parseTemplateProducts(formData: FormData): string[] {
  return [...new Set(formData.getAll("products").map((v) => v.toString().trim()).filter(Boolean))];
}

async function syncTemplateProducts(
  supabase: SupabaseServerClient,
  templateId: string,
  products: string[]
): Promise<{ error: string | null }> {
  if (products.length > 0) {
    const { error } = await supabase
      .from("template_products")
      .insert(products.map((product) => ({ template_id: templateId, product })));
    if (error) return { error: error.message };
  }
  return { error: null };
}

// Returns the new template's id instead of redirecting, same reason as
// lib/actions/opportunities.ts's createOpportunityWithId: the caller
// (components/templates/template-form.tsx) still needs to upload the
// template's first version file, which needs the template's own id
// first. A template with no version at all is a dead end in the UI (no
// Download button to show) — if that upload fails, the form rolls the
// template back out via deleteTemplate rather than leaving a fileless
// row behind.
export async function createTemplateWithId(formData: FormData): Promise<{ id: string | null; error: string | null }> {
  if (!(await isCurrentUserAdmin())) {
    return { id: null, error: "onlyAdminsCanManageTemplates" };
  }

  let payload: TemplatePayload;
  let products: string[];
  try {
    payload = buildTemplatePayload(formData);
    products = parseTemplateProducts(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("templates")
      .insert({ ...payload, created_by: user?.id ?? null })
      .select("id")
      .single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "failedToCreateTemplate" };
    }

    const templateId = data.id;

    const productsResult = await syncTemplateProducts(supabase, templateId, products);
    if (productsResult.error) {
      await supabase.from("templates").delete().eq("id", templateId);
      return { id: null, error: productsResult.error };
    }

    revalidatePath("/templates");
    return { id: templateId, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

// Edit mode — name/description/document_type and the product tag list.
// Never touches versions (see addTemplateVersion below) — "Upload new
// version" is its own separate action, not part of this form.
export async function updateTemplate(
  id: string,
  _prevState: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  if (!(await isCurrentUserAdmin())) {
    return { error: "onlyAdminsCanManageTemplates" };
  }

  let payload: TemplatePayload;
  let products: string[];
  try {
    payload = buildTemplatePayload(formData);
    products = parseTemplateProducts(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "invalidFormData" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("templates").update(payload).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("template_products")
      .select("id, product")
      .eq("template_id", id);
    if (existingError) {
      return { error: existingError.message };
    }

    const existing = (existingRows as { id: string; product: string }[] | null) ?? [];
    const existingByProduct = new Map(existing.map((r) => [r.product, r.id]));
    const submittedSet = new Set(products);

    const toInsert = products.filter((p) => !existingByProduct.has(p));
    const toDelete = existing.filter((r) => !submittedSet.has(r.product));

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("template_products")
        .insert(toInsert.map((product) => ({ template_id: id, product })));
      if (insertError) return { error: insertError.message };
    }
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("template_products")
        .delete()
        .in("id", toDelete.map((r) => r.id));
      if (deleteError) return { error: deleteError.message };
    }
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/templates");
  return { error: null };
}

export async function setTemplateActive(id: string, active: boolean): Promise<{ error: string | null }> {
  if (!(await isCurrentUserAdmin())) {
    return { error: "onlyAdminsCanManageTemplates" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("templates").update({ active }).eq("id", id);
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/templates");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Removes the template row (cascading to template_products/
// template_versions) and every one of its versions' files from the
// "templates" bucket — same "fetch paths, delete row, then best-effort
// clean up storage" order as lib/actions/opportunities.ts's
// deleteOpportunity.
export async function deleteTemplate(id: string): Promise<{ error: string | null }> {
  if (!(await isCurrentUserAdmin())) {
    return { error: "onlyAdminsCanManageTemplates" };
  }

  try {
    const supabase = await createClient();

    const { data: versions } = await supabase.from("template_versions").select("file_path").eq("template_id", id);
    const filePaths = ((versions as { file_path: string }[] | null) ?? []).map((v) => v.file_path);

    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) {
      return { error: error.message };
    }

    if (filePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from("templates").remove(filePaths);
      if (storageError) {
        console.error("[deleteTemplate] failed to remove storage files:", storageError.message);
      }
    }

    revalidatePath("/templates");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Adds one version row — used both for a brand new template's first
// version (components/templates/template-form.tsx, create mode, right
// after createTemplateWithId) and for "Upload new version" on an
// existing one. version_number is always current-max + 1; a race
// between two admins uploading at the same instant would collide on
// template_versions' own unique (template_id, version_number) index
// and surface as a plain error rather than corrupting anything — an
// acceptable risk for a two-admin tool.
export async function addTemplateVersion(
  templateId: string,
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  fileHash: string | null,
  notes: string | null
): Promise<{ error: string | null }> {
  if (!(await isCurrentUserAdmin())) {
    return { error: "onlyAdminsCanManageTemplates" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: maxRow } = await supabase
      .from("template_versions")
      .select("version_number")
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((maxRow as { version_number: number } | null)?.version_number ?? 0) + 1;

    const { error } = await supabase.from("template_versions").insert({
      template_id: templateId,
      version_number: nextVersion,
      file_path: filePath,
      file_name: fileName,
      mime_type: mimeType,
      file_size: fileSize,
      file_hash: fileHash,
      notes: notes?.trim() || null,
      uploaded_by: user?.id ?? null,
    });
    if (error) {
      return { error: error.message };
    }

    revalidatePath("/templates");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
