"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { upsertProjectTranche, deleteProjectTranche } from "@/lib/actions/projects";
import { formatDateOnly } from "@/lib/projects";
import { dateKeyInTimeZone } from "@/lib/format";
import type { ProjectTranche } from "@/lib/types";

interface TranchesSectionProps {
  projectId: string;
  tranches: ProjectTranche[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface RowProps {
  number: number;
  tranche: ProjectTranche | null;
  removable: boolean;
  disabled: boolean;
  onSave: (amount: string, sentOn: string, notes: string) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

// Identifies a tranche by its actual saved values rather than object
// identity: a server refresh creates a brand-new ProjectTranche object
// on every render regardless of whether anything in it changed, and
// comparing by reference would then resync (and so discard) an
// in-progress, not-yet-saved edit in some *other* row every time any
// refresh happens anywhere on the page.
function trancheKey(tranche: ProjectTranche | null): string {
  return `${tranche?.amount ?? ""}|${tranche?.sent_on ?? ""}|${tranche?.notes ?? ""}`;
}

function TrancheRow({ number, tranche, removable, disabled, onSave, onDelete, onCancel }: RowProps) {
  const [amount, setAmount] = useState(tranche?.amount != null ? String(tranche.amount) : "");
  const [sentOn, setSentOn] = useState(tranche?.sent_on ?? "");
  const [notes, setNotes] = useState(tranche?.notes ?? "");

  // Resyncs the fields to the server's actual row once its *values*
  // change (a successful save, or a refresh after someone else's edit)
  // — adjusting state directly during render, React's documented
  // pattern for this, rather than in a useEffect (which would cause an
  // extra render pass and, since it can't tell "the data changed" apart
  // from "the page merely re-rendered", the same discard-other-rows'-
  // drafts problem `trancheKey` above avoids).
  //
  // This is the actual fix for the bug where saving a tranche appeared
  // to do nothing: `useState`'s initial value only runs once, on mount,
  // so without this, the row kept displaying its pre-save local state
  // forever and never picked up the confirmed server value — there was
  // no feedback that anything had happened either way.
  const [prevKey, setPrevKey] = useState(trancheKey(tranche));
  const currentKey = trancheKey(tranche);
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setAmount(tranche?.amount != null ? String(tranche.amount) : "");
    setSentOn(tranche?.sent_on ?? "");
    setNotes(tranche?.notes ?? "");
  }

  function markSentToday() {
    setSentOn(dateKeyInTimeZone(new Date().toISOString()));
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-white/55">Tranche {number}</p>
        {!sentOn ? (
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/45">
            Not sent
          </span>
        ) : (
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            Sent on {formatDateOnly(sentOn)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
          className={fieldClass}
        />
        <input
          type="date"
          aria-label="Sent on"
          value={sentOn}
          onChange={(e) => setSentOn(e.target.value)}
          disabled={disabled}
          className={fieldClass}
        />
        <input
          type="text"
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled}
          className={fieldClass}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave(amount, sentOn, notes)}
          disabled={disabled}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        {!sentOn && (
          <button
            type="button"
            onClick={markSentToday}
            disabled={disabled}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark sent today
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Cancel
          </button>
        )}
        {removable && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={`Remove tranche ${number}`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function TranchesSection({ projectId, tranches }: TranchesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedNumber, setSavedNumber] = useState<number | null>(null);
  const [addingNext, setAddingNext] = useState(false);

  const byNumber = new Map(tranches.map((t) => [t.tranche_number, t]));
  const extraNumbers = tranches.map((t) => t.tranche_number).filter((n) => n > 2).sort((a, b) => a - b);
  const nextNumber = Math.max(2, ...extraNumbers) + 1;

  function handleSave(trancheNumber: number, amount: string, sentOn: string, notes: string) {
    setError(null);
    setSavedNumber(null);
    startTransition(async () => {
      try {
        const result = await upsertProjectTranche(projectId, trancheNumber, amount, sentOn, notes);
        if (result.error) {
          setError(result.error);
          return;
        }
        setAddingNext(false);
        setSavedNumber(trancheNumber);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function handleDelete(trancheNumber: number) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteProjectTranche(projectId, trancheNumber);
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

  return (
    <div className="flex flex-col gap-3">
      {[1, 2, ...extraNumbers].map((number) => (
        <div key={number} className="flex flex-col gap-1">
          <TrancheRow
            number={number}
            tranche={byNumber.get(number) ?? null}
            removable={number > 2}
            disabled={isPending}
            onSave={(amount, sentOn, notes) => handleSave(number, amount, sentOn, notes)}
            onDelete={number > 2 ? () => handleDelete(number) : undefined}
          />
          {savedNumber === number && !isPending && (
            <p className="text-xs text-emerald-300">Saved.</p>
          )}
        </div>
      ))}

      {addingNext ? (
        <TrancheRow
          number={nextNumber}
          tranche={null}
          removable={false}
          disabled={isPending}
          onSave={(amount, sentOn, notes) => handleSave(nextNumber, amount, sentOn, notes)}
          onCancel={() => setAddingNext(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingNext(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Tranches after
        </button>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
