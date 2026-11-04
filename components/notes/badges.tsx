import { CalendarClock } from "lucide-react";
import { formatDateOnly, followUpLabel, isFollowUpDue } from "@/lib/projects";

export function ReminderBadge({ dueDate }: { dueDate: string }) {
  const due = isFollowUpDue(dueDate);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
        due ? "border-rose-500/25 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/[0.06] text-white/50"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      {due ? followUpLabel(dueDate) : `Due ${formatDateOnly(dueDate)}`}
    </span>
  );
}
