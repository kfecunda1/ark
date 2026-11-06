import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/people";
import type { IntermediaryChainEntry } from "@/components/projects/intermediary-chain-editor";
import type { Person } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type PersonOption = Pick<Person, "id" | "first_name" | "last_name" | "archived_at">;

// Re-exported under this file's own name so pages don't need to reach
// into a client component's module just for its type — same shape as
// components/projects/intermediary-chain-editor.tsx's
// IntermediaryChainEntry (a type-only import, erased at build time).
export type ChainEntry = IntermediaryChainEntry;

export interface PickerOption {
  id: string;
  label: string;
}

async function fetchPeopleByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<Map<string, PersonOption>> {
  const byId = new Map<string, PersonOption>();
  if (ids.length === 0) return byId;
  const { data } = await supabase.from("people").select("id, first_name, last_name, archived_at").in("id", ids);
  for (const p of (data as PersonOption[] | null) ?? []) byId.set(p.id, p);
  return byId;
}

function toChainEntry(rowId: string, personId: string, person: PersonOption | undefined): ChainEntry {
  return {
    key: rowId,
    personId,
    label: person ? personLabel(person) : "Unknown contact",
    archived: Boolean(person?.archived_at),
  };
}

// Every project's intermediary chain at once, ordered by position —
// same "one query, grouped by parent" shape as lib/project-products.
// ts's getProjectProductsByProjectIds. Includes archived people (an
// existing chain keeps showing them, marked "Archived" — see AGENTS.md)
// — callers that build an *add* picker must filter archived out
// themselves (buildIntermediaryPickerOptions below does).
export async function getProjectIntermediaryChains(projectIds: string[]): Promise<Map<string, ChainEntry[]>> {
  const byProject = new Map<string, ChainEntry[]>();
  if (projectIds.length === 0) return byProject;

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_intermediaries")
    .select("id, project_id, person_id, position")
    .in("project_id", projectIds)
    .order("position");

  const rows = (data as { id: string; project_id: string; person_id: string; position: number }[] | null) ?? [];
  const peopleById = await fetchPeopleByIds(supabase, [...new Set(rows.map((r) => r.person_id))]);

  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(toChainEntry(row.id, row.person_id, peopleById.get(row.person_id)));
    byProject.set(row.project_id, list);
  }
  return byProject;
}

// The detail/edit pages select just their own project's chain instead
// of the whole-list batch above.
export async function getProjectIntermediaryChain(projectId: string): Promise<ChainEntry[]> {
  const byProject = await getProjectIntermediaryChains([projectId]);
  return byProject.get(projectId) ?? [];
}

export interface ReceiverIntermediaryRow {
  id: string;
  personId: string;
  label: string;
  archived: boolean;
  // How many of *this receiver's* own projects (matched_contact_id =
  // this receiver) this person appears in as an intermediary.
  projectCount: number;
}

// A receiver's own intermediaries — an unordered set, each with its
// per-receiver project count (components/receivers/receiver-
// intermediaries-section.tsx).
export async function getReceiverIntermediaries(receiverId: string): Promise<ReceiverIntermediaryRow[]> {
  const supabase = await createClient();

  const [{ data: linksData }, { data: projectsData }] = await Promise.all([
    supabase.from("receiver_intermediaries").select("id, person_id").eq("receiver_id", receiverId),
    supabase.from("projects").select("id").eq("matched_contact_id", receiverId),
  ]);

  const links = (linksData as { id: string; person_id: string }[] | null) ?? [];
  const receiverProjectIds = ((projectsData as { id: string }[] | null) ?? []).map((p) => p.id);

  const peopleById = await fetchPeopleByIds(
    supabase,
    links.map((l) => l.person_id)
  );

  const countByPerson = new Map<string, number>();
  if (receiverProjectIds.length > 0 && links.length > 0) {
    const { data: piData } = await supabase
      .from("project_intermediaries")
      .select("person_id")
      .in("project_id", receiverProjectIds)
      .in(
        "person_id",
        links.map((l) => l.person_id)
      );
    for (const row of (piData as { person_id: string }[] | null) ?? []) {
      countByPerson.set(row.person_id, (countByPerson.get(row.person_id) ?? 0) + 1);
    }
  }

  return links.map((link) => {
    const person = peopleById.get(link.person_id);
    return {
      id: link.id,
      personId: link.person_id,
      label: person ? personLabel(person) : "Unknown contact",
      archived: Boolean(person?.archived_at),
      projectCount: countByPerson.get(link.person_id) ?? 0,
    };
  });
}

