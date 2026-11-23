"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteOpportunity } from "@/lib/actions/opportunities";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

interface DeleteOpportunityButtonProps {
  opportunityId: string;
  documentCount: number;
  noteCount: number;
  lang?: Lang;
}

// Rendered only for admins (app/(app)/opportunities/[id]/page.tsx checks
// isCurrentUserAdmin() before including this at all) — deleteOpportunity
// re-checks admin server-side regardless. Nothing else references an
// opportunity as a hard link (converted_to_id is purely informational,
// not an FK), so unlike DeleteReceiverButton/DeleteProjectButton there's
// no "blocked while linked elsewhere" case to show.
export function DeleteOpportunityButton({ opportunityId, documentCount, noteCount, lang = "en" }: DeleteOpportunityButtonProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteOpportunity(opportunityId);
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      router.push("/opportunities");
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3">
          <p className="text-sm text-rose-200">{t.opportunities.deletePermanentIntro}</p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-rose-200/80">
            <li>{t.opportunities.documentsCountAlsoRemoved(documentCount)}</li>
            <li>{t.opportunities.notesCount(noteCount)}</li>
          </ul>
          <p className="mt-1.5 text-xs text-rose-200/60">{t.receiverDialogs.cannotBeUndone}</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {isPending ? t.common.deleting : t.receiverDialogs.confirmDelete}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
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
      {t.common.delete}
    </button>
  );
}
