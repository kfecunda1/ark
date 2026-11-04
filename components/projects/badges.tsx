import { PRIORITY_LABELS, STAGE_LABELS } from "@/lib/projects";
import type { ProjectDocumentType, ProjectPriority, ProjectStage } from "@/lib/types";

const STAGE_STYLES: Record<ProjectStage, string> = {
  new: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  in_progress: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  closed_won: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  closed_lost: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export function StageBadge({ stage }: { stage: ProjectStage }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STAGE_STYLES[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

const PRIORITY_STYLES: Record<ProjectPriority, string> = {
  low: "bg-white/[0.06] text-white/50 border-white/10",
  medium: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  high: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  urgent: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export function PriorityBadge({ priority }: { priority: ProjectPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${PRIORITY_STYLES[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const DOCUMENT_TYPE_STYLES: Record<ProjectDocumentType, string> = {
  CIS: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  MOU: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  SPA: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  IMFPA: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  Other: "bg-white/[0.06] text-white/50 border-white/10",
};

export function ProjectDocumentTypeBadge({ type }: { type: ProjectDocumentType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${DOCUMENT_TYPE_STYLES[type]}`}
    >
      {type}
    </span>
  );
}
