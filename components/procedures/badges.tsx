import { Copy } from "lucide-react";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/procedures";
import type { ProcedureSource, ProcedureStatus } from "@/lib/types";

const STATUS_STYLES: Record<ProcedureStatus, string> = {
  unmatched: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  matched: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  archived: "bg-white/[0.06] text-white/45 border-white/10",
};

export function ProcedureStatusBadge({ status }: { status: ProcedureStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const SOURCE_STYLES: Record<ProcedureSource, string> = {
  whatsapp: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  telegram: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  document: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  link: "bg-white/[0.06] text-white/55 border-white/10",
};

export function ProcedureSourceBadge({ source }: { source: ProcedureSource | null }) {
  if (!source) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-white/45">
        Unspecified
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${SOURCE_STYLES[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

// Set when the Telegram webhook ingests a procedure whose raw_content
// exactly matches one already on file — there's no human present at
// that point to confirm "Add anyway" the way the manual create form
// does, so it's created anyway and flagged for a person to review later.
export function PossibleDuplicateBadge() {
  return (
    <span
      title="Raw content matches an existing procedure"
      className="inline-flex items-center gap-1 rounded-full border border-orange-500/25 bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-orange-300"
    >
      <Copy className="h-3 w-3" />
      Possible duplicate
    </span>
  );
}
