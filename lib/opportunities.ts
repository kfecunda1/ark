import { daysSinceInstant } from "@/lib/projects";
import { getDictionary, type Lang } from "@/lib/i18n";
import type { OpportunityStatus } from "@/lib/types";

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = ["open", "converted", "closed"];

// Same threshold the Dashboard/morning briefing's own copy ("N untouched
// 30+ days") names explicitly — unlike the stuck-projects threshold
// (Settings → Defaults' stuck_after_days), this one isn't admin-
// configurable; opportunities are meant to be acted on quickly.
export const OPPORTUNITY_STALE_AFTER_DAYS = 30;

export function isOpportunityStale(lastActivityAt: string): boolean {
  return daysSinceInstant(lastActivityAt) >= OPPORTUNITY_STALE_AFTER_DAYS;
}

export function opportunityStatusLabel(status: OpportunityStatus, lang: Lang = "en"): string {
  return getDictionary(lang).opportunities.statusLabels[status];
}
