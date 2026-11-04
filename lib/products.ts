import type { ProductType } from "@/lib/types";

// Fixed set of banking products ARK tracks. Unlike the old free-text
// field, this is a closed list — adding an 8th product is a code change,
// not something a user types in. Kept in sync by hand with the
// product_type enum in supabase/migrations/001_ark_schema.sql.
export const PRODUCT_TYPES: ProductType[] = ["SBLC", "MX103", "MT103", "IP-IP", "API", "T2T", "S2S"];