// The "add intermediary" picker's option order: the matched receiver's
// own intermediaries first (already vetted for this receiver), then
// every other active contact. `people` is expected already filtered to
// active-only by the caller (same convention as every other picker) —
// archived contacts never appear in a picker, even if they're already
// in the chain being edited (see AGENTS.md).
export function buildIntermediaryPickerOptions(
  people: PersonOption[],
  receiverIntermediaryPersonIds: Set<string>
): PickerOption[] {
  const first = people.filter((p) => receiverIntermediaryPersonIds.has(p.id));
  const rest = people.filter((p) => !receiverIntermediaryPersonIds.has(p.id));
  return [...first, ...rest].map((p) => ({ id: p.id, label: personLabel(p) }));
}

// Reconciles a project's intermediary chain with what the create/edit
// form submitted (an ordered list of person ids) — called from
// createProjectWithId/updateProject in lib/actions/projects.ts, same
// "diff existing vs. submitted" shape as that file's own
// syncProjectProducts. Lives here, not in lib/actions/intermediaries.ts,
// specifically because it takes a live Supabase client: every export of
// a "use server" file becomes a Server Action, which Next.js requires
// to take only serializable arguments.
//
// Renumbering is done in two passes rather than assigning each
// surviving row its final position directly: a straight reassignment
// can ask row A to take the position row B currently still holds,
// before B has been moved off it — which a plain UNIQUE (project_id,
// position) constraint refuses. Moving every surviving row to a
// distinct negative temp slot first means no positive position is
// ever occupied by two rows at once, in either pass.
export async function syncProjectIntermediaries(
  supabase: SupabaseServerClient,
  projectId: string,
  matchedContactId: string | null,
  orderedPersonIds: string[]
): Promise<{ error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("project_intermediaries")
    .select("id, person_id")
    .eq("project_id", projectId);
  if (existingError) {
    return { error: existingError.message };
  }

  const existingRows = (existing as { id: string; person_id: string }[] | null) ?? [];
  const existingByPerson = new Map(existingRows.map((r) => [r.person_id, r.id]));
  const submittedSet = new Set(orderedPersonIds);

  const toDelete = existingRows.filter((r) => !submittedSet.has(r.person_id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("project_intermediaries")
      .delete()
      .in(
        "id",
        toDelete.map((r) => r.id)
      );
    if (error) return { error: error.message };
  }

  const surviving = orderedPersonIds.filter((personId) => existingByPerson.has(personId));

  for (let i = 0; i < surviving.length; i++) {
    const id = existingByPerson.get(surviving[i])!;
    const { error } = await supabase.from("project_intermediaries").update({ position: -(i + 1) }).eq("id", id);
    if (error) return { error: error.message };
  }

  for (let i = 0; i < orderedPersonIds.length; i++) {
    const id = existingByPerson.get(orderedPersonIds[i]);
    if (!id) continue; // brand-new — inserted below instead
    const { error } = await supabase.from("project_intermediaries").update({ position: i + 1 }).eq("id", id);
    if (error) return { error: error.message };
  }

  const toInsert = orderedPersonIds
    .map((personId, i) => ({ personId, position: i + 1 }))
    .filter(({ personId }) => !existingByPerson.has(personId));

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("project_intermediaries")
      .insert(toInsert.map(({ personId, position }) => ({ project_id: projectId, person_id: personId, position })));
    if (error) return { error: error.message };

    if (matchedContactId) {
      const { error: receiverError } = await supabase
        .from("receiver_intermediaries")
        .upsert(
          toInsert.map(({ personId }) => ({ receiver_id: matchedContactId, person_id: personId })),
          { onConflict: "receiver_id,person_id", ignoreDuplicates: true }
        );
      if (receiverError) return { error: receiverError.message };
    }
  }

  return { error: null };
}
