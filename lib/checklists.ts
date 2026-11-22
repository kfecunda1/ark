import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogLabel, type Lang } from "@/lib/i18n";

// Document checklist per product (supabase/migrations/030_document_
// checklists.sql, extended by 032_checklist_groups.sql's either/or
// requirement groups) — shared by Settings' admin grid, the Project
// page's own checklist panel, the Projects list's "Docs" column/
// filter, and the morning briefing's "N projects missing documents"
// line. Takes a Supabase client rather than constructing its own, same
// reasoning as lib/morning-briefing.ts: the caller (a page's own
// session client, or the service-role client in a background job)
// decides which one.

// A requirement is EITHER one plain document_type OR a whole
// document_type_groups row (never both — see the migration's check
// constraint) — satisfied by having *any one* of the group's member
// types present, not all of them.
export interface RequirementGroupInfo {
  id: string;
  name: string;
  nameEs: string | null;
  // Ordered the same way every time (by document_types.sort_order, via
  // getChecklistCatalog below) so "one of A / B" always reads the same
  // way regardless of which member happened to satisfy it.
  memberTypes: string[];
}

export type Requirement = { kind: "type"; documentType: string } | { kind: "group"; group: RequirementGroupInfo };

export interface RequirementStatus {
  requirement: Requirement;
  satisfied: boolean;
  // The specific document_type that satisfies this requirement, once
  // satisfied — for a "type" requirement, always its own documentType;
  // for a "group" requirement, whichever one member type was actually
  // found present (there may be more than one, but only the first
  // match, in memberTypes order, is reported). Null while unsatisfied.
  satisfiedByType: string | null;
}

export interface ChecklistStatus {
  // The project's own product option names actually used to build
  // requirements — its final product alone once decided, otherwise
  // every one of its options.
  applicableProducts: string[];
  // True once a final product exists; false while requirements is the
  // union across every option (components/projects/document-checklist-
  // panel.tsx's "Based on options: X, Y" label).
  basedOnOptions: boolean;
  requirements: RequirementStatus[];
  // False when product_required_documents has no rows at all for any
  // of applicableProducts — "No checklist set for <product>", not "0 of
  // 0 complete".
  hasChecklist: boolean;
  isComplete: boolean;
  // A group requirement always counts as exactly one requirement here,
  // regardless of how many member types it has — "3/4" means 3 of 4
  // *requirements*, not 3 of 4 document types.
  completeCount: number;
  totalCount: number;
}

export interface ChecklistCatalog {
  requirementsByProduct: Map<string, Requirement[]>;
}

