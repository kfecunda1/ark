import type { BusinessLine, LeadPriority, LeadStage } from "@/lib/types";

export const STUCK_THRESHOLD_DAYS = 20;

export const BUSINESS_LINES: BusinessLine[] = ["crypto", "gold", "pgm", "oil_products", "banking"];
export const STAGES: LeadStage[] = ["new", "in_progress", "closed_won", "closed_lost"];
export const PRIORITIES: LeadPriority[] = ["low", "medium", "high", "urgent"];

export const BUSINESS_LINE_LABELS: Record<BusinessLine, string> = {
  crypto: "Crypto",
  gold: "Gold",
  pgm: "PGM",
  oil_products: "Oil Products",
  banking: "Banking",
};

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  in_progress: "In Progress",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

export const PRIORITY_LABELS: Record<LeadPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Date-only Postgres columns (e.g. "2026-09-10") must not be parsed with
// `new Date(str)`, which treats them as UTC midnight and can shift a day in
// local timezones behind UTC.
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateOnly(value: string): string {
  return parseDateOnly(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function isStuckDeal(stage: LeadStage, stageUpdatedAt: string): boolean {
  if (stage === "closed_won" || stage === "closed_lost") return false;
  const days = (Date.now() - new Date(stageUpdatedAt).getTime()) / 86_400_000;
  return days > STUCK_THRESHOLD_DAYS;
}

export function isFollowUpDue(followUpDate: string | null): boolean {
  if (!followUpDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateOnly(followUpDate).getTime() <= today.getTime();
}

// Whole days elapsed since a timestamptz value (e.g. stage_updated_at).
export function daysSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

export function followUpLabel(followUpDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - parseDateOnly(followUpDate).getTime()) / 86_400_000);
  if (diffDays <= 0) return "Due today";
  if (diffDays === 1) return "1 day overdue";
  return `${diffDays} days overdue`;
}
