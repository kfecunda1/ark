import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { ChecklistStatus } from "@/lib/checklists";
import type { DocumentTypeRecord } from "@/lib/types";

interface DocumentChecklistPanelProps {
  projectId: string;
  // The final product (once decided) or a comma-joined list of the
  // project's own options — used both for "No checklist set for <X>"
  // and the "Based on options: X, Y" annotation below.
  productLabel: string;
  status: ChecklistStatus;
  isAdmin: boolean;
  // Optional — when given, a required type's chip shows name_es (if
  // the admin set one) instead of its plain English name, same as
  // every other catalogLabel() call site. status.requiredTypes/
  // missingTypes are bare document_type strings (the stable DB
  // value), never translated themselves — only the chip's own label
  // text changes.
  documentTypes?: DocumentTypeRecord[];
  lang?: Lang;
}

// Near the top of a project's own page (app/(app)/projects/[id]/
// page.tsx) — a document's "Upload" shortcut is a plain link to this
// same page with ?uploadType=<type>, which components/projects/
// project-documents.tsx picks up to pre-select that type in its own
// upload form; no client-side coordination needed between the two.
export function DocumentChecklistPanel({
  projectId,
  productLabel,
  status,
  isAdmin,
  documentTypes,
  lang = "en",
}: DocumentChecklistPanelProps) {
  const t = getDictionary(lang);
  const typeLabel = (type: string) => {
    const record = documentTypes?.find((dt) => dt.name === type);
    return record ? catalogLabel(record, lang) : type;
  };
  if (!status.hasChecklist) {
    return (
      <GlassCard interactive={false} className="p-4">
        <p className="text-sm text-white/50">
          {t.documentChecklist.noChecklistSetFor(productLabel)}
          {isAdmin && (
            <>
              {" "}
              <Link href="/settings#document-checklists" className="text-accent-soft hover:underline">
                {t.documentChecklist.setUpInSettings}
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
          {t.documentChecklist.title}
          {status.basedOnOptions && (
            <span className="ml-2 text-xs font-normal text-white/35">
              {t.documentChecklist.basedOnOptions(productLabel)}
            </span>
          )}
        </p>
        <span className={`text-xs font-medium ${status.isComplete ? "text-emerald-300" : "text-white/50"}`}>
          {t.documentChecklist.completeOf(completeCount, status.requiredTypes.length)}
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
              {typeLabel(type)}
              {missing && (
                <Link
                  href={`/projects/${projectId}?uploadType=${encodeURIComponent(type)}#project-documents`}
                  className="ml-1 font-medium text-rose-200 underline underline-offset-2 hover:text-white"
                >
                  {t.documentChecklist.upload}
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </GlassCard>
  );
}
