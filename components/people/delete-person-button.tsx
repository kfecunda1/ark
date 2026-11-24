"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deletePerson } from "@/lib/actions/people";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

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
  // supabase/migrations/035_meeting_notes.sql — meetings this person
  // attended (note_participants), same blocking treatment as the two
  // counts above.
  linkedMeetingCount?: number;
  lang?: Lang;
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
  linkedMeetingCount = 0,
  lang = "en",
}: DeletePersonButtonProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = linkedProjectCount > 0 || linkedReceiverCount > 0 || linkedMeetingCount > 0;

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deletePerson(personId);
        if (result.error) {
          setError(
            result.error === "linkedToCannotDelete" && result.linkedCounts
              ? t.people.linkedToCannotDelete(
                  result.linkedCounts.projectCount,
                  result.linkedCounts.receiverCount,
                  result.linkedCounts.meetingCount
                )
              : resolveError(result.error, lang)
          );
          return;
        }
        router.push(redirectTo);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
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
                {t.people.linkedToCannotDelete(linkedProjectCount, linkedReceiverCount, linkedMeetingCount)}
              </p>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="mt-2 text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3">
            <p className="text-sm text-rose-200">{t.people.deleteConfirmBody}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {isPending ? t.people.deleting : t.people.confirmDelete}
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
      {t.common.delete}
    </button>
  );
}
