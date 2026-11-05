import type { ProductType } from "@/lib/types";

// Fixed set of banking products ARK tracks. Unlike the old free-text
// field, this is a closed list — adding a new product is a code change,
// not something a user types in. Kept in sync by hand with the
// product_type enum in supabase/migrations/001_ark_schema.sql (and its
// later additions in 005_add_products.sql and 008_add_gpi.sql).
export const PRODUCT_TYPES: ProductType[] = [
  "SBLC",
  "MX103",
  "MT103",
  "IP-IP",
  "API",
  "API Cash",
  "T2T",
  "S2S",
  "VISA",
  "GPI",
];
