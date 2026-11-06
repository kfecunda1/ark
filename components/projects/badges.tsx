import { PRIORITY_LABELS, STAGE_LABELS } from "@/lib/projects";
import type { ProjectDocumentType, ProjectPriority, ProjectStage, StatusColor } from "@/lib/types";

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

// The fixed ~8-color palette a status can be assigned (Settings →
// Statuses, admin only — supabase/migrations/019_statuses.sql's
// `statuses.color` check constraint lists these same 8 values). Same
// cool-leaning family as STAGE_STYLES, plus amber/rose for the kinds of
// status that warrant reading as an outcome rather than just another
// step — which specific color a given status gets is now the admin's
// choice, not fixed per status name.
export const STATUS_COLOR_STYLES: Record<StatusColor, string> = {
  accent: "bg-accent/15 text-accent-soft border-accent/25",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  teal: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  silver: "bg-white/[0.06] text-white/50 border-white/10",
  sky: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  rose: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

// A plain solid-fill dot version of the same palette — components/
// projects/status-select.tsx's inline color swatch next to the native
// <select>, which a translucent badge-shaped background would be too
// subtle to read at that size.
export const STATUS_DOT_COLORS: Record<StatusColor, string> = {
  accent: "bg-accent",
  cyan: "bg-cyan-400",
  teal: "bg-teal-400",
  silver: "bg-white/40",
  sky: "bg-sky-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};

export function StatusBadge({ label, color }: { label: string; color: StatusColor }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_COLOR_STYLES[color]}`}
    >
      {label}
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

// Deliberately its own warm color (amber), distinct from every stage/
// status/priority family above — a project being a recovery is an
// orthogonal fact about it, not another step in its own progression.
export function RecoveryBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-amber-300">
      Recovery
    </span>
  );
}

// Document types are admin-managed data now (supabase/migrations/
// 011_settings_tables.sql's document_types table), not a closed set, so
// this can no longer be an exhaustive Record — any name not in this
// fixed palette (the 8 original types, plus whatever an admin renames
// one to) falls back to DEFAULT_DOCUMENT_TYPE_STYLE below.
const DOCUMENT_TYPE_STYLES: Record<string, string> = {
  CIS: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  POF: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  DOA: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  PGL: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  JSON: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  "Proof of Fulfillment": "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  "Supporting Documents": "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "Additional Documents": "bg-white/[0.06] text-white/50 border-white/10",
};
const DEFAULT_DOCUMENT_TYPE_STYLE = "bg-white/[0.06] text-white/50 border-white/10";

export function ProjectDocumentTypeBadge({ type }: { type: ProjectDocumentType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${DOCUMENT_TYPE_STYLES[type] ?? DEFAULT_DOCUMENT_TYPE_STYLE}`}
    >
      {type}
    </span>
  );
}
