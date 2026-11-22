import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { ChecklistStatus, RequirementStatus } from "@/lib/checklists";
import type { DocumentTypeRecord } from "@/lib/types";

interface DocumentChecklistPanelProps {
  projectId: string;
  // The final product (once decided) or a comma-joined list of the
  // project's own options — used both for "No checklist set for <X>"
  // and the "Based on options: X, Y" annotation below.
  productLabel: string;
  status: ChecklistStatus;
  isAdmin: boolean;
  // Optional — when given, a plain document_type requirement's chip
  // (and a group requirement's member names) shows name_es (if the
  // admin set one) instead of the plain English name, same as every
  // other catalogLabel() call site. The DB-stable document_type/
  // group.name values themselves are never translated — only the
  // chip's own label text changes.
  documentTypes?: DocumentTypeRecord[];
  lang?: Lang;
}

function chipClass(satisfied: boolean): string {
  return `inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
    satisfied
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      : "border-rose-500/25 bg-rose-500/10 text-rose-300"
  }`;
}

// Near the top of a project's own page (app/(app)/projects/[id]/
// page.tsx) — a document's "Upload" shortcut is a plain link to this
// same page with ?uploadType=<type>, which components/projects/
// project-documents.tsx picks up to pre-select that type in its own
// upload form; no client-side coordination needed between the two.
// Works identically whether <type> happens to be a group's member or
// a plain requirement — the upload form has no concept of groups at
// all, just document types.
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

  function uploadLink(type: string) {
    return (
      <Link
        key={type}
        href={`/projects/${projectId}?uploadType=${encodeURIComponent(type)}#project-documents`}
        className="font-medium text-rose-200 underline underline-offset-2 hover:text-white"
      >
        {typeLabel(type)}
      </Link>
    );
  }

  function renderRequirement({ requirement, satisfied, satisfiedByType }: RequirementStatus) {
    const Icon = satisfied ? CheckCircle2 : XCircle;

    if (requirement.kind === "type") {
      return (
        <span key={requirement.documentType} className={chipClass(satisfied)}>
          <Icon className="h-3.5 w-3.5" />
          {typeLabel(requirement.documentType)}
          {!satisfied && (
            <>
              {" "}
              {uploadLink(requirement.documentType)}
            </>
          )}
        </span>
      );
    }

    const groupLabel = catalogLabel({ name: requirement.group.name, name_es: requirement.group.nameEs }, lang);
    return (
      <span key={`group:${requirement.group.id}`} className={chipClass(satisfied)}>
        <Icon className="h-3.5 w-3.5" />
        {satisfied && satisfiedByType ? (
          <>
            {groupLabel} ({typeLabel(satisfiedByType)})
          </>
        ) : (
          <>
            {t.documentChecklist.groupMissingPrefix(groupLabel)}{" "}
            {requirement.group.memberTypes.map((type: string, index: number) => (
              <span key={type}>
                {index > 0 && " / "}
                {uploadLink(type)}
              </span>
            ))}
          </>
        )}
      </span>
    );
  }

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
          {t.documentChecklist.completeOf(status.completeCount, status.totalCount)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{status.requirements.map(renderRequirement)}</div>
    </GlassCard>
  );
}
