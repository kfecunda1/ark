"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteNote } from "@/lib/actions/notes";

export function DeleteNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteNote(noteId);
        if (result.error) {
          setError(result.error);
          setConfirming(false);
          return;
        }
        router.refresh();
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
          className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete note"
        className="rounded-md p-1.5 text-white/30 transition-colors duration-150 ease-out hover:bg-rose-500/10 hover:text-rose-300"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
