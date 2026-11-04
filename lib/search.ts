import { createClient } from "@/lib/supabase/client";

export type SearchResultType = "lead" | "contact" | "document";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  // document results only: which project to navigate to, since a
  // document has no page of its own.
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

interface ProjectFields {
  id: string;
  product_type: string;
  primary_contact_id: string | null;
}

function projectDisplayName(project: ProjectFields, contactNameById: Map<string, string>): string {
  return (project.primary_contact_id && contactNameById.get(project.primary_contact_id)) || project.product_type;
}

async function fetchProjectsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ProjectFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("leads").select("id, product_type, primary_contact_id").in("id", ids);
  return (data as ProjectFields[] | null) ?? [];
}

export async function runGlobalSearch(rawQuery: string): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const supabase = createClient();
  const likePattern = `%${escapeLike(query)}%`;
  const orSafePattern = `%${escapeLike(sanitizeForOrFilter(query))}%`;

  const [contactsRes, leadDocsRes] = await Promise.all([
    supabase.from("contacts").select("id, full_name").ilike("full_name", likePattern).limit(RESULT_LIMIT),
    supabase
      .from("lead_documents")
      .select("id, file_name, lead_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
  ]);

  const contactMatches = (contactsRes.data as { id: string; full_name: string }[] | null) ?? [];
  const leadDocMatches = (leadDocsRes.data as { id: string; file_name: string; lead_id: string }[] | null) ?? [];
  const contactIds = contactMatches.map((c) => c.id);

  const projectFilters = [`product_type.ilike.${orSafePattern}`];
  if (contactIds.length > 0) {
    projectFilters.push(`primary_contact_id.in.(${contactIds.join(",")})`);
    projectFilters.push(`counterparty_contact_id.in.(${contactIds.join(",")})`);
  }

  // Parent lookup for the Documents group: a matched document's project
  // may not itself match the text search above (only its filename did),
  // so its display fields need their own fetch.
  const [{ data: projectRows }, docParentProjects] = await Promise.all([
    supabase
      .from("leads")
      .select("id, product_type, primary_contact_id")
      .or(projectFilters.join(","))
      .limit(RESULT_LIMIT),
    fetchProjectsByIds(supabase, [...new Set(leadDocMatches.map((d) => d.lead_id))]),
  ]);

  const projectMatches = (projectRows as ProjectFields[] | null) ?? [];

  // Project results (both the Projects group and document parents) are
  // titled by their primary contact's name, which may not be one of the
  // contacts already fetched above — fetch whatever's missing.
  const neededContactIds = [...projectMatches, ...docParentProjects]
    .map((p) => p.primary_contact_id)
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

  const projectResults: SearchResult[] = projectMatches.map((project) => ({
    type: "lead",
    id: project.id,
    title: projectDisplayName(project, contactNameById),
    subtitle: project.product_type,
  }));

  const contactResults: SearchResult[] = contactMatches.map((contact) => ({
    type: "contact",
    id: contact.id,
    title: contact.full_name,
    subtitle: "Contact",
  }));

  const projectById = new Map(
    [...projectMatches, ...docParentProjects].map((p): [string, ProjectFields] => [p.id, p])
  );

  const leadDocumentResults: SearchResult[] = leadDocMatches.map((doc) => {
    const project = projectById.get(doc.lead_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: `Project: ${project ? projectDisplayName(project, contactNameById) : "Unknown project"}`,
      parentId: doc.lead_id,
    };
  });

  return [...projectResults, ...contactResults, ...leadDocumentResults];
}

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case "lead":
      return `/projects/${result.id}`;
    case "contact":
      return `/contacts/${result.id}`;
    case "document":
      return `/projects/${result.parentId}`;
  }
}
