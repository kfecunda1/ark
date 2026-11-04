"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setProjectStepDone } from "@/lib/actions/project-steps";
import { DueDateBadge } from "@/components/projects/due-date-badge";

export interface FollowUpItem {
  id: string;
  projectId: string;
  projectName: string;
  body: string;
  dueDate: string;
}

// Lets a follow-up be checked off right from the Dashboard, without
// navigating to the project — same setProjectStepDone action the
// project timeline itself uses.
export function FollowUpsDue({ items }: { items: FollowUpItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleDone(item: FollowUpItem) {
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await setProjectStepDone(item.id, item.projectId, true);
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
          key={item.id}
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
            <Link href={`/projects/${item.projectId}`} className="text-sm text-white/85 hover:text-white">
              {item.body}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
              <span className="truncate">{item.projectName}</span>
              <DueDateBadge dueDate={item.dueDate} />
            </p>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
