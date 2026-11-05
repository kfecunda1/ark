import { createClient } from "@/lib/supabase/server";
import type { ProjectProduct } from "@/lib/types";

// Fetches every project_products row for a set of projects in one
// query and groups them by project_id, already ordered by sort_order —
// used wherever a page needs every project's option list at once
// (the Projects list, the Dashboard) rather than one project at a time
// (the detail page just selects its own).
export async function getProjectProductsByProjectIds(
  projectIds: string[]
): Promise<Map<string, ProjectProduct[]>> {
  const byProject = new Map<string, ProjectProduct[]>();
  if (projectIds.length === 0) return byProject;

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_products")
    .select("*")
    .in("project_id", projectIds)
    .order("sort_order");

  for (const row of (data as ProjectProduct[] | null) ?? []) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(row);
    byProject.set(row.project_id, list);
  }
  return byProject;
}

// The products a project should be counted under, for a filter or a
// breakdown chart: once a final product is chosen, only that one
// counts (so a 3-option project doesn't inflate three buckets forever);
// before that, every option still counts, since none has been ruled
// out yet.
export function countedProducts(finalProduct: string | null, options: ProjectProduct[]): string[] {
  return finalProduct ? [finalProduct] : options.map((o) => o.product);
}

// What to show in a single-value "Product" column: the final product
// once chosen, otherwise the first (lowest sort_order) option — never
// null for a project with at least one option, which every project
// always has.
export function displayProduct(finalProduct: string | null, options: ProjectProduct[]): string | null {
  return finalProduct ?? options[0]?.product ?? null;
}
