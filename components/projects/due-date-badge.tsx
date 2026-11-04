import { CalendarClock } from "lucide-react";
import { dueDateLabel, dueDateTone } from "@/lib/projects";

// Shared by the project timeline, the Projects list's "Next step"
// column, and the Dashboard's Follow-ups due section — every place a
// project_steps.next_step due date needs the same overdue (red) / due
// today (amber) / upcoming (neutral) coloring.
export function DueDateBadge({ dueDate }: { dueDate: string }) {
  const tone = dueDateTone(dueDate);
  const toneClass =
    tone === "overdue"
      ? "border-red-500/25 bg-red-500/10 text-red-300"
      : tone === "today"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
        : "border-white/10 bg-white/[0.06] text-white/50";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass}`}
    >
      <CalendarClock className="h-3 w-3" />
      {dueDateLabel(dueDate)}
    </span>
  );
}
