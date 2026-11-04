import { ACTION_LABELS, ENTITY_TYPE_LABELS } from "@/lib/activity";
import type { ActivityAction, ActivityEntityType } from "@/lib/types";

const ACTION_STYLES: Record<ActivityAction, string> = {
  created: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  updated: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  deleted: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export function ActivityActionBadge({ action }: { action: ActivityAction }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${ACTION_STYLES[action]}`}
    >
      {ACTION_LABELS[action]}
    </span>
  );
}

export function ActivityEntityBadge({ entityType }: { entityType: ActivityEntityType }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white/55">
      {ENTITY_TYPE_LABELS[entityType]}
    </span>
  );
}
