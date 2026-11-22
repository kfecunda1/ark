"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";

export interface EntityOption {
  id: string;
  label: string;
  // The full name, when `label` is a nickname that differs from it —
  // shown as a smaller second line in the open dropdown and as the
  // input's own title attribute (supabase/migrations/033_nicknames.sql).
  // Omitted (or equal to label) for anything with no nickname in play,
  // and always omitted for People, which have no nicknames at all.
  sublabel?: string;
}

interface EntityPickerProps {
  name: string;
  label: string;
  options: EntityOption[];
  defaultId?: string | null;
  placeholder?: string;
  // Lowercase singular noun for this picker's rows — "receiver",
  // "contact" (already translated by the caller when lang is "es") —
  // used to build "New <noun>" without hardcoding either entity's
  // wording here.
  entityNoun: string;
  // Plural form of entityNoun — used to build "Search <plural>…" / "No
  // matching <plural>." Defaults to entityNoun + "s" (English's usual
  // case), but a Spanish caller must pass its own plural explicitly
  // (concatenation doesn't produce correct Spanish).
  entityNounPlural?: string;
  onSelect?: (option: EntityOption | null) => void;
  // Omit to disable the inline "+ New <noun>" row entirely (not every
  // picker wants quick-create).
  onQuickCreate?: (name: string) => Promise<{ option: EntityOption | null; error: string | null }>;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const smallFieldClass =
  "w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

// A form-mode search-select with inline quick-create — selection only
// takes effect on form submit (a hidden `name` input), unlike the
// per-entity inline quick-editors (StatusSelect, MatchedContactSelect,
// ContactPersonSelect, …) that save immediately. Used by any form that
// needs to pick one row from a flat list: the project form's "Matched
// With" (Receivers) and "Contact person" (People) fields, the
// Receiver form's own "Contact person" field.
export function EntityPicker({
  name,
  label,
  options,
  defaultId,
  placeholder,
  entityNoun,
  entityNounPlural,
  onSelect,
  onQuickCreate,
  lang = "en",
}: EntityPickerProps) {
  const t = getDictionary(lang);
  const plural = entityNounPlural ?? `${entityNoun}s`;
  const [allOptions, setAllOptions] = useState(options);
  const [selected, setSelected] = useState<EntityOption | null>(
    () => allOptions.find((o) => o.id === defaultId) ?? null
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? allOptions.filter(
          (o) => o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false)
        )
      : allOptions;
    return pool.slice(0, 20);
  }, [allOptions, query]);

  function selectOption(option: EntityOption) {
    setSelected(option);
    setQuery("");
    setOpen(false);
    onSelect?.(option);
  }

  function clearSelection() {
    setSelected(null);
    setQuery("");
    onSelect?.(null);
  }

  function startCreating() {
    setError(null);
    setNewName(query.trim());
    setCreating(true);
    setOpen(false);
  }

  function cancelCreating() {
    setCreating(false);
    setError(null);
  }

  function handleCreate() {
    if (!onQuickCreate) return;
    if (!newName.trim()) {
      setError(t.common.nameRequired);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await onQuickCreate(newName.trim());
        if (result.error || !result.option) {
          setError(result.error ?? t.common.couldNotCreate(entityNoun));
          return;
        }
        const created = result.option;
        setAllOptions((prev) => [...prev, created]);
        selectOption(created);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />

      {!creating && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={selected ? selected.label : query}
            title={selected?.sublabel}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={placeholder ?? t.common.searchPlaceholderFor(plural)}
            className={`${fieldClass} pr-9 pl-9`}
          />
          {selected && (
            <button
              type="button"
              onClick={clearSelection}
              aria-label={t.common.clearEntity(entityNoun)}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {open && !selected && (
            <ul className="absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-white/35">{t.common.noMatchingFor(plural)}</li>
              )}
              {filtered.map((option) => (
                <li
                  key={option.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(option);
                  }}
                  className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                >
                  <span className="block truncate">{option.label}</span>
                  {option.sublabel && option.sublabel !== option.label && (
                    <span className="block truncate text-xs text-white/35">{option.sublabel}</span>
                  )}
                </li>
              ))}
              {onQuickCreate && (
                <li
                  onMouseDown={(e) => {
                    e.preventDefault();
                    startCreating();
                  }}
                  className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-2 text-sm font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t.common.newEntity(entityNoun)}
                  {query.trim() ? ` "${query.trim()}"` : ""}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {creating && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <input
            autoFocus
            placeholder={t.common.namePlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={smallFieldClass}
          />
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={handleCreate}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? t.common.creating : t.common.createAndSelect}
            </button>
            <button
              type="button"
              onClick={cancelCreating}
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
