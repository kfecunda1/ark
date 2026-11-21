import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

// Document checklist per product (supabase/migrations/030_document_
// checklists.sql) — shared by Settings' admin grid, the Project page's
// own checklist panel, the Projects list's "Docs" column/filter, and
// the morning briefing's "N projects missing documents" line. Takes a
// Supabase client rather than constructing its own, same reasoning as
// lib/morning-briefing.ts: the caller (a page's own session client, or
// the service-role client in a background job) decides which one.

export interface ChecklistStatus {
  // The project's own product option names actually used to build
  // requiredTypes — its final product alone once decided, otherwise
  // every one of its options.
  applicableProducts: string[];
  // True once a final product exists; false while requiredTypes is the
  // union across every option (components/projects/document-checklist-
  // panel.tsx's "Based on options: X, Y" label).
  basedOnOptions: boolean;
  requiredTypes: string[];
  missingTypes: string[];
  // False when product_required_documents has no rows at all for any
  // of applicableProducts — "No checklist set for <product>", not "0 of
  // 0 complete".
  hasChecklist: boolean;
  isComplete: boolean;
}

// Every (product, document_type) pair currently marked required,
// grouped by product — Settings' grid reads/writes this table
// directly (lib/actions/checklists.ts); every other caller here only
// ever reads it.
export async function getRequiredDocumentsByProduct(supabase: SupabaseClient): Promise<Map<string, string[]>> {
  const { data } = await supabase.from("product_required_documents").select("product, document_type");
  const byProduct = new Map<string, string[]>();
  for (const row of (data as { product: string; document_type: string }[] | null) ?? []) {
    byProduct.set(row.product, [...(byProduct.get(row.product) ?? []), row.document_type]);
  }
  return byProduct;
}

// Pure — every caller already has finalProduct/productOptions (a
// project's own columns) and documentTypesPresent (distinct document_
// type values among that project's own project_documents rows,
// regardless of tranche — "in General or any tranche" is automatic
// since this never looks at tranche_id at all) on hand from whatever
// they already fetched for their own page.
export function computeChecklistStatus(
  finalProduct: string | null,
  productOptions: string[],
  requiredByProduct: Map<string, string[]>,
  documentTypesPresent: Set<string>
): ChecklistStatus {
  const applicableProducts = finalProduct ? [finalProduct] : productOptions;
  const requiredSet = new Set<string>();
  for (const product of applicableProducts) {
    for (const type of requiredByProduct.get(product) ?? []) requiredSet.add(type);
  }
  const requiredTypes = [...requiredSet];
  const missingTypes = requiredTypes.filter((t) => !documentTypesPresent.has(t));

  return {
    applicableProducts,
    basedOnOptions: !finalProduct,
    requiredTypes,
    missingTypes,
    hasChecklist: requiredTypes.length > 0,
    isComplete: requiredTypes.length > 0 && missingTypes.length === 0,
  };
}

// Best-effort side effect called after anything that could make a
// project's checklist newly complete (an upload, an inbox filing — it
// already funnels through addProjectDocument — or a rename; see lib/
// actions/projects.ts). Never throws: a bug here must never fail the
// upload/filing/rename action that already succeeded, so every error
// is swallowed and just logged. Only ever moves New → Documents
// Received, and only when the checklist is actually complete; the DB
// function it calls (advance_project_stage_for_checklist) re-guards
// stage = 'new' itself, so this is safe to call speculatively any
// number of times.
export async function maybeAutoAdvanceStage(supabase: SupabaseClient, projectId: string): Promise<void> {
  try {
    const { data: settingsRow } = await supabase.from("app_settings").select("auto_advance_on_documents").maybeSingle();
    if (!(settingsRow as { auto_advance_on_documents: boolean } | null)?.auto_advance_on_documents) return;

    const { data: projectRow } = await supabase
      .from("projects")
      .select("stage, final_product")
      .eq("id", projectId)
      .maybeSingle();
    const project = projectRow as { stage: string; final_product: string | null } | null;
    if (!project || project.stage !== "new") return;

    const [{ data: optionsData }, requiredByProduct, { data: docsData }] = await Promise.all([
      supabase.from("project_products").select("product").eq("project_id", projectId),
      getRequiredDocumentsByProduct(supabase),
      supabase.from("project_documents").select("document_type").eq("project_id", projectId),
    ]);

    const productOptions = ((optionsData as { product: string }[] | null) ?? []).map((r) => r.product);
    const documentTypesPresent = new Set(
      ((docsData as { document_type: string }[] | null) ?? []).map((d) => d.document_type)
    );

    const status = computeChecklistStatus(project.final_product, productOptions, requiredByProduct, documentTypesPresent);
    if (!status.isComplete) return;

    const { error } = await supabase.rpc("advance_project_stage_for_checklist", { p_project_id: projectId });
    if (error) {
      console.error("[maybeAutoAdvanceStage] rpc failed:", error.message);
      return;
    }

    revalidatePath("/projects");
    revalidatePath("/dashboard");
  } catch (err) {
    console.error("[maybeAutoAdvanceStage] unexpected error:", err instanceof Error ? err.message : "unknown error");
  }
}
