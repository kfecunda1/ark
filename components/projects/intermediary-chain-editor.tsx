"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Search, UserPlus, X } from "lucide-react";

export interface IntermediaryChainEntry {
  // Stable React key — a real project_intermediaries row id in "live"
  // usage (components/projects/project-intermediaries-section.tsx), or
  // just the personId itself for a form's local, not-yet-saved chain.
  key: string;
  personId: string;
  label: string;
  archived?: boolean;
}

export interface IntermediaryPickerOption {
  id: string;
  label: string;
}

interface IntermediaryChainEditorProps {
  entries: IntermediaryChainEntry[];
  // The matched receiver's label, shown as the chain's terminal node —
  // null when no receiver is matched yet.
  receiverLabel: string | null;
  // Already ordered: the matched receiver's own intermediaries first,
  // then every other active contact (lib/intermediaries.ts's
  // buildIntermediaryPickerOptions) — this component filters out
  // whoever's already in `entries` itself, so callers don't each have
  // to.
  pickerOptions: IntermediaryPickerOption[];
  onQuickCreate?: (name: string) => Promise<{ option: IntermediaryPickerOption | null; error: string | null }>;
  onAdd: (option: IntermediaryPickerOption) => void;
  onRemove: (personId: string) => void;
  onMoveUp: (personId: string) => void;
  onMoveDown: (personId: string) => void;
  disabled?: boolean;
  error?: string | null;
  // The create/edit form renders this inside its own <form> and needs
  // each entry submitted, in order, as a repeated hidden field — the
  // detail page's "live" usage (which persists each change immediately
  // instead) has nothing to submit, so this defaults to false.
  submitAsHiddenFields?: boolean;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// Add/remove/reorder editor for a project's "Intermediary chain" —
// shared by the create/edit form (local-state usage, submitted on
// save) and the detail page (components/projects/project-
// intermediaries-section.tsx, each action persisted immediately). This
// component itself is purely callback-driven and has no idea which.
export function IntermediaryChainEditor({
  entries,
  receiverLabel,
  pickerOptions,
  onQuickCreate,
  onAdd,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled,
  error,
  submitAsHiddenFields,
}: IntermediaryChainEditorProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usedIds = new Set(entries.map((e) => e.personId));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = pickerOptions.filter((o) => !usedIds.has(o.id));
    return (q ? pool.filter((o) => o.label.toLowerCase().includes(q)) : pool).slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usedIds is derived from entries each render, not a stable dep
  }, [pickerOptions, query, entries]);

  function selectOption(option: IntermediaryPickerOption) {
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
      setCreateError("Name is required.");
      return;
    }
    setCreateError(null);
    startTransition(async () => {
      try {
        const result = await onQuickCreate(newName.trim());
        if (result.error || !result.option) {
          setCreateError(result.error ?? "Could not create contact.");
          return;
        }
        selectOption(result.option);
        setCreating(false);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {submitAsHiddenFields &&
        entries.map((entry) => (
          <input key={entry.key} type="hidden" name="intermediary_person_ids" value={entry.personId} />
        ))}

      {entries.length === 0 ? (
        <p className="text-sm text-white/35">No intermediaries yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {entries.map((entry, index) => (
            <span key={entry.key} className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm text-white/80">
                <span>
                  {entry.label}
                  {entry.archived && <span className="ml-1 text-[11px] text-white/40">(Archived)</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onMoveUp(entry.personId)}
                  disabled={disabled || index === 0}
                  aria-label={`Move ${entry.label} up`}
                  className="text-white/30 transition-colors duration-150 ease-out hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onMoveDown(entry.personId)}
                  disabled={disabled || index === entries.length - 1}
                  aria-label={`Move ${entry.label} down`}
                  className="text-white/30 transition-colors duration-150 ease-out hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.personId)}
                  disabled={disabled}
                  aria-label={`Remove ${entry.label}`}
                  className="text-white/30 transition-colors duration-150 ease-out hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-white/30">→</span>
            </span>
          ))}
          <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent-soft">
            {receiverLabel ?? "No receiver matched yet"}
          </span>
        </div>
      )}

      {!creating ? (
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            disabled={disabled}
            placeholder="Add intermediary…"
            className={`${fieldClass} py-1.5 pr-3 pl-8 text-xs disabled:opacity-50`}
          />
          {open && (
            <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">No matching contacts.</li>}
              {filtered.map((option) => (
                <li
                  key={option.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(option);
                  }}
                  className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
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
                  className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-1.5 text-xs font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
                >
                  <UserPlus className="h-3 w-3" />
                  New contact{query.trim() ? ` "${query.trim()}"` : ""}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="w-64 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
          <input
            autoFocus
            placeholder="Name *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
          />
          {createError && <p className="mt-2 text-xs text-rose-300">{createError}</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={handleCreate}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create & Add"}
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
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
