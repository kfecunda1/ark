import { createClient } from "@/lib/supabase/client";
import { personLabel } from "@/lib/people";
import { projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { formatDateOnly } from "@/lib/projects";
import { getDictionary, type Lang } from "@/lib/i18n";

// UI: Receivers for "contact", Contacts for "person" — see AGENTS.md's
// UI-naming-vs-database-naming note. The database's `contacts` table
// backs "contact" results; the database's `people` table backs
// "person" results.
export type SearchResultType = "project" | "contact" | "opportunity" | "document" | "note" | "person";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  // document results only: which project/opportunity to navigate to,
  // since a document has no page of its own. note results reuse both
  // fields: a note has no page of its own either, so it navigates to
  // whichever parent it's linked to (or nowhere, if unlinked).
  parentId?: string;
  parentType?: "project" | "contact" | "opportunity";
  // note results only — a meeting (supabase/migrations/035_meeting_
  // notes.sql) links to its own detail page (/notes/[id]) regardless
  // of parentType, instead of the generic "link to the parent, or to
  // /notes/[id]/edit if unlinked" rule every other note follows.
  isMeeting?: boolean;
  // project results only — shown as a Recovery badge; the detail page
  // it links to (searchResultHref below) is the same /projects/[id]
  // either way, Projects and Recovery Projects being the same table.
  isRecovery?: boolean;
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
  nickname: string | null;
  final_product: string | null;
  is_recovery: boolean;
}

async function fetchProjectsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ProjectFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("projects").select("id, name, nickname, final_product, is_recovery").in("id", ids);
  return (data as ProjectFields[] | null) ?? [];
}

interface ContactFields {
  id: string;
  full_name: string;
  nickname: string | null;
  archived_at?: string | null;
}

async function fetchContactsByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<ContactFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("contacts").select("id, full_name, nickname, archived_at").in("id", ids);
  return (data as ContactFields[] | null) ?? [];
}

interface OpportunityFields {
  id: string;
  title: string;
}

async function fetchOpportunitiesByIds(supabase: SupabaseBrowserClient, ids: string[]): Promise<OpportunityFields[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("opportunities").select("id, title").in("id", ids);
  return (data as OpportunityFields[] | null) ?? [];
}

