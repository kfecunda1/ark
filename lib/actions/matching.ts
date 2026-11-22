"use server";

// Read-only matching helpers behind "Find receivers" (the Matched
// With block on a project's own page) and its reverse, "Projects
// needing this receiver" (a Receiver's own page) — see components/
// projects/find-receivers-panel.tsx and components/receivers/receiver-
// match-projects-section.tsx. Neither of these writes anything; the
// actual "Match" action both panels call is updateProjectMatchedContact
// (lib/actions/projects.ts), unchanged.

import { createClient } from "@/lib/supabase/server";
import { getAllStatuses, isClosedStatus } from "@/lib/statuses";
import { getAppSettings } from "@/lib/app-settings";
import { getProjectProductsByProjectIds, countedProducts } from "@/lib/project-products";
import type { Project } from "@/lib/types";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "somethingWentWrong";
}

// Only a bare percentage ("70" / "70%") sorts numerically — anything
// else (free text like "70/30", which is the more common shape for
// this field, see AGENTS.md) just falls back to sorting by name.
function parseRatioPercent(ratio: string | null): number | null {
  if (!ratio) return null;
  const trimmed = ratio.trim().replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

export interface ReceiverMatchProduct {
  product: string;
  ratio: string | null;
  isFinal: boolean;
}

export interface ReceiverMatch {
  id: string;
  fullName: string;
  notes: string | null;
  matchingProducts: ReceiverMatchProduct[];
  documentTypesOnFile: string[];
  intermediaryCount: number;
  openMatchedProjectCount: number;
}

export interface FindMatchingReceiversResult {
  error: string | null;
  finalProduct: string | null;
  productOptions: string[];
  receivers: ReceiverMatch[];
}

// Every non-archived receiver that offers the project's final product
// (once decided) or any of its product options (before that), with
// enough context per row to judge at a glance — see components/
// projects/find-receivers-panel.tsx for how each field renders.
export async function findMatchingReceivers(projectId: string): Promise<FindMatchingReceiversResult> {
  try {
    const supabase = await createClient();

    const [{ data: projectRow, error: projectError }, { data: optionRows }, appSettings, statuses] = await Promise.all([
      supabase.from("projects").select("final_product, is_recovery").eq("id", projectId).maybeSingle(),
      supabase.from("project_products").select("product").eq("project_id", projectId),
      getAppSettings(),
      getAllStatuses(),
    ]);

    if (projectError || !projectRow) {
      return { error: projectError?.message ?? "projectNotFound", finalProduct: null, productOptions: [], receivers: [] };
    }

    const finalProduct = (projectRow as { final_product: string | null }).final_product;
    const isRecovery = (projectRow as { is_recovery: boolean }).is_recovery;
    const productOptions = ((optionRows as { product: string }[] | null) ?? []).map((r) => r.product);
    const relevantProducts = finalProduct ? [finalProduct] : productOptions;
    // Settings → Defaults' "Show Recovery" switch (024_show_recovery.sql)
    // — off means this list reads the receiver's normal ratio even for
    // a recovery project, same as every other recovery display it gates.
    const showRecoveryRatio = isRecovery && appSettings.show_recovery;

    if (relevantProducts.length === 0) {
      return { error: null, finalProduct, productOptions, receivers: [] };
    }

    const { data: contactProductRows, error: contactProductsError } = await supabase
      .from("contact_products")
      .select("contact_id, product_type, ratio, recovery_ratio")
      .in("product_type", relevantProducts);
    if (contactProductsError) {
      return { error: contactProductsError.message, finalProduct, productOptions, receivers: [] };
    }

    const rows =
      (contactProductRows as
        | { contact_id: string; product_type: string; ratio: string | null; recovery_ratio: string | null }[]
        | null) ?? [];
    const candidateIds = [...new Set(rows.map((r) => r.contact_id))];
    if (candidateIds.length === 0) {
      return { error: null, finalProduct, productOptions, receivers: [] };
    }

    const [{ data: contactsData }, { data: contactDocsData }, { data: intermediariesData }, { data: matchedProjectsData }] =
      await Promise.all([
        supabase.from("contacts").select("id, full_name, notes").in("id", candidateIds).is("archived_at", null),
        supabase.from("contact_documents").select("contact_id, document_type").in("contact_id", candidateIds),
        supabase.from("receiver_intermediaries").select("receiver_id").in("receiver_id", candidateIds),
        supabase.from("projects").select("matched_contact_id, archived_at, status").in("matched_contact_id", candidateIds),
      ]);

    const contactsById = new Map(
      ((contactsData as { id: string; full_name: string; notes: string | null }[] | null) ?? []).map((c) => [c.id, c])
    );

    const docTypesByContact = new Map<string, Set<string>>();
    for (const d of (contactDocsData as { contact_id: string; document_type: string }[] | null) ?? []) {
      const set = docTypesByContact.get(d.contact_id) ?? new Set<string>();
      set.add(d.document_type);
      docTypesByContact.set(d.contact_id, set);
    }

    const intermediaryCountByContact = new Map<string, number>();
    for (const i of (intermediariesData as { receiver_id: string }[] | null) ?? []) {
      intermediaryCountByContact.set(i.receiver_id, (intermediaryCountByContact.get(i.receiver_id) ?? 0) + 1);
    }

    const openMatchedCountByContact = new Map<string, number>();
    for (const p of (matchedProjectsData as
      | { matched_contact_id: string; archived_at: string | null; status: string | null }[]
      | null) ?? []) {
      if (p.archived_at || isClosedStatus(p.status, statuses)) continue;
      openMatchedCountByContact.set(p.matched_contact_id, (openMatchedCountByContact.get(p.matched_contact_id) ?? 0) + 1);
    }

    const productsByContact = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!contactsById.has(r.contact_id)) continue; // archived or otherwise gone
      productsByContact.set(r.contact_id, [...(productsByContact.get(r.contact_id) ?? []), r]);
    }

    const receivers: ReceiverMatch[] = [...productsByContact.entries()].map(([contactId, productRows]) => {
      const contact = contactsById.get(contactId)!;
      const matchingProducts = productRows.map((r) => ({
        product: r.product_type,
        ratio: (showRecoveryRatio ? r.recovery_ratio : r.ratio) ?? null,
        isFinal: finalProduct != null && r.product_type === finalProduct,
      }));
      return {
        id: contactId,
        fullName: contact.full_name,
        notes: contact.notes,
        matchingProducts,
        documentTypesOnFile: [...(docTypesByContact.get(contactId) ?? new Set<string>())].sort(),
        intermediaryCount: intermediaryCountByContact.get(contactId) ?? 0,
        openMatchedProjectCount: openMatchedCountByContact.get(contactId) ?? 0,
      };
    });

    // Offers the final product first; within each tier, lowest
    // parseable ratio first, then alphabetically for everything that
    // has no parseable ratio at all (see parseRatioPercent above).
    receivers.sort((a, b) => {
      const aFinal = a.matchingProducts.some((m) => m.isFinal);
      const bFinal = b.matchingProducts.some((m) => m.isFinal);
      if (aFinal !== bFinal) return aFinal ? -1 : 1;

      const aRatios = a.matchingProducts.map((m) => parseRatioPercent(m.ratio)).filter((n): n is number => n != null);
      const bRatios = b.matchingProducts.map((m) => parseRatioPercent(m.ratio)).filter((n): n is number => n != null);
      const aMin = aRatios.length > 0 ? Math.min(...aRatios) : null;
      const bMin = bRatios.length > 0 ? Math.min(...bRatios) : null;
      if (aMin != null && bMin != null && aMin !== bMin) return aMin - bMin;
      if (aMin != null && bMin == null) return -1;
      if (aMin == null && bMin != null) return 1;
      return a.fullName.localeCompare(b.fullName);
    });

    return { error: null, finalProduct, productOptions, receivers };
  } catch (err) {
    return { error: unexpectedErrorMessage(err), finalProduct: null, productOptions: [], receivers: [] };
  }
}

