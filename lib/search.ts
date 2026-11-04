import { createClient } from "@/lib/supabase/client";

export type SearchResultType = "project" | "contact" | "document";

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
  name: string;
  product_type: string;
}

async function fetchProjectsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ProjectFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("projects").select("id, name, product_type").in("id", ids);
  return (data as ProjectFields[] | null) ?? [];
}

export async function runGlobalSearch(rawQuery: string): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const supabase = createClient();
  const likePattern = `%${escapeLike(query)}%`;
  const orSafePattern = `%${escapeLike(sanitizeForOrFilter(query))}%`;

  const [contactsRes, projectDocsRes] = await Promise.all([
    supabase.from("contacts").select("id, full_name").ilike("full_name", likePattern).limit(RESULT_LIMIT),
    supabase
      .from("project_documents")
      .select("id, file_name, project_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
  ]);

  const contactMatches = (contactsRes.data as { id: string; full_name: string }[] | null) ?? [];
  const projectDocMatches =
    (projectDocsRes.data as { id: string; file_name: string; project_id: string }[] | null) ?? [];
  const contactIds = contactMatches.map((c) => c.id);

  const projectFilters = [`name.ilike.${orSafePattern}`, `product_type.ilike.${orSafePattern}`];
  if (contactIds.length > 0) {
    projectFilters.push(`client_contact_id.in.(${contactIds.join(",")})`);
    projectFilters.push(`assigned_contact_id.in.(${contactIds.join(",")})`);
  }

  // Parent lookup for the Documents group: a matched document's project
  // may not itself match the text search above (only its filename did),
  // so its display fields need their own fetch.
  const [{ data: projectRows }, docParentProjects] = await Promise.all([
    supabase.from("projects").select("id, name, product_type").or(projectFilters.join(",")).limit(RESULT_LIMIT),
    fetchProjectsByIds(supabase, [...new Set(projectDocMatches.map((d) => d.project_id))]),
  ]);

  const projectMatches = (projectRows as ProjectFields[] | null) ?? [];

  const projectResults: SearchResult[] = projectMatches.map((project) => ({
    type: "project",
    id: project.id,
    title: project.name,
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

  const documentResults: SearchResult[] = projectDocMatches.map((doc) => {
    const project = projectById.get(doc.project_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: `Project: ${project?.name ?? "Unknown project"}`,
      parentId: doc.project_id,
    };
  });

  return [...projectResults, ...contactResults, ...documentResults];
}

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case "project":
      return `/projects/${result.id}`;
    case "contact":
      return `/contacts/${result.id}`;
    case "document":
      return `/projects/${result.parentId}`;
  }
}
