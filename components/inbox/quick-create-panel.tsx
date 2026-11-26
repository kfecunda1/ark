"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";
import type { SimilarMatch } from "@/lib/dedup";

interface QuickCreatePanelProps {
  name: string;
  onNameChange: (value: string) => void;
  nameLabel: string;
  namePlaceholder?: string;
  // Entity-specific fields (product options, nickname, matched
  // receiver, …) — rendered between the name field and the duplicate
  // warning/create button, owned and controlled by the caller.
  children?: React.ReactNode;
  // "Similar: <name> — use this instead?" (task's own wording) — run
  // once, when Create is first clicked; skipped on a second click
  // after "Create anyway".
  checkSimilar: (name: string) => Promise<SimilarMatch[]>;
  // The user picked an existing record instead of creating a new one —
  // the caller selects it as the destination and closes this panel.
  onUseExisting: (match: SimilarMatch) => void;
  // The caller does the actual creation (and, on success, whatever it
  // needs to do with the new record — select it as the destination,
  // close this panel, …); this just surfaces an error, if any.
  onCreate: () => Promise<{ error: string | null }>;
  onCancel: () => void;
  createLabel: string;
  creatingLabel: string;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

// Shared chrome for the Inbox's three quick-create forms (project,
// receiver, opportunity) — the name field, a slot for whatever extra
// fields that entity needs, the "Similar: X — use this instead?"
// duplicate warning (a warning only — "Create anyway" always works),
// and the create/cancel buttons. Mobile-friendly: everything stacks in
// a single column, no fixed widths.
export function QuickCreatePanel({
  name,
  onNameChange,
  nameLabel,
  namePlaceholder,
  children,
  checkSimilar,
  onUseExisting,
  onCreate,
  onCancel,
  createLabel,
  creatingLabel,
  lang = "en",
}: QuickCreatePanelProps) {
  const t = getDictionary(lang);
  const [similar, setSimilar] = useState<SimilarMatch[] | null>(null);
  const [skipCheck, setSkipCheck] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runCreate() {
    startTransition(async () => {
      const result = await onCreate();
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setSimilar(null);
    });
  }

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.common.nameRequired);
      return;
    }
    setError(null);

    if (skipCheck) {
      runCreate();
      return;
    }

    startTransition(async () => {
      const matches = await checkSimilar(trimmed);
      if (matches.length > 0) {
        setSimilar(matches);
        return;
      }
      await onCreate().then((result) => {
        if (result.error) setError(result.error);
      });
    });
  }

  function handleCreateAnyway() {
    setSkipCheck(true);
    setSimilar(null);
    runCreate();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      <div>
        <label className={labelClass}>{nameLabel}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
            setSimilar(null);
            setSkipCheck(false);
          }}
          placeholder={namePlaceholder}
          disabled={isPending}
          className={`${fieldClass} disabled:opacity-50`}
        />
      </div>

      {children}

      {similar && similar.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <ul className="flex flex-col gap-2">
                {similar.map((match) => (
                  <li key={match.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-amber-100">{t.inboxQuickCreate.similarTo(match.label)}</span>
                    <button
                      type="button"
                      onClick={() => onUseExisting(match)}
                      disabled={isPending}
                      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 transition-colors duration-150 ease-out hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t.inboxQuickCreate.useThisInstead}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleCreateAnyway}
                disabled={isPending}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition-colors duration-150 ease-out hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? creatingLabel : t.inboxQuickCreate.createAnyway}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {!similar && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? creatingLabel : createLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
