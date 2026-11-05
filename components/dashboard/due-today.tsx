"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setProjectStepDone } from "@/lib/actions/project-steps";
import { setNoteReminderDone } from "@/lib/actions/notes";
import { DueDateBadge } from "@/components/projects/due-date-badge";

export interface DueItem {
  id: string;
  // "step": an open project_steps next_step. "note": a note reminder
  // (project- or contact-linked, or unlinked) that's due and not done.
  kind: "step" | "note";
  body: string;
  dueDate: string;
  href: string;
  parentName: string;
  // Only steps need this — setProjectStepDone takes the owning project
  // id as well as the step id; setNoteReminderDone only needs the note.
  projectId?: string;
}

const KIND_LABEL: Record<DueItem["kind"], string> = {
  step: "Next step",
  note: "Reminder",
};

// Lets an item be checked off right from the Dashboard, without
// navigating away — dispatches to whichever action owns that kind of
// row (project_steps vs notes).
export function DueTodayAndOverdue({ items }: { items: DueItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleDone(item: DueItem) {
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result =
          item.kind === "step"
            ? await setProjectStepDone(item.id, item.projectId!, true)
            : await setNoteReminderDone(item.id, true);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-white/35">Nothing due.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={`${item.kind}-${item.id}`}
          className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
        >
          <input
            type="checkbox"
            onChange={() => handleDone(item)}
            disabled={isPending && pendingId === item.id}
            aria-label="Mark as done"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                {KIND_LABEL[item.kind]}
              </span>
            </div>
            <Link href={item.href} className="text-sm text-white/85 hover:text-white">
              {item.body}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
              <span className="truncate">{item.parentName}</span>
              <DueDateBadge dueDate={item.dueDate} />
            </p>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