// Every requirement row currently set, grouped by product, with every
// group requirement already resolved to its member types — Settings'
// grid reads/writes product_required_documents and document_type_
// group_members directly (lib/actions/checklists.ts, lib/actions/
// document-type-groups.ts); every other caller here only ever reads
// this.
export async function getChecklistCatalog(supabase: SupabaseClient): Promise<ChecklistCatalog> {
  const [{ data: reqRows }, { data: groupRows }, { data: memberRows }, { data: typeRows }] = await Promise.all([
    supabase.from("product_required_documents").select("product, document_type, group_id"),
    supabase.from("document_type_groups").select("id, name, name_es"),
    supabase.from("document_type_group_members").select("group_id, document_type"),
    supabase.from("document_types").select("name, sort_order").order("sort_order"),
  ]);

  // Member types in a stable, catalog-sort_order-based order, not
  // insertion order — so "one of A / B" always reads the same way.
  const typeSortIndex = new Map(
    ((typeRows as { name: string; sort_order: number }[] | null) ?? []).map((t, i) => [t.name, i])
  );
  const membersByGroup = new Map<string, string[]>();
  for (const row of (memberRows as { group_id: string; document_type: string }[] | null) ?? []) {
    membersByGroup.set(row.group_id, [...(membersByGroup.get(row.group_id) ?? []), row.document_type]);
  }
  for (const [groupId, members] of membersByGroup) {
    membersByGroup.set(
      groupId,
      [...members].sort((a, b) => (typeSortIndex.get(a) ?? 0) - (typeSortIndex.get(b) ?? 0))
    );
  }

  const groupsById = new Map<string, RequirementGroupInfo>();
  for (const row of (groupRows as { id: string; name: string; name_es: string | null }[] | null) ?? []) {
    groupsById.set(row.id, { id: row.id, name: row.name, nameEs: row.name_es, memberTypes: membersByGroup.get(row.id) ?? [] });
  }

  const requirementsByProduct = new Map<string, Requirement[]>();
  for (const row of (reqRows as { product: string; document_type: string | null; group_id: string | null }[] | null) ??
    []) {
    const requirement: Requirement | null = row.group_id
      ? groupsById.has(row.group_id)
        ? { kind: "group", group: groupsById.get(row.group_id)! }
        : null // the group itself was deleted at the DB level (never happens through the app — groups are hide-only) — skip rather than crash
      : row.document_type
        ? { kind: "type", documentType: row.document_type }
        : null;
    if (!requirement) continue;
    requirementsByProduct.set(row.product, [...(requirementsByProduct.get(row.product) ?? []), requirement]);
  }

  return { requirementsByProduct };
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
  catalog: ChecklistCatalog,
  documentTypesPresent: Set<string>
): ChecklistStatus {
  const applicableProducts = finalProduct ? [finalProduct] : productOptions;

  const seenTypes = new Set<string>();
  const seenGroups = new Set<string>();
  const requirements: RequirementStatus[] = [];

  for (const product of applicableProducts) {
    for (const requirement of catalog.requirementsByProduct.get(product) ?? []) {
      if (requirement.kind === "type") {
        if (seenTypes.has(requirement.documentType)) continue;
        seenTypes.add(requirement.documentType);
        const satisfied = documentTypesPresent.has(requirement.documentType);
        requirements.push({ requirement, satisfied, satisfiedByType: satisfied ? requirement.documentType : null });
      } else {
        if (seenGroups.has(requirement.group.id)) continue;
        seenGroups.add(requirement.group.id);
        const satisfiedByType = requirement.group.memberTypes.find((type) => documentTypesPresent.has(type)) ?? null;
        requirements.push({ requirement, satisfied: satisfiedByType !== null, satisfiedByType });
      }
    }
  }

  const completeCount = requirements.filter((r) => r.satisfied).length;

  return {
    applicableProducts,
    basedOnOptions: !finalProduct,
    requirements,
    hasChecklist: requirements.length > 0,
    isComplete: requirements.length > 0 && completeCount === requirements.length,
    completeCount,
    totalCount: requirements.length,
  };
}

// Plain display names for every still-unsatisfied requirement — a
// group shows its own (name_es-aware) name, not its member types, same
// "the group is the one thing, not its members" treatment as the
// completed-count above. Used for the Projects list's "Missing: …"
// tooltip, which has no room for the full "one of A / B" phrasing the
// Project page's own checklist panel uses for the same case.
export function missingRequirementLabels(status: ChecklistStatus, lang: Lang): string[] {
  return status.requirements
    .filter((r) => !r.satisfied)
    .map((r) =>
      r.requirement.kind === "type"
        ? r.requirement.documentType
        : catalogLabel({ name: r.requirement.group.name, name_es: r.requirement.group.nameEs }, lang)
    );
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

    const [{ data: optionsData }, catalog, { data: docsData }] = await Promise.all([
      supabase.from("project_products").select("product").eq("project_id", projectId),
      getChecklistCatalog(supabase),
      supabase.from("project_documents").select("document_type").eq("project_id", projectId),
    ]);

    const productOptions = ((optionsData as { product: string }[] | null) ?? []).map((r) => r.product);
    const documentTypesPresent = new Set(
      ((docsData as { document_type: string }[] | null) ?? []).map((d) => d.document_type)
    );

    const status = computeChecklistStatus(project.final_product, productOptions, catalog, documentTypesPresent);
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