export interface ProjectNeedingReceiver {
  id: string;
  name: string;
  product: string;
  isRecovery: boolean;
}

export interface FindProjectsNeedingReceiverResult {
  error: string | null;
  projects: ProjectNeedingReceiver[];
}

// The reverse of findMatchingReceivers above: every open, unmatched
// project whose product options (or final product, once decided)
// include a product this receiver offers — see components/receivers/
// receiver-match-projects-section.tsx.
export async function findProjectsNeedingReceiver(contactId: string): Promise<FindProjectsNeedingReceiverResult> {
  try {
    const supabase = await createClient();

    const { data: contactProductsData, error: productsError } = await supabase
      .from("contact_products")
      .select("product_type")
      .eq("contact_id", contactId);
    if (productsError) return { error: productsError.message, projects: [] };

    const offeredProducts = new Set(
      ((contactProductsData as { product_type: string }[] | null) ?? []).map((r) => r.product_type)
    );
    if (offeredProducts.size === 0) return { error: null, projects: [] };

    const [{ data: projectsData, error: projectsError }, statuses, appSettings] = await Promise.all([
      supabase.from("projects").select("*").is("matched_contact_id", null).is("archived_at", null),
      getAllStatuses(),
      getAppSettings(),
    ]);
    if (projectsError) return { error: projectsError.message, projects: [] };

    const candidates = ((projectsData as Project[] | null) ?? [])
      .filter((p) => !isClosedStatus(p.status, statuses))
      // Same "off means recovery projects don't exist for this list"
      // rule the Dashboard applies (024_show_recovery.sql).
      .filter((p) => appSettings.show_recovery || !p.is_recovery);
    if (candidates.length === 0) return { error: null, projects: [] };

    const projectProductsById = await getProjectProductsByProjectIds(candidates.map((p) => p.id));

    const matches: ProjectNeedingReceiver[] = [];
    for (const project of candidates) {
      const counted = countedProducts(project.final_product, projectProductsById.get(project.id) ?? []);
      const matchingProduct = counted.find((p) => offeredProducts.has(p));
      if (matchingProduct) {
        matches.push({ id: project.id, name: project.name, product: matchingProduct, isRecovery: project.is_recovery });
      }
    }

    matches.sort((a, b) => a.name.localeCompare(b.name));
    return { error: null, projects: matches };
  } catch (err) {
    return { error: unexpectedErrorMessage(err), projects: [] };
  }
}