export async function runGlobalSearch(rawQuery: string, lang: Lang = "en"): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const t = getDictionary(lang);
  const supabase = createClient();
  const likePattern = `%${escapeLike(query)}%`;
  const orSafePattern = `%${escapeLike(sanitizeForOrFilter(query))}%`;

  const [contactsRes, opportunitiesRes, projectDocsRes, opportunityDocsRes, notesRes, peopleRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, nickname")
      .is("archived_at", null)
      .or(`full_name.ilike.${orSafePattern},nickname.ilike.${orSafePattern}`)
      .limit(RESULT_LIMIT),
    supabase.from("opportunities").select("id, title, status").ilike("title", likePattern).limit(RESULT_LIMIT),
    supabase
      .from("project_documents")
      .select("id, file_name, project_id, document_type, tranche_id")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("opportunity_documents")
      .select("id, file_name, opportunity_id, document_type")
      .ilike("file_name", likePattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("notes")
      .select("id, title, content, project_id, contact_id, opportunity_id, kind, meeting_date")
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

  const contactMatches = (contactsRes.data as { id: string; full_name: string; nickname: string | null }[] | null) ?? [];
  const opportunityMatches = (opportunitiesRes.data as { id: string; title: string; status: string }[] | null) ?? [];
  const projectDocMatches =
    (projectDocsRes.data as
      | { id: string; file_name: string; project_id: string; document_type: string; tranche_id: string | null }[]
      | null) ?? [];
  const opportunityDocMatches =
    (opportunityDocsRes.data as { id: string; file_name: string; opportunity_id: string; document_type: string }[] | null) ?? [];
  type NoteMatch = {
    id: string;
    title: string | null;
    content: string;
    project_id: string | null;
    contact_id: string | null;
    opportunity_id: string | null;
    kind: "note" | "meeting";
    meeting_date: string | null;
  };
  const textMatchedNotes = (notesRes.data as NoteMatch[] | null) ?? [];
  const personMatches =
    (peopleRes.data as
      | { id: string; first_name: string; last_name: string | null; phone: string | null; email: string | null }[]
      | null) ?? [];
  const contactIds = contactMatches.map((c) => c.id);
  const personIds = personMatches.map((p) => p.id);

  // A person-name match also surfaces every receiver/project they're an
  // intermediary on (supabase/migrations/018_intermediaries.sql) — same
  // "a name match surfaces what it's linked to" idea as contactIds
  // surfacing matched projects below — and every meeting they attended
  // (supabase/migrations/035_meeting_notes.sql's note_participants).
  const [intermediaryProjectIdsRes, intermediaryReceiverIdsRes, participantNoteIdsRes] = await Promise.all([
    personIds.length > 0
      ? supabase.from("project_intermediaries").select("project_id").in("person_id", personIds)
      : Promise.resolve({ data: [] as { project_id: string }[] }),
    personIds.length > 0
      ? supabase.from("receiver_intermediaries").select("receiver_id").in("person_id", personIds)
      : Promise.resolve({ data: [] as { receiver_id: string }[] }),
    personIds.length > 0
      ? supabase.from("note_participants").select("note_id").in("person_id", personIds)
      : Promise.resolve({ data: [] as { note_id: string }[] }),
  ]);
  const intermediaryProjectIds = [
    ...new Set(((intermediaryProjectIdsRes.data as { project_id: string }[] | null) ?? []).map((r) => r.project_id)),
  ];
  const intermediaryReceiverIds = [
    ...new Set(((intermediaryReceiverIdsRes.data as { receiver_id: string }[] | null) ?? []).map((r) => r.receiver_id)),
  ];
  const participantNoteIds = [
    ...new Set(((participantNoteIdsRes.data as { note_id: string }[] | null) ?? []).map((r) => r.note_id)),
  ].filter((id) => !textMatchedNotes.some((n) => n.id === id));

  const participantMeetings =
    participantNoteIds.length > 0
      ? ((
          await supabase
            .from("notes")
            .select("id, title, content, project_id, contact_id, opportunity_id, kind, meeting_date")
            .in("id", participantNoteIds)
        ).data as NoteMatch[] | null) ?? []
      : [];
  const noteMatches = [...textMatchedNotes, ...participantMeetings];

  // "Matched with" is the only contact a project carries now
  // (supabase/migrations/013_projects_restructure.sql dropped
  // client_contact_id/assigned_contact_id), so a contact-name match
  // surfaces the projects matched with them.
  const projectFilters = [
    `name.ilike.${orSafePattern}`,
    `nickname.ilike.${orSafePattern}`,
    `final_product.ilike.${orSafePattern}`,
  ];
  if (contactIds.length > 0) {
    projectFilters.push(`matched_contact_id.in.(${contactIds.join(",")})`);
  }

  const noteProjectIds = [...new Set(noteMatches.map((n) => n.project_id).filter((id): id is string => Boolean(id)))];
  const noteContactIds = [...new Set(noteMatches.map((n) => n.contact_id).filter((id): id is string => Boolean(id)))];
  const noteOpportunityIds = [
    ...new Set(noteMatches.map((n) => n.opportunity_id).filter((id): id is string => Boolean(id))),
  ];

  // Parent lookup for the Documents and Notes groups: a matched row's
  // project/contact/opportunity may not itself match the text search
  // above (only its own text did), so its display name needs its own
  // fetch. The same fetch-by-id helpers also pick up this person's
  // intermediary projects/receivers, which never matched the text
  // search on their own name either.
  const docTrancheIds = [...new Set(projectDocMatches.map((d) => d.tranche_id).filter((id): id is string => Boolean(id)))];

  const [
    { data: projectRows },
    docParentProjects,
    noteParentProjects,
    noteParentContacts,
    noteParentOpportunities,
    docParentOpportunities,
    intermediaryProjects,
    intermediaryReceivers,
    docTranchesRes,
  ] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, nickname, final_product, is_recovery")
        .or(projectFilters.join(","))
        .limit(RESULT_LIMIT),
      fetchProjectsByIds(supabase, [...new Set(projectDocMatches.map((d) => d.project_id))]),
      fetchProjectsByIds(supabase, noteProjectIds),
      fetchContactsByIds(supabase, noteContactIds),
      fetchOpportunitiesByIds(supabase, noteOpportunityIds),
      fetchOpportunitiesByIds(supabase, [...new Set(opportunityDocMatches.map((d) => d.opportunity_id))]),
      fetchProjectsByIds(supabase, intermediaryProjectIds),
      fetchContactsByIds(supabase, intermediaryReceiverIds),
      docTrancheIds.length > 0
        ? supabase.from("project_tranches").select("id, tranche_number").in("id", docTrancheIds)
        : Promise.resolve({ data: [] as { id: string; tranche_number: number }[] }),
    ]);

  const trancheNumberById = new Map(
    ((docTranchesRes.data as { id: string; tranche_number: number }[] | null) ?? []).map((t) => [t.id, t.tranche_number])
  );

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
    title: projectDisplayName(project),
    subtitle: project.final_product ?? t.projectSummary.productNotDecided,
    isRecovery: project.is_recovery,
  }));

  const contactResults: SearchResult[] = [...contactMatches, ...intermediaryContactMatches].map((contact) => ({
    type: "contact",
    id: contact.id,
    title: receiverDisplayName(contact),
    subtitle: t.search.receiverLabel,
  }));

  const personResults: SearchResult[] = personMatches.map((person) => ({
    type: "person",
    id: person.id,
    title: personLabel(person),
    subtitle: t.search.contactLabel,
  }));

  const opportunityResults: SearchResult[] = opportunityMatches.map((opportunity) => ({
    type: "opportunity",
    id: opportunity.id,
    title: opportunity.title,
    subtitle: t.opportunities.statusLabels[opportunity.status as "open" | "converted" | "closed"] ?? t.search.opportunityLabel,
  }));

  const projectById = new Map(
    [...projectMatches, ...docParentProjects, ...noteParentProjects].map((p): [string, ProjectFields] => [p.id, p])
  );
  const contactById = new Map(noteParentContacts.map((c): [string, ContactFields] => [c.id, c]));
  const opportunityById = new Map(
    [...opportunityMatches, ...noteParentOpportunities, ...docParentOpportunities].map(
      (o): [string, OpportunityFields] => [o.id, o]
    )
  );

  const documentResults: SearchResult[] = projectDocMatches.map((doc) => {
    const project = projectById.get(doc.project_id);
    const trancheNumber = doc.tranche_id ? trancheNumberById.get(doc.tranche_id) : undefined;
    const trancheLabel = trancheNumber != null ? t.dashboard.trancheNumber(trancheNumber) : t.common.general;
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: t.search.documentSubtitle(
        trancheLabel,
        doc.document_type,
        project ? projectDisplayName(project) : t.payoutRow.unknownProject
      ),
      parentId: doc.project_id,
      parentType: "project",
    };
  });

  const opportunityDocumentResults: SearchResult[] = opportunityDocMatches.map((doc) => {
    const opportunity = opportunityById.get(doc.opportunity_id);
    return {
      type: "document",
      id: doc.id,
      title: doc.file_name,
      subtitle: t.search.opportunityDocumentSubtitle(
        doc.document_type,
        opportunity ? opportunity.title : t.opportunities.opportunityFallback
      ),
      parentId: doc.opportunity_id,
      parentType: "opportunity",
    };
  });

  const noteResults: SearchResult[] = noteMatches.map((note) => {
    const title = note.title?.trim() || note.content.slice(0, 60);
    const isMeeting = note.kind === "meeting";
    const meetingDate = note.meeting_date ? formatDateOnly(note.meeting_date, lang) : null;
    if (note.project_id) {
      const project = projectById.get(note.project_id);
      const projectName = project ? projectDisplayName(project) : t.payoutRow.unknownProject;
      return {
        type: "note",
        id: note.id,
        title,
        subtitle: isMeeting && meetingDate ? t.search.meetingOnProject(meetingDate, projectName) : t.search.noteOnProject(projectName),
        parentId: note.project_id,
        parentType: "project",
        isMeeting,
      };
    }
    if (note.contact_id) {
      const contact = contactById.get(note.contact_id);
      const receiverName = contact ? receiverDisplayName(contact) : t.search.unknownReceiver;
      return {
        type: "note",
        id: note.id,
        title,
        subtitle: isMeeting && meetingDate ? t.search.meetingOnReceiver(meetingDate, receiverName) : t.search.noteOnReceiver(receiverName),
        parentId: note.contact_id,
        parentType: "contact",
        isMeeting,
      };
    }
    if (note.opportunity_id) {
      const opportunity = opportunityById.get(note.opportunity_id);
      const opportunityName = opportunity ? opportunity.title : t.opportunities.opportunityFallback;
      return {
        type: "note",
        id: note.id,
        title,
        subtitle: isMeeting && meetingDate ? t.search.meetingOnOpportunity(meetingDate, opportunityName) : t.search.noteOnOpportunity(opportunityName),
        parentId: note.opportunity_id,
        parentType: "opportunity",
        isMeeting,
      };
    }
    return {
      type: "note",
      id: note.id,
      title,
      subtitle: isMeeting ? (meetingDate ? t.search.meetingLabel(meetingDate) : t.search.meetingNoDate) : t.search.noteLabel,
      isMeeting,
    };
  });

  return [
    ...projectResults,
    ...contactResults,
    ...opportunityResults,
    ...documentResults,
    ...opportunityDocumentResults,
    ...noteResults,
    ...personResults,
  ];
}

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case "project":
      return `/projects/${result.id}`;
    case "contact":
      return `/receivers/${result.id}`;
    case "opportunity":
      return `/opportunities/${result.id}`;
    case "document":
      return result.parentType === "opportunity" ? `/opportunities/${result.parentId}` : `/projects/${result.parentId}`;
    case "note":
      if (result.isMeeting) return `/notes/${result.id}`;
      if (result.parentType === "project") return `/projects/${result.parentId}`;
      if (result.parentType === "contact") return `/receivers/${result.parentId}`;
      if (result.parentType === "opportunity") return `/opportunities/${result.parentId}`;
      return `/notes/${result.id}/edit`;
    case "person":
      return `/people/${result.id}`;
  }
}
