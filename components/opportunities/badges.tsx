import { opportunityStatusLabel } from "@/lib/opportunities";
import type { Lang } from "@/lib/i18n";
import type { OpportunityStatus } from "@/lib/types";

// open stays in the same steel-blue family every other "still live"
// badge uses (StageBadge's "new"); converted reads as a clean outcome
// (emerald, like StatusBadge's "completed"-kind colors); closed is a
// plain grey "done, nothing more to see" — same STATUS_COLOR_STYLES
// family components/projects/badges.tsx already uses, just inlined
// here rather than importing that file's StatusColor-keyed map for
// three fixed, never-admin-configurable values.
const OPPORTUNITY_STATUS_STYLES: Record<OpportunityStatus, string> = {
  open: "bg-accent/15 text-accent-soft border-accent/25",
  converted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  closed: "bg-white/[0.06] text-white/50 border-white/10",
};

export function OpportunityStatusBadge({ status, lang = "en" }: { status: OpportunityStatus; lang?: Lang }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${OPPORTUNITY_STATUS_STYLES[status]}`}
    >
      {opportunityStatusLabel(status, lang)}
    </span>
  );
}
