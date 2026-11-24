"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectStepDone } from "@/lib/actions/project-steps";
import { setNoteReminderDone } from "@/lib/actions/notes";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { MeetingActionItem } from "@/lib/actions/meetings";

interface MeetingActionItemsSectionProps {
  items: MeetingActionItem[];
  // Needed only for project_step-kind items — setProjectStepDone takes
  // the owning project id as well as the step id.
  projectId: string | null;
  lang?: Lang;
}

// "The detail shows ... action items with their done/open state
// (ticking one marks the underlying next step or reminder done)" —
// dispatches to whichever action owns that item's own table (lib/
// actions/meetings.ts's getMeetingActionItems already resolved which
// one this meeting's items live in).
export function MeetingActionItemsSection({ items, projectId, lang = "en" }: MeetingActionItemsSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleToggle(item: MeetingActionItem, done: boolean) {
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result =
          item.kind === "project_step"
            ? await setProjectStepDone(item.id, projectId!, done)
            : await setNoteReminderDone(item.id, done);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingId(null);
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-white/35">{t.meetingDetail.noActionItems}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
        >
          <input
            type="checkbox"
            checked={item.done}
            onChange={(e) => handleToggle(item, e.target.checked)}
            disabled={isPending && pendingId === item.id}
            aria-label={item.done ? t.meetingDetail.markNotDone : t.meetingDetail.markDone}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
          />
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${item.done ? "text-white/40 line-through" : "text-white/85"}`}>{item.text}</p>
            {item.dueDate && !item.done && (
              <div className="mt-1">
                <DueDateBadge dueDate={item.dueDate} lang={lang} />
              </div>
            )}
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
