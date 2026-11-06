"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectIsRecovery, updateProjectRatioReal } from "@/lib/actions/projects";

interface RecoveryToggleProps {
  projectId: string;
  isRecovery: boolean;
}

type Message =
  | { tone: "filled"; text: string }
  | { tone: "differs"; contactName: string; productType: string; theirRatio: string; currentRatio: string }
  | { tone: "missing"; contactName: string; productType: string; isRecovery: boolean };

// The detail page's inline Recovery checkbox — saves immediately (same
// pattern as StatusSelect/MatchedContactSelect) and, if the project
// already has a final product and a matched contact, runs the ratio
// auto-fill against whichever ratio column the new value now points
// at. The create/edit form has its own client-side version of the same
// check, since there the project may not be saved yet.
export function RecoveryToggle({ projectId, isRecovery }: RecoveryToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  // Flipping this is also what moves the project between the Projects
  // and Recovery Projects tabs (same `projects` table, just filtered by
  // this column) — a short note so that move isn't silent.
  const [movedNote, setMovedNote] = useState<string | null>(null);

  function apply(next: boolean) {
    setError(null);
    setMessage(null);
    setMovedNote(null);
    startTransition(async () => {
      try {
        const result = await updateProjectIsRecovery(projectId, next);
        if (result.error) {
          setError(result.error);
          return;
        }
        setMovedNote(next ? "Moved to Recovery Projects" : "Moved to Projects");
        if (result.autoFill) {
          const { filled, differs, contactName, productType, theirRatio, currentRatio, isRecovery: forRecovery } =
            result.autoFill;
          if (filled) {
            setMessage({ tone: "filled", text: `Real ratio filled from ${contactName} (${productType}).` });
          } else if (differs) {
            setMessage({ tone: "differs", contactName, productType, theirRatio: theirRatio!, currentRatio: currentRatio ?? "" });
          } else {
            setMessage({ tone: "missing", contactName, productType, isRecovery: forRecovery });
          }
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  // The only way ratio_real is overwritten once it already holds a
  // different value — never automatically.
  function useTheirRatio() {
    if (message?.tone !== "differs") return;
    const { theirRatio } = message;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectRatioReal(projectId, theirRatio);
        if (result.error) {
          setError(result.error);
          return;
        }
        setMessage(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="inline-flex items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={isRecovery}
          onChange={(e) => apply(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
        />
        Recovery
      </label>

      {movedNote && <p className="text-xs text-emerald-300">{movedNote}</p>}
      {message?.tone === "filled" && <p className="text-xs text-emerald-300">{message.text}</p>}
      {message?.tone === "differs" && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-200">
            {message.contactName}&apos;s ratio for {message.productType} is {message.theirRatio}. Current real
            ratio is {message.currentRatio}.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={useTheirRatio}
              disabled={isPending}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use {message.theirRatio}
            </button>
            <button
              type="button"
              onClick={() => setMessage(null)}
              disabled={isPending}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Keep {message.currentRatio}
            </button>
          </div>
        </div>
      )}
      {message?.tone === "missing" && (
        <p className="text-xs text-amber-300">
          {message.contactName} has no {message.isRecovery ? "recovery ratio" : "ratio"} set for {message.productType}.
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
