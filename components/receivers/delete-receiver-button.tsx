"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteContact } from "@/lib/actions/contacts";

interface DeleteReceiverButtonProps {
  contactId: string;
  // Already loaded by the detail page (app/(app)/receivers/[id]/page.tsx
  // already fetches all four for its own sections) — passed in rather
  // than re-fetched here, and re-checked server-side by deleteContact
  // regardless before it actually deletes anything.
  linkedProjectCount: number;
  productCount: number;
  documentCount: number;
  noteCount: number;
}

// Rendered only for admins — see app/(app)/receivers/[id]/page.tsx,
// which checks isCurrentUserAdmin() before including this at all.
// deleteContact re-checks admin + the linked-project count itself
// regardless, so this is strictly a UI convenience, not the real
// enforcement.
export function DeleteReceiverButton({
  contactId,
  linkedProjectCount,
  productCount,
  documentCount,
  noteCount,
}: DeleteReceiverButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = linkedProjectCount > 0;

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteContact(contactId);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push("/receivers");
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
                Linked to {linkedProjectCount} project{linkedProjectCount === 1 ? "" : "s"}. Archive instead, or
                unlink first.
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
            <p className="text-sm text-rose-200">This permanently deletes this receiver, including:</p>
            <ul className="mt-1.5 list-inside list-disc text-sm text-rose-200/80">
              <li>
                {productCount} product{productCount === 1 ? "" : "s"} & ratio{productCount === 1 ? "" : "s"}
              </li>
              <li>
                {documentCount} document{documentCount === 1 ? "" : "s"} (also removed from storage)
              </li>
              <li>
                {noteCount} note{noteCount === 1 ? "" : "s"}
              </li>
            </ul>
            <p className="mt-1.5 text-xs text-rose-200/60">This cannot be undone.</p>
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
