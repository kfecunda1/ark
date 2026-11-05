import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/types";

// Products are now admin-managed data (supabase/migrations/011_settings_
// tables.sql's `products` table, Settings → Products) rather than a
// fixed list — these are server-only fetch helpers; client components
// receive the result as a prop from whichever server page renders them.
//
// Always ordered by sort_order, so "keep the existing order on first
// load" (every seeded row's sort_order matches the old hard-coded
// list's order) holds everywhere without each caller re-sorting.
export async function getAllProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("*").order("sort_order");
  if (error) {
    console.error("[getAllProducts] query failed:", error.message);
  }
  return (data as Product[] | null) ?? [];
}

export async function getActiveProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("*").eq("active", true).order("sort_order");
  if (error) {
    console.error("[getActiveProducts] query failed:", error.message);
  }
  return (data as Product[] | null) ?? [];
}
