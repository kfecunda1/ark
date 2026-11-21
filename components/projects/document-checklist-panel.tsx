import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import type { ChecklistStatus } from "@/lib/checklists";

interface DocumentChecklistPanelProps {
  projectId: string;
  // The final product (once decided) or a comma-joined list of the
  // project's own options — used both for "No checklist set for <X>"
  // and the "Based on options: X, Y" annotation below.
  productLabel: string;
  status: ChecklistStatus;
  isAdmin: boolean;
}

// Near the top of a project's own page (app/(app)/projects/[id]/
// page.tsx) — a document's "Upload" shortcut is a plain link to this
// same page with ?uploadType=<type>, which components/projects/
// project-documents.tsx picks up to pre-select that type in its own
// upload form; no client-side coordination needed between the two.
export function DocumentChecklistPanel({ projectId, productLabel, status, isAdmin }: DocumentChecklistPanelProps) {
  if (!status.hasChecklist) {
    return (
      <GlassCard interactive={false} className="p-4">
        <p className="text-sm text-white/50">
          No checklist set for {productLabel}.
          {isAdmin && (
            <>
              {" "}
              <Link href="/settings#document-checklists" className="text-accent-soft hover:underline">
                Set one up in Settings
              </Link>
              .
            </>
          )}
        </p>
      </GlassCard>
    );
  }

  const completeCount = status.requiredTypes.length - status.missingTypes.length;

  return (
    <GlassCard interactive={false} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white/80">
          Documents checklist
          {status.basedOnOptions && (
            <span className="ml-2 text-xs font-normal text-white/35">Based on options: {productLabel}</span>
          )}
        </p>
        <span className={`text-xs font-medium ${status.isComplete ? "text-emerald-300" : "text-white/50"}`}>
          {completeCount} of {status.requiredTypes.length} complete
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {status.requiredTypes.map((type) => {
          const missing = status.missingTypes.includes(type);
          return (
            <span
              key={type}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                missing
                  ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {missing ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {type}
              {missing && (
                <Link
                  href={`/projects/${projectId}?uploadType=${encodeURIComponent(type)}#project-documents`}
                  className="ml-1 font-medium text-rose-200 underline underline-offset-2 hover:text-white"
                >
                  Upload
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </GlassCard>
  );
}
