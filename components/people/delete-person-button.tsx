"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deletePerson } from "@/lib/actions/people";

interface DeletePersonButtonProps {
  personId: string;
  redirectTo: string;
  // Already loaded by the detail page (app/(app)/people/[id]/page.tsx
  // already fetches both lists for its own "Linked Receivers"/"Linked
  // Projects" sections) — passed in rather than re-fetched here, and
  // re-checked server-side by deletePerson regardless before it
  // actually deletes anything.
  linkedProjectCount: number;
  linkedReceiverCount: number;
}

// Rendered only for admins — see app/(app)/people/[id]/page.tsx, which
// checks isCurrentUserAdmin() before including this at all. deletePerson
// re-checks admin + the link counts itself regardless, so this is
// strictly a UI convenience, not the real enforcement.
export function DeletePersonButton({
  personId,
  redirectTo,
  linkedProjectCount,
  linkedReceiverCount,
}: DeletePersonButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = linkedProjectCount > 0 || linkedReceiverCount > 0;
  const linkParts = [
    linkedProjectCount > 0 ? `${linkedProjectCount} project${linkedProjectCount === 1 ? "" : "s"}` : null,
    linkedReceiverCount > 0 ? `${linkedReceiverCount} receiver${linkedReceiverCount === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => Boolean(part));

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deletePerson(personId);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push(redirectTo);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        {blocked ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm text-amber-200">
                Linked to {linkParts.join(" and ")}. Archive instead, or unlink first.
              </p>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="mt-2 text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3">
            <p className="text-sm text-rose-200">This permanently deletes this contact. This cannot be undone.</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
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

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
    >
      <Trash2 className="h-4 w-4" />
      Delete
    </button>
  );
}
