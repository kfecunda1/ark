import Link from "next/link";
import { Suspense } from "react";
import { Plus, User } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { PersonFilters } from "@/components/people/person-filters";
import { SortableHeader, MobileSortControl, type SortOption } from "@/components/sort-controls";
import { createClient } from "@/lib/supabase/server";
import { compareNullsLast, parseSortDirection } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

const PERSON_SORT_KEYS = ["name", "created_at"] as const;
type PersonSortKey = (typeof PERSON_SORT_KEYS)[number];

function isPersonSortKey(value: string | undefined): value is PersonSortKey {
  return (PERSON_SORT_KEYS as readonly string[]).includes(value ?? "");
}

const SORT_OPTIONS: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "created_at", label: "Created" },
];

interface PeoplePageProps {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const params = await searchParams;
  const sort: PersonSortKey = isPersonSortKey(params.sort) ? params.sort : "name";
  const dir = parseSortDirection(params.dir);

  const supabase = await createClient();
  const { data, error } = await supabase.from("people").select("*");
  let people = (data as Person[] | null) ?? [];

  const searchTerm = params.q?.trim().toLowerCase();
  if (searchTerm) {
    people = people.filter((person) =>
      [person.first_name, person.last_name, person.phone, person.email]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(searchTerm))
    );
  }

  function sortValue(person: Person, key: PersonSortKey): number | string | null {
    switch (key) {
      case "name":
        return personLabel(person).toLowerCase();
      case "created_at":
        return person.created_at;
    }
  }

  people = [...people].sort((a, b) => compareNullsLast(a, b, (p) => sortValue(p, sort), dir));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Contacts</h1>
          <p className="mt-1 text-sm text-white/45">People you can link to Receivers and Projects.</p>
        </div>
        <Link
          href="/people/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          New Contact
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Suspense>
          <PersonFilters />
          <MobileSortControl options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load contacts: {error.message}
        </GlassCard>
      )}

      {!error && people.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <User className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">{searchTerm ? "No matching contacts" : "No contacts yet"}</p>
          <p className="max-w-xs text-xs text-white/35">
            {searchTerm
              ? "No contacts match your search."
              : "Contacts you create here can be linked to Receivers and Projects."}
          </p>
        </GlassCard>
      )}

      {!error && people.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <SortableHeader sortKey="name" label="Name" currentSort={sort} currentDir={dir} />
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <SortableHeader
                    sortKey="created_at"
                    label="Created"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <ClickableRow
                    key={person.id}
                    href={`/people/${person.id}`}
                    className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-white/85 group-hover:text-white">{personLabel(person)}</span>
                    </td>
                    <td className="px-4 py-3 text-white/70">{person.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-white/70">{person.email ?? "—"}</td>
                    <td className="px-4 py-3 text-white/50">{formatDateTime(person.created_at)}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {people.map((person) => (
              <ClickableCard key={person.id} href={`/people/${person.id}`}>
                <span className="font-medium text-white/85">{personLabel(person)}</span>
                <p className="mt-1.5 text-xs text-white/35">
                  {[person.phone, person.email].filter(Boolean).join(" · ") || "No phone or email on record"}
                </p>
              </ClickableCard>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
