"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteProject } from "@/lib/actions/projects";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

interface DeleteProjectButtonProps {
  projectId: string;
  // Already loaded by the detail page (app/(app)/projects/[id]/page.tsx
  // already fetches all of these for its own sections) — passed in
  // rather than re-fetched here. deleteProject re-checks admin-ness
  // itself regardless before it actually deletes anything; this is
  // strictly a UI convenience listing what's about to go.
  trancheCount: number;
  payoutCount: number;
  payoutShareCount: number;
  stepCount: number;
  noteCount: number;
  productOptionCount: number;
  intermediaryCount: number;
  documentCount: number;
  lang?: Lang;
}

// Rendered only for admins — see app/(app)/projects/[id]/page.tsx,
// which checks isCurrentUserAdmin() before including this at all.
// Unlike receivers, deleting a project is never blocked — there's no
// "linked to something else" case for a project itself.
export function DeleteProjectButton({
  projectId,
  trancheCount,
  payoutCount,
  payoutShareCount,
  stepCount,
  noteCount,
  productOptionCount,
  intermediaryCount,
  documentCount,
  lang = "en",
}: DeleteProjectButtonProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteProject(projectId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.push("/projects");
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3">
          <p className="text-sm text-rose-200">{t.projectDialogs.permanentlyDeletesIncluding}</p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-rose-200/80">
            <li>{t.projectDialogs.trancheCount(trancheCount)}</li>
            <li>{t.projectDialogs.payoutRecordAndShares(payoutCount, payoutShareCount)}</li>
            <li>{t.projectDialogs.stepCount(stepCount)}</li>
            <li>{t.projectDialogs.noteCount(noteCount)}</li>
            <li>{t.projectDialogs.productOptionCount(productOptionCount)}</li>
            <li>{t.projectDialogs.intermediaryCountPlain(intermediaryCount)}</li>
            <li>{t.projectDialogs.documentCountWithStorage(documentCount)}</li>
          </ul>
          <p className="mt-1.5 text-xs text-rose-200/60">{t.projectDialogs.cannotBeUndone}</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {isPending ? t.common.deleting : t.projectDialogs.confirmDelete}
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
