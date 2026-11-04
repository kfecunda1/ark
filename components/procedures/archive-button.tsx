"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { archiveProcedure } from "@/lib/actions/procedures";

export function ArchiveButton({ procedureId }: { procedureId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleArchive() {
    if (!window.confirm("Archive this procedure? It will be marked irrelevant/duplicate.")) return;
    setError(null);
    startTransition(async () => {
      const result = await archiveProcedure(procedureId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleArchive}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Archive className="h-4 w-4" />
        {isPending ? "Archiving…" : "Archive"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
