"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";

export interface EntityOption {
  id: string;
  label: string;
}

interface EntityPickerProps {
  name: string;
  label: string;
  options: EntityOption[];
  defaultId?: string | null;
  placeholder?: string;
  // Lowercase singular noun for this picker's rows — "receiver",
  // "contact" — used to build "No matching <noun>s." / "New <noun>
  // <name>" without hardcoding either entity's wording here.
  entityNoun: string;
  // Fires whenever the selection changes — picking an option, clearing
  // one, or quick-creating a new one. Not fired for the initial value
  // from defaultId.
  onSelect?: (option: EntityOption | null) => void;
  // Omit to disable the inline "+ New <noun>" row entirely (not every
  // picker wants quick-create).
  onQuickCreate?: (name: string) => Promise<{ option: EntityOption | null; error: string | null }>;
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
  onSelect,
  onQuickCreate,
}: EntityPickerProps) {
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
    const pool = q ? allOptions.filter((o) => o.label.toLowerCase().includes(q)) : allOptions;
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
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await onQuickCreate(newName.trim());
        if (result.error || !result.option) {
          setError(result.error ?? `Could not create ${entityNoun}.`);
          return;
        }
        const created = result.option;
        setAllOptions((prev) => [...prev, created]);
        selectOption(created);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={placeholder ?? `Search ${entityNoun}s…`}
            className={`${fieldClass} pr-9 pl-9`}
          />
          {selected && (
            <button
              type="button"
              onClick={clearSelection}
              aria-label={`Clear ${entityNoun}`}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {open && !selected && (
            <ul className="absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-white/35">No matching {entityNoun}s.</li>
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
                  {option.label}
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
                  New {entityNoun}
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
            placeholder="Name *"
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
              {isPending ? "Creating…" : "Create & Select"}
            </button>
            <button
              type="button"
              onClick={cancelCreating}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
