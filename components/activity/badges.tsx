import { actionLabel, entityTypeLabel } from "@/lib/activity";
import { type Lang } from "@/lib/i18n";
import type { ActivityAction, ActivityEntityType } from "@/lib/types";

const ACTION_STYLES: Record<ActivityAction, string> = {
  created: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  updated: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  deleted: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export function ActivityActionBadge({ action, lang = "en" }: { action: ActivityAction; lang?: Lang }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${ACTION_STYLES[action]}`}
    >
      {actionLabel(action, lang)}
    </span>
  );
}

export function ActivityEntityBadge({ entityType, lang = "en" }: { entityType: ActivityEntityType; lang?: Lang }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white/55">
      {entityTypeLabel(entityType, lang)}
    </span>
  );
}
