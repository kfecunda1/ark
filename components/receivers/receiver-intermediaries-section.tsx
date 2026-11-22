"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { addReceiverIntermediary, removeReceiverIntermediary } from "@/lib/actions/intermediaries";
import { quickCreatePerson } from "@/lib/actions/people";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { ReceiverIntermediaryRow } from "@/lib/intermediaries";

interface ReceiverIntermediariesSectionProps {
  receiverId: string;
  intermediaries: ReceiverIntermediaryRow[];
  // Active contacts only, already excluding archived people — same
  // convention as every other picker.
  pickerOptions: { id: string; label: string }[];
  lang?: Lang;
}

// A receiver's own intermediaries — an unordered set (unlike a
// project's own ordered chain, components/projects/intermediary-chain-
// editor.tsx), each showing how many of this receiver's own projects
// they appear in as an intermediary.
export function ReceiverIntermediariesSection({
  receiverId,
  intermediaries,
  pickerOptions,
  lang = "en",
}: ReceiverIntermediariesSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const usedIds = new Set(intermediaries.map((i) => i.personId));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = pickerOptions.filter((o) => !usedIds.has(o.id));
    return (q ? pool.filter((o) => o.label.toLowerCase().includes(q)) : pool).slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usedIds is derived from intermediaries each render, not a stable dep
  }, [pickerOptions, query, intermediaries]);

  function handleAdd(personId: string) {
    setError(null);
    setQuery("");
    setOpen(false);
    startTransition(async () => {
      try {
        const result = await addReceiverIntermediary(receiverId, personId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  function handleRemove(personId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeReceiverIntermediary(receiverId, personId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  function handleCreate() {
    if (!newName.trim()) {
      setError(t.common.nameRequired);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await quickCreatePerson({ name: newName.trim() });
        if (result.error || !result.person) {
          setError(result.error ?? t.common.couldNotCreate(lang === "es" ? "contacto" : "contact"));
          return;
        }
        setCreating(false);
        setQuery("");
        const addResult = await addReceiverIntermediary(receiverId, result.person.id);
        if (addResult.error) {
          setError(resolveError(addResult.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {intermediaries.length === 0 ? (
        <p className="text-sm text-white/35">{t.receiverDialogs.noIntermediariesYet}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {intermediaries.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                {item.label}
                {item.archived && <span className="ml-1.5 text-xs text-white/40">({t.common.archived})</span>}
              </span>
              <span className="shrink-0 text-xs text-white/40">{t.receiverDialogs.projectCount(item.projectCount)}</span>
              <button
                type="button"
                onClick={() => handleRemove(item.personId)}
                disabled={isPending}
                aria-label={t.receiverDialogs.removeIntermediary(item.label)}
                className="shrink-0 text-white/30 transition-colors duration-150 ease-out hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
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
            disabled={isPending}
            placeholder={t.receiverDialogs.addIntermediary}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-1.5 pr-3 pl-8 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06] disabled:opacity-50"
          />
          {open && (
            <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">{t.common.noMatchingContacts}</li>}
              {filtered.map((option) => (
                <li
                  key={option.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleAdd(option.id);
                  }}
                  className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                >
                  {option.label}
                </li>
              ))}
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  setNewName(query.trim());
                  setCreating(true);
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-1.5 text-xs font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
              >
                <UserPlus className="h-3 w-3" />
                {t.common.newContact}
                {query.trim() ? ` "${query.trim()}"` : ""}
              </li>
            </ul>
          )}
        </div>
      ) : (
        <div className="w-64 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
          <input
            autoFocus
            placeholder={t.common.namePlaceholder}
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
              {isPending ? t.common.creating : t.receiverDialogs.createAndAdd}
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
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
