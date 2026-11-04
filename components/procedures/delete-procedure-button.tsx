"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteProcedure } from "@/lib/actions/procedures";

interface DeleteProcedureButtonProps {
  procedureId: string;
  redirectTo?: string;
  compact?: boolean;
}

export function DeleteProcedureButton({ procedureId, redirectTo, compact }: DeleteProcedureButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProcedure(procedureId);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs whitespace-nowrap text-rose-300">Delete permanently?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Yes, delete"}
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
    <div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={
          compact
            ? "inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
            : "inline-flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
        }
      >
        <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Delete
      </button>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
