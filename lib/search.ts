import { createClient } from "@/lib/supabase/client";
import { BUSINESS_LINES, BUSINESS_LINE_LABELS } from "@/lib/leads";
import { truncate } from "@/lib/procedures";
import type { BusinessLine } from "@/lib/types";

export type SearchResultType = "lead" | "procedure" | "contact" | "document";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  // document results only: which lead/procedure to navigate to, since a
  // document has no page of its own.
  parentType?: "lead" | "procedure";
  parentId?: string;
}

const RESULT_LIMIT = 5;

type SupabaseBrowserClient = ReturnType<typeof createClient>;

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// PostgREST's `.or()` mini-language splits on "," and uses "()" for value
// lists — strip those out of a typed query before it goes into a combined
// `.or()` filter string, so they can't break filter parsing. Not needed for
// a standalone `.ilike()` call, which isn't parsed as that mini-language.
function sanitizeForOrFilter(text: string): string {
  return text.replace(/[,()]/g, " ");
}

interface LeadFields {
  id: string;
  business_line: BusinessLine;
  product_type: string;
  primary_contact_id: string | null;
}

interface ProcedureFields {
  id: string;
  title: string | null;
  raw_content: string;
}

function leadDisplayName(lead: LeadFields, contactNameById: Map<string, string>): string {
  return (lead.primary_contact_id && contactNameById.get(lead.primary_contact_id)) || lead.product_type;
}

function procedureDisplayName(procedure: ProcedureFields): string {
  return procedure.title || truncate(procedure.raw_content, 60);
}

async function fetchLeadsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<LeadFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("leads")
    .select("id, business_line, product_type, primary_contact_id")
    .in("id", ids);
  return (data as LeadFields[] | null) ?? [];
}

async function fetchProceduresByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ProcedureFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("procedures").select("id, title, raw_content").in("id", ids);
  return (data as ProcedureFields[] | null) ?? [];
}

export async function runGlobalSearch(rawQuery: string): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const supabase = createClient();
  const likePattern = `%${escapeLike(query)}%`;
  const orSafePattern = `%${escapeLike(sanitizeForOrFilter(query))}%`;

  const matchingBusinessLines = BUSINESS_LINES.filter((line) =>
    BUSINESS_LINE_LABELS[line].toLowerCase().includes(query.toLowerCase())
  );

  const [contactsRes, procedureRes, leadDocsRes, procedureDocsRes] = await Promise.all([
    supabase.from("contacts").select("id, full_name").ilike("full_name", likePattern).limit(RESULT_LIMIT),
    supabase
      .from("procedures")
      .select("id, title, raw_content")
      .or(`title.ilike.${orSafePattern},raw_content.ilike.${orSafePattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from("lead_documents")
      .select("id, file_name, lead_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("procedure_documents")
      .select("id, file_name, procedure_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
  ]);

  const contactMatches = (contactsRes.data as { id: string; full_name: string }[] | null) ?? [];
  const procedureMatches = (procedureRes.data as ProcedureFields[] | null) ?? [];
  const leadDocMatches = (leadDocsRes.data as { id: string; file_name: string; lead_id: string }[] | null) ?? [];
  const procedureDocMatches =
    (procedureDocsRes.data as { id: string; file_name: string; procedure_id: string }[] | null) ?? [];
  const contactIds = contactMatches.map((c) => c.id);

  const leadFilters = [`product_type.ilike.${orSafePattern}`];
  if (matchingBusinessLines.length > 0) {
    leadFilters.push(`business_line.in.(${matchingBusinessLines.join(",")})`);
  }
  if (contactIds.length > 0) {
    leadFilters.push(`primary_contact_id.in.(${contactIds.join(",")})`);
    leadFilters.push(`counterparty_contact_id.in.(${contactIds.join(",")})`);
  }

  // Parent lookups for the Documents group: a matched document's lead or
  // procedure may not itself match the text search above (only its
  // filename did), so its display fields need their own fetch.
  const [{ data: leadRows }, docParentLeads, docParentProcedures] = await Promise.all([
    supabase
      .from("leads")
      .select("id, business_line, product_type, primary_contact_id")
      .or(leadFilters.join(","))
      .limit(RESULT_LIMIT),
    fetchLeadsByIds(supabase, [...new Set(leadDocMatches.map((d) => d.lead_id))]),
    fetchProceduresByIds(supabase, [...new Set(procedureDocMatches.map((d) => d.procedure_id))]),
  ]);

  const leadMatches = (leadRows as LeadFields[] | null) ?? [];

  // Lead results (both the Leads group and document parents) are titled by
  // their primary contact's name, which may not be one of the contacts
  // already fetched above — fetch whatever's missing.
  const neededContactIds = [...leadMatches, ...docParentLeads]
    .map((l) => l.primary_contact_id)
    .filter((id): id is string => Boolean(id));
  const missingContactIds = [...new Set(neededContactIds.filter((id) => !contactIds.includes(id)))];

  let extraContacts: { id: string; full_name: string }[] = [];
  if (missingContactIds.length > 0) {
    const { data } = await supabase.from("contacts").select("id, full_name").in("id", missingContactIds);
    extraContacts = (data as { id: string; full_name: string }[] | null) ?? [];
  }

  const contactNameById = new Map([
    ...contactMatches.map((c): [string, string] => [c.id, c.full_name]),
    ...extraContacts.map((c): [string, string] => [c.id, c.full_name]),
  ]);

  const leadResults: SearchResult[] = leadMatches.map((lead) => ({
    type: "lead",
    id: lead.id,
    title: leadDisplayName(lead, contactNameById),
    subtitle: `${lead.product_type} — ${BUSINESS_LINE_LABELS[lead.business_line]}`,
  }));

  const procedureResults: SearchResult[] = procedureMatches.map((procedure) => ({
    type: "procedure",
    id: procedure.id,
    title: procedureDisplayName(procedure),
    subtitle: "Procedure",
  }));

  const contactResults: SearchResult[] = contactMatches.map((contact) => ({
    type: "contact",
    id: contact.id,
    title: contact.full_name,
    subtitle: "Contact",
  }));

  const leadById = new Map([...leadMatches, ...docParentLeads].map((l): [string, LeadFields] => [l.id, l]));
  const procedureById = new Map(
    [...procedureMatches, ...docParentProcedures].map((p): [string, ProcedureFields] => [p.id, p])
  );

  const leadDocumentResults: SearchResult[] = leadDocMatches.map((doc) => {
    const lead = leadById.get(doc.lead_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: `Lead: ${lead ? leadDisplayName(lead, contactNameById) : "Unknown lead"}`,
      parentType: "lead",
      parentId: doc.lead_id,
    };
  });

  const procedureDocumentResults: SearchResult[] = procedureDocMatches.map((doc) => {
    const procedure = procedureById.get(doc.procedure_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: `Procedure: ${procedure ? procedureDisplayName(procedure) : "Unknown procedure"}`,
      parentType: "procedure",
      parentId: doc.procedure_id,
    };
  });

  return [
    ...leadResults,
    ...procedureResults,
    ...contactResults,
    ...leadDocumentResults,
    ...procedureDocumentResults,
  ];
}

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case "lead":
      return `/leads/${result.id}`;
    case "procedure":
      return `/procedures/${result.id}`;
    case "contact":
      return `/contacts/${result.id}`;
    case "document":
      return result.parentType === "lead" ? `/leads/${result.parentId}` : `/procedures/${result.parentId}`;
  }
}
