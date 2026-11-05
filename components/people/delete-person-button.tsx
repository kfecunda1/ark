"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletePerson } from "@/lib/actions/people";

// Same confirm-then-delete pattern as components/notes/delete-note-
// button.tsx. Used on the detail page only (not the list), since
// there's no inline-delete affordance on the People list's table rows.
export function DeletePersonButton({ personId, redirectTo }: { personId: string; redirectTo: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deletePerson(personId);
        if (result.error) {
          setError(result.error);
          setConfirming(false);
          return;
        }
        router.push(redirectTo);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-2">
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
