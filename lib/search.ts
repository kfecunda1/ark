import { createClient } from "@/lib/supabase/client";
import { personLabel } from "@/lib/people";

// UI: Receivers for "contact", Contacts for "person" — see AGENTS.md's
// UI-naming-vs-database-naming note. The database's `contacts` table
// backs "contact" results; the database's `people` table backs
// "person" results.
export type SearchResultType = "project" | "contact" | "document" | "note" | "person";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  // document results only: which project to navigate to, since a
  // document has no page of its own. note results reuse both fields:
  // a note has no page of its own either, so it navigates to whichever
  // parent it's linked to (or nowhere, if unlinked).
  parentId?: string;
  parentType?: "project" | "contact";
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
  final_product: string | null;
}

async function fetchProjectsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ProjectFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("projects").select("id, name, final_product").in("id", ids);
  return (data as ProjectFields[] | null) ?? [];
}

interface ContactFields {
  id: string;
  full_name: string;
  archived_at?: string | null;
}

async function fetchContactsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ContactFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("contacts").select("id, full_name, archived_at").in("id", ids);
  return (data as ContactFields[] | null) ?? [];
}

export async function runGlobalSearch(rawQuery: string): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const supabase = createClient();
  const likePattern = `%${escapeLike(query)}%`;
  const orSafePattern = `%${escapeLike(sanitizeForOrFilter(query))}%`;

  const [contactsRes, projectDocsRes, notesRes, peopleRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name")
      .is("archived_at", null)
      .ilike("full_name", likePattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("project_documents")
      .select("id, file_name, project_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("notes")
      .select("id, title, content, project_id, contact_id")
      .or(`title.ilike.${orSafePattern},content.ilike.${orSafePattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from("people")
      .select("id, first_name, last_name, phone, email")
      .is("archived_at", null)
      .or(
        [
          `first_name.ilike.${orSafePattern}`,
          `last_name.ilike.${orSafePattern}`,
          `phone.ilike.${orSafePattern}`,
          `email.ilike.${orSafePattern}`,
        ].join(",")
      )
      .limit(RESULT_LIMIT),
  ]);

  const contactMatches = (contactsRes.data as { id: string; full_name: string }[] | null) ?? [];
  const projectDocMatches =
    (projectDocsRes.data as { id: string; file_name: string; project_id: string }[] | null) ?? [];
  const noteMatches =
    (notesRes.data as
      | { id: string; title: string | null; content: string; project_id: string | null; contact_id: string | null }[]
      | null) ?? [];
  const personMatches =
    (peopleRes.data as
      | { id: string; first_name: string; last_name: string | null; phone: string | null; email: string | null }[]
      | null) ?? [];
  const contactIds = contactMatches.map((c) => c.id);
  const personIds = personMatches.map((p) => p.id);

  // A person-name match also surfaces every receiver/project they're an
  // intermediary on (supabase/migrations/018_intermediaries.sql) — same
  // "a name match surfaces what it's linked to" idea as contactIds
  // surfacing matched projects below.
  const [intermediaryProjectIdsRes, intermediaryReceiverIdsRes] = await Promise.all([
    personIds.length > 0
      ? supabase.from("project_intermediaries").select("project_id").in("person_id", personIds)
      : Promise.resolve({ data: [] as { project_id: string }[] }),
    personIds.length > 0
      ? supabase.from("receiver_intermediaries").select("receiver_id").in("person_id", personIds)
      : Promise.resolve({ data: [] as { receiver_id: string }[] }),
  ]);
  const intermediaryProjectIds = [
    ...new Set(((intermediaryProjectIdsRes.data as { project_id: string }[] | null) ?? []).map((r) => r.project_id)),
  ];
  const intermediaryReceiverIds = [
    ...new Set(((intermediaryReceiverIdsRes.data as { receiver_id: string }[] | null) ?? []).map((r) => r.receiver_id)),
  ];

  // "Matched with" is the only contact a project carries now
  // (supabase/migrations/013_projects_restructure.sql dropped
  // client_contact_id/assigned_contact_id), so a contact-name match
  // surfaces the projects matched with them.
  const projectFilters = [`name.ilike.${orSafePattern}`, `final_product.ilike.${orSafePattern}`];
  if (contactIds.length > 0) {
    projectFilters.push(`matched_contact_id.in.(${contactIds.join(",")})`);
  }

  const noteProjectIds = [...new Set(noteMatches.map((n) => n.project_id).filter((id): id is string => Boolean(id)))];
  const noteContactIds = [...new Set(noteMatches.map((n) => n.contact_id).filter((id): id is string => Boolean(id)))];

  // Parent lookup for the Documents and Notes groups: a matched row's
  // project/contact may not itself match the text search above (only
  // its own text did), so its display name needs its own fetch. The
  // same fetch-by-id helpers also pick up this person's intermediary
  // projects/receivers, which never matched the text search on their
  // own name either.
  const [{ data: projectRows }, docParentProjects, noteParentProjects, noteParentContacts, intermediaryProjects, intermediaryReceivers] =
    await Promise.all([
      supabase.from("projects").select("id, name, final_product").or(projectFilters.join(",")).limit(RESULT_LIMIT),
      fetchProjectsByIds(supabase, [...new Set(projectDocMatches.map((d) => d.project_id))]),
      fetchProjectsByIds(supabase, noteProjectIds),
      fetchContactsByIds(supabase, noteContactIds),
      fetchProjectsByIds(supabase, intermediaryProjectIds),
      fetchContactsByIds(supabase, intermediaryReceiverIds),
    ]);

  const textMatchedProjects = (projectRows as ProjectFields[] | null) ?? [];
  const projectMatches = [
    ...textMatchedProjects,
    ...intermediaryProjects.filter((p) => !textMatchedProjects.some((r) => r.id === p.id)),
  ];
  // Same active-only rule as the text-search contactsRes query above —
  // an archived receiver only reachable through this intermediary path
  // shouldn't become a search result either.
  const intermediaryContactMatches = intermediaryReceivers.filter(
    (r) => !r.archived_at && !contactMatches.some((c) => c.id === r.id)
  );

  const projectResults: SearchResult[] = projectMatches.map((project) => ({
    type: "project",
    id: project.id,
    title: project.name,
    subtitle: project.final_product ?? "Product not decided",
  }));

  const contactResults: SearchResult[] = [...contactMatches, ...intermediaryContactMatches].map((contact) => ({
    type: "contact",
    id: contact.id,
    title: contact.full_name,
    subtitle: "Receiver",
  }));

  const personResults: SearchResult[] = personMatches.map((person) => ({
    type: "person",
    id: person.id,
    title: personLabel(person),
    subtitle: "Contact",
  }));

  const projectById = new Map(
    [...projectMatches, ...docParentProjects, ...noteParentProjects].map((p): [string, ProjectFields] => [p.id, p])
  );
  const contactById = new Map(noteParentContacts.map((c): [string, ContactFields] => [c.id, c]));

  const documentResults: SearchResult[] = projectDocMatches.map((doc) => {
    const project = projectById.get(doc.project_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: `Project: ${project?.name ?? "Unknown project"}`,
      parentId: doc.project_id,
      parentType: "project",
    };
  });

  const noteResults: SearchResult[] = noteMatches.map((note) => {
    const title = note.title?.trim() || note.content.slice(0, 60);
    if (note.project_id) {
      const project = projectById.get(note.project_id);
      return {
        type: "note",
        id: note.id,
        title,
        subtitle: `Note on project: ${project?.name ?? "Unknown project"}`,
        parentId: note.project_id,
        parentType: "project",
      };
    }
    if (note.contact_id) {
      const contact = contactById.get(note.contact_id);
      return {
        type: "note",
        id: note.id,
        title,
        subtitle: `Note on receiver: ${contact?.full_name ?? "Unknown receiver"}`,
        parentId: note.contact_id,
        parentType: "contact",
      };
    }
    return { type: "note", id: note.id, title, subtitle: "Note" };
  });

  return [...projectResults, ...contactResults, ...documentResults, ...noteResults, ...personResults];
}

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case "project":
      return `/projects/${result.id}`;
    case "contact":
      return `/receivers/${result.id}`;
    case "document":
      return `/projects/${result.parentId}`;
    case "note":
      if (result.parentType === "project") return `/projects/${result.parentId}`;
      if (result.parentType === "contact") return `/receivers/${result.parentId}`;
      return `/notes/${result.id}/edit`;
    case "person":
      return `/people/${result.id}`;
  }
}
