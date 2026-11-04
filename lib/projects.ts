import { LOCALE } from "@/lib/format";
import type { Currency, ProjectPriority, ProjectStage, ProjectStatus } from "@/lib/types";

// Kept in sync by hand with the CHECK constraint added by
// supabase/migrations/002_currency_check.sql.
export const CURRENCIES: Currency[] = ["USD", "EUR"];

export const STAGES: ProjectStage[] = ["new", "documents_received", "match", "status"];
export const STATUSES: ProjectStatus[] = [
  "open",
  "with_receiver",
  "with_sender",
  "waiting",
  "in_process",
  "completed",
  "lost",
];
export const PRIORITIES: ProjectPriority[] = ["low", "medium", "high", "urgent"];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  new: "New",
  documents_received: "Documents Received",
  match: "Match",
  status: "Status",
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  open: "Open",
  with_receiver: "With Receiver",
  with_sender: "With Sender",
  waiting: "Waiting",
  in_process: "In Process",
  completed: "Completed",
  lost: "Lost",
};

export const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// A project only really counts as "closed" once it's reached the Status
// stage and landed on a terminal status. Used by the dashboard and list
// page instead of a plain boolean, since the schema has no such column.
export function isClosedStatus(status: ProjectStatus | null): boolean {
  return status === "completed" || status === "lost";
}

// Date-only Postgres columns (e.g. "2026-09-10") must not be parsed with
// `new Date(str)`, which treats them as UTC midnight and can shift a day
// in local timezones behind UTC. Shared by tranche sent_on display and
// the Notes reminder feature below.
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Deliberately no `timeZone` option here, unlike lib/format.ts's
// formatDateTime: parseDateOnly already builds this Date at local
// midnight in whatever timezone the current runtime defaults to (not
// UTC, not the fixed business timezone), so re-interpreting it in a
// *different* fixed timezone when formatting could shift the displayed
// day backwards or forwards. Locale is still pinned, since that only
// affects word choice/ordering, never the underlying date value.
export function formatDateOnly(value: string): string {
  return parseDateOnly(value).toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Note reminders only below — a project itself has no follow-up/due-date
// concept anymore (that's project_steps.next_step.due_date, Phase 3's
// timeline). Kept here since components/notes/badges.tsx already depends
// on these and moving them isn't in scope for this change.
export function isFollowUpDue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateOnly(dueDate).getTime() <= today.getTime();
}

export function followUpLabel(dueDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - parseDateOnly(dueDate).getTime()) / 86_400_000);
  if (diffDays <= 0) return "Due today";
  if (diffDays === 1) return "1 day overdue";
  return `${diffDays} days overdue`;
}
