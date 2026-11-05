"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { setContactPerson, type ContactPersonEntityType } from "@/lib/actions/contact-person";
import { quickCreatePerson } from "@/lib/actions/people";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

type PersonOption = Pick<Person, "id" | "first_name" | "last_name" | "archived_at">;

interface ContactPersonSelectProps {
  entityType: ContactPersonEntityType;
  entityId: string;
  people: PersonOption[];
  currentPerson: PersonOption | null;
}

// The detail page's inline "Contact person" quick-editor — shared by
// the Receiver detail page and the Project detail page, since linking
// an optional person is identical behavior for both. Includes the same
// inline "+ New contact" quick-create as components/entity-picker.tsx's
// form-mode picker, just saving immediately instead of waiting for a
// form submit.
//
// Calls the setContactPerson server action itself (entityType/entityId
// are plain data, not a function) — a Server Component page must never
// pass this component a closure over updateContactPerson/
// updateProjectContactPerson, since a plain function isn't serializable
// across the server/client boundary. See lib/actions/contact-person.ts.
export function ContactPersonSelect({ entityType, entityId, people, currentPerson }: ContactPersonSelectProps) {
  const router = useRouter();
  const [allPeople, setAllPeople] = useState(people);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? allPeople.filter((p) => personLabel(p).toLowerCase().includes(q)) : allPeople;
    return pool.slice(0, 20);
  }, [allPeople, query]);

  function apply(personId: string | null) {
    setError(null);
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      try {
        const result = await setContactPerson(entityType, entityId, personId);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function startCreating() {
    setError(null);
    setNewName(query.trim());
    setCreating(true);
    setOpen(false);
  }

  function handleCreate() {
    if (!newName.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await quickCreatePerson({ name: newName.trim() });
        if (result.error || !result.person) {
          setError(result.error ?? "Could not create contact.");
          return;
        }
        const created = result.person;
        setAllPeople((prev) => [...prev, created]);
        setCreating(false);
        setQuery("");
        const saveResult = await setContactPerson(entityType, entityId, created.id);
        if (saveResult.error) {
          setError(saveResult.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!creating && (
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={
              currentPerson && !open
                ? personLabel(currentPerson) + (currentPerson.archived_at ? " (Archived)" : "")
                : query
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            disabled={isPending}
            placeholder="Contact person…"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pr-7 pl-7 text-xs font-medium text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
          />
          {currentPerson && !open && (
            <button
              type="button"
              onClick={() => apply(null)}
              disabled={isPending}
              aria-label="Clear contact person"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {open && (
            <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">No matching contacts.</li>}
              {filtered.map((person) => (
                <li
                  key={person.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    apply(person.id);
                  }}
                  className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                >
                  {personLabel(person)}
                </li>
              ))}
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  startCreating();
                }}
                className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-1.5 text-xs font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
              >
                <UserPlus className="h-3 w-3" />
                New contact{query.trim() ? ` "${query.trim()}"` : ""}
              </li>
            </ul>
          )}
        </div>
      )}

      {creating && (
        <div className="w-56 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
          <input
            autoFocus
            placeholder="Name *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={handleCreate}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create & Select"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              disabled={isPending}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
