import { CalendarClock, Users } from "lucide-react";
import { formatDateOnly, followUpLabel, isFollowUpDue } from "@/lib/projects";
import { getDictionary, type Lang } from "@/lib/i18n";

export function ReminderBadge({ dueDate, lang = "en" }: { dueDate: string; lang?: Lang }) {
  const due = isFollowUpDue(dueDate);
  const t = getDictionary(lang);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
        due ? "border-rose-500/25 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/[0.06] text-white/50"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      {due ? followUpLabel(dueDate, lang) : t.notes.dueOn(formatDateOnly(dueDate, lang))}
    </span>
  );
}

// supabase/migrations/035_meeting_notes.sql — a meeting is notes.kind
// = 'meeting'. Violet, distinct from every other badge family in the
// app (StageBadge/StatusBadge stay in the cool steel-blue/teal range,
// OpportunityStatusBadge reuses that same family plus emerald/grey) so
// a meeting always reads as its own kind of thing in a mixed list —
// same reasoning as the Dashboard's "Open Opportunities" card already
// picking violet for its own, otherwise-unclaimed accent.
export function MeetingBadge({ date, lang = "en" }: { date?: string; lang?: Lang }) {
  const t = getDictionary(lang);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-violet-300">
      <Users className="h-3 w-3" />
      {date ? `${t.notes.meetingLabel} · ${date}` : t.notes.meetingLabel}
    </span>
  );
}
