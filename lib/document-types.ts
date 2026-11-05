import { createClient } from "@/lib/supabase/server";
import type { DocumentTypeRecord } from "@/lib/types";

// Same shape and the same reasoning as lib/products.ts: document types
// are admin-managed data (supabase/migrations/011_settings_tables.sql's
// `document_types` table, Settings → Document Types) rather than a
// fixed list. Server-only; client components receive the result as a
// prop.
export async function getAllDocumentTypes(): Promise<DocumentTypeRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_types").select("*").order("sort_order");
  if (error) {
    console.error("[getAllDocumentTypes] query failed:", error.message);
  }
  return (data as DocumentTypeRecord[] | null) ?? [];
}

export async function getActiveDocumentTypes(): Promise<DocumentTypeRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_types")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) {
    console.error("[getActiveDocumentTypes] query failed:", error.message);
  }
  return (data as DocumentTypeRecord[] | null) ?? [];
}
