import { PRIORITY_LABELS, STAGE_LABELS, STATUS_LABELS } from "@/lib/projects";
import type { ProjectDocumentType, ProjectPriority, ProjectStage, ProjectStatus } from "@/lib/types";

// A coherent cool palette — steel blue, cyan, teal, silver-grey — so
// each stage reads distinctly without reaching for a warm color.
const STAGE_STYLES: Record<ProjectStage, string> = {
  new: "bg-accent/15 text-accent-soft border-accent/25",
  documents_received: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  match: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  status: "bg-silver/15 text-white/70 border-silver/25",
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

// Same cool family as STAGE_STYLES for everything in progress, with the
// two deliberate exceptions: Completed stays green, Lost stays red —
// those two are outcomes, not just another step, and warrant reading
// differently from the rest at a glance.
const STATUS_STYLES: Record<ProjectStatus, string> = {
  open: "bg-accent/15 text-accent-soft border-accent/25",
  with_receiver: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  with_sender: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  waiting: "bg-white/[0.06] text-white/50 border-white/10",
  in_process: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lost: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// Priority keeps a severity gradient rather than the cool-only palette
// above — low/medium stay in the same steel-blue family, but high/
// urgent are deliberately warm, since an escalating grey/blue -> amber ->
// red read is the whole point of a priority badge.
const PRIORITY_STYLES: Record<ProjectPriority, string> = {
  low: "bg-white/[0.06] text-white/50 border-white/10",
  medium: "bg-accent/15 text-accent-soft border-accent/25",
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
  POF: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  DOA: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  PGL: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  JSON: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  "Proof of Fulfillment": "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  "Supporting Documents": "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "Additional Documents": "bg-white/[0.06] text-white/50 border-white/10",
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
