"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";

export interface ParticipantEntry {
  key: string;
  personId: string;
  label: string;
}

export interface ParticipantOption {
  id: string;
  label: string;
}

interface ParticipantsPickerProps {
  entries: ParticipantEntry[];
  options: ParticipantOption[];
  onAdd: (option: ParticipantOption) => void;
  onRemove: (personId: string) => void;
  onQuickCreate?: (name: string) => Promise<{ option: ParticipantOption | null; error: string | null }>;
  // Submits each entry as a repeated hidden field, same as components/
  // projects/intermediary-chain-editor.tsx's own submitAsHiddenFields —
  // always true here, since this component only ever runs inside a
  // form (unlike that one, which also has a "live, persisted
  // immediately" usage on the detail page).
  disabled?: boolean;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// An unordered multi-select of `people` — "participants" on a meeting
// (supabase/migrations/035_meeting_notes.sql's note_participants).
// Same add/remove/quick-create shape as components/projects/
// intermediary-chain-editor.tsx, minus the up/down reordering (a
// meeting's attendee list has no order) and the terminal "receiver"
// chip (nothing for this list to point at).
export function ParticipantsPicker({
  entries,
  options,
  onAdd,
  onRemove,
  onQuickCreate,
  disabled,
  lang = "en",
}: ParticipantsPickerProps) {
  const t = getDictionary(lang);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usedIds = new Set(entries.map((e) => e.personId));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = options.filter((o) => !usedIds.has(o.id));
    return (q ? pool.filter((o) => o.label.toLowerCase().includes(q)) : pool).slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usedIds is derived from entries each render, not a stable dep
  }, [options, query, entries]);

  function selectOption(option: ParticipantOption) {
    onAdd(option);
    setQuery("");
    setOpen(false);
  }

  function startCreating() {
    setCreateError(null);
    setNewName(query.trim());
    setCreating(true);
    setOpen(false);
  }

  function handleCreate() {
    if (!onQuickCreate) return;
    if (!newName.trim()) {
      setCreateError(t.common.nameRequired);
      return;
    }
    setCreateError(null);
    startTransition(async () => {
      try {
        const result = await onQuickCreate(newName.trim());
        if (result.error || !result.option) {
          setCreateError(result.error ?? t.common.couldNotCreate(lang === "es" ? "contacto" : "contact"));
          return;
        }
        selectOption(result.option);
        setCreating(false);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <input key={entry.key} type="hidden" name="participant_person_ids" value={entry.personId} />
      ))}

      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entries.map((entry) => (
            <span
              key={entry.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm text-white/80"
            >
              {entry.label}
              <button
                type="button"
                onClick={() => onRemove(entry.personId)}
                disabled={disabled}
                aria-label={t.meetingForm.removeParticipant(entry.label)}
                className="text-white/30 transition-colors duration-150 ease-out hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {!creating ? (
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            disabled={disabled}
            placeholder={t.meetingForm.addParticipantPlaceholder}
            className={`${fieldClass} py-2 pr-3 pl-9 text-sm disabled:opacity-50`}
          />
          {open && (
            <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">{t.common.noMatchingContacts}</li>}
              {filtered.map((option) => (
                <li
                  key={option.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(option);
                  }}
                  className="cursor-pointer px-3 py-1.5 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                >
                  {option.label}
                </li>
              ))}
              {onQuickCreate && (
                <li
                  onMouseDown={(e) => {
                    e.preventDefault();
                    startCreating();
                  }}
                  className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-1.5 text-sm font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t.common.newContact}
                  {query.trim() ? ` "${query.trim()}"` : ""}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5 sm:w-72">
          <input
            autoFocus
            placeholder={t.common.namePlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
          />
          {createError && <p className="mt-2 text-xs text-rose-300">{createError}</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={handleCreate}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? t.common.creating : t.meetingForm.createAndAddParticipant}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setCreateError(null);
              }}
              disabled={isPending}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
