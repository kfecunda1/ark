import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplateVersion } from "@/lib/types";

// The current version of a template is whichever row has the highest
// version_number — never stored as its own flag (see supabase/
// migrations/036_templates.sql's own header comment).
export function currentTemplateVersion(versions: TemplateVersion[]): TemplateVersion | null {
  return versions.reduce<TemplateVersion | null>(
    (best, v) => (!best || v.version_number > best.version_number ? v : best),
    null
  );
}

// For the Project page's document checklist (components/projects/
// document-checklist-panel.tsx): "for a missing requirement ... that
// has active templates, show a 'Template' link ... filtered to that
// type (and to the project's product if one matches)". Only active,
// type-tagged templates count — a template with no document_type (the
// app's "Other" bucket) can never satisfy a specific requirement's
// link, since there'd be no type to filter by.
export interface TemplateAvailability {
  products: Set<string>;
}

export async function getActiveTemplatesByDocumentType(
  supabase: SupabaseClient
): Promise<Map<string, TemplateAvailability>> {
  const { data: templatesData } = await supabase
    .from("templates")
    .select("id, document_type")
    .eq("active", true)
    .not("document_type", "is", null);

  const templates = (templatesData as { id: string; document_type: string }[] | null) ?? [];
  if (templates.length === 0) return new Map();

  const { data: productsData } = await supabase
    .from("template_products")
    .select("template_id, product")
    .in("template_id", templates.map((t) => t.id));

  const productsByTemplate = new Map<string, string[]>();
  for (const row of (productsData as { template_id: string; product: string }[] | null) ?? []) {
    productsByTemplate.set(row.template_id, [...(productsByTemplate.get(row.template_id) ?? []), row.product]);
  }

  const byType = new Map<string, TemplateAvailability>();
  for (const t of templates) {
    const entry = byType.get(t.document_type) ?? { products: new Set<string>() };
    for (const product of productsByTemplate.get(t.id) ?? []) entry.products.add(product);
    byType.set(t.document_type, entry);
  }
  return byType;
}

// The one matching product to deep-link with, if any of the project's
// applicable products is actually tagged on one of this type's active
// templates — otherwise undefined, so the generated link filters by
// type alone rather than by a product that would just zero out the
// results.
export function matchingTemplateProduct(
  availability: TemplateAvailability | undefined,
  applicableProducts: string[]
): string | undefined {
  if (!availability) return undefined;
  return applicableProducts.find((p) => availability.products.has(p));
}
