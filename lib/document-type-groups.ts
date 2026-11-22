import { createClient } from "@/lib/supabase/server";
import type { DocumentTypeGroupRecord } from "@/lib/types";

// Same shape and the same reasoning as lib/document-types.ts: document
// type groups are admin-managed data (supabase/migrations/032_
// checklist_groups.sql's `document_type_groups` table, Settings →
// Document checklists' "Document Groups" area). Server-only; client
// components receive the result as a prop.
export async function getAllDocumentTypeGroups(): Promise<DocumentTypeGroupRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_type_groups").select("*").order("sort_order");
  if (error) {
    console.error("[getAllDocumentTypeGroups] query failed:", error.message);
  }
  return (data as DocumentTypeGroupRecord[] | null) ?? [];
}

export async function getActiveDocumentTypeGroups(): Promise<DocumentTypeGroupRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_type_groups")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) {
    console.error("[getActiveDocumentTypeGroups] query failed:", error.message);
  }
  return (data as DocumentTypeGroupRecord[] | null) ?? [];
}

// Every group's member document_type names, keyed by group id — every
// caller here wants the full map rather than one group at a time
// (Settings' own "Document Groups" area manages every group's members
// at once; lib/checklists.ts resolves every group referenced by a
// requirement in one pass).
export async function getDocumentTypeGroupMembers(): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_type_group_members").select("group_id, document_type");
  if (error) {
    console.error("[getDocumentTypeGroupMembers] query failed:", error.message);
  }
  const byGroup = new Map<string, string[]>();
  for (const row of (data as { group_id: string; document_type: string }[] | null) ?? []) {
    byGroup.set(row.group_id, [...(byGroup.get(row.group_id) ?? []), row.document_type]);
  }
  return byGroup;
}
