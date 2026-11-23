import { createClient } from "@/lib/supabase/server";
import type { OpportunityProduct } from "@/lib/types";

// Fetches every opportunity_products row for a set of opportunities in
// one query and groups them by opportunity_id, ordered by sort_order —
// same "one query, grouped by parent" shape as lib/project-products.ts's
// getProjectProductsByProjectIds.
export async function getOpportunityProductsByOpportunityIds(
  opportunityIds: string[]
): Promise<Map<string, OpportunityProduct[]>> {
  const byOpportunity = new Map<string, OpportunityProduct[]>();
  if (opportunityIds.length === 0) return byOpportunity;

  const supabase = await createClient();
  const { data } = await supabase
    .from("opportunity_products")
    .select("*")
    .in("opportunity_id", opportunityIds)
    .order("sort_order");

  for (const row of (data as OpportunityProduct[] | null) ?? []) {
    const list = byOpportunity.get(row.opportunity_id) ?? [];
    list.push(row);
    byOpportunity.set(row.opportunity_id, list);
  }
  return byOpportunity;
}

// What to show in a single-value "Products" column — every option,
// joined; "—" for the (legal) zero-option case.
export function displayOpportunityProducts(options: OpportunityProduct[]): string {
  return options.length > 0 ? options.map((o) => o.product).join(" / ") : "—";
}
