"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Landmark, Plus, StickyNote, Upload } from "lucide-react";
import { StageBadge, StatusBadge, RecoveryBadge } from "@/components/projects/badges";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { setProjectStepDone } from "@/lib/actions/project-steps";
import { truncate } from "@/lib/format";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { ChecklistStatus } from "@/lib/checklists";
import type { ProjectStage, StatusColor } from "@/lib/types";

export interface SummaryNextStep {
  id: string;
  body: string;
  dueDate: string | null;
}

export interface SummaryTrancheStats {
  sentCount: number;
  confirmedCount: number;
  paidOutCount: number;
  // Already formatted (formatMoney) — null when there's no active
  // (confirmed, not yet paid out) amount to show.
  activeAmountLabel: string | null;
}

interface ProjectSummaryHeaderProps {
  projectId: string;
  projectName: string;
  // The final product, or "Options: X / Y" when undecided — computed
  // by the page, not here, since it already has projectProducts on
  // hand.
  productLabel: string;
  showRecoveryBadge: boolean;
  stage: ProjectStage;
  statusLabel: string | null;
  statusColor: StatusColor | null;
  totalFaceValueLabel: string;
  matchedReceiver: { id: string; label: string } | null;
  contactPersonLabel: string | null;
  checklist: ChecklistStatus;
  nextStep: SummaryNextStep | null;
  tranches: SummaryTrancheStats;
  lastActivityDaysAgo: number;
  stuckAfterDays: number;
  lang?: Lang;
}

function Chip({ tone, children }: { tone?: "amber" | "emerald" | "grey"; children: ReactNode }) {
  const toneClass =
    tone === "amber"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
      : tone === "emerald"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
        : tone === "grey"
          ? "border-white/10 bg-white/[0.03] text-white/35"
          : "border-white/10 bg-white/[0.04] text-white/70";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function lastActivityLabel(days: number, t: ReturnType<typeof getDictionary>): string {
  if (days <= 0) return t.projectSummary.today;
  return t.projectSummary.daysAgo(days);
}

// Near the very top of a project's own page (app/(app)/projects/[id]/
// page.tsx) — everything here is read from props the page already
// computed from data it fetches anyway (checklist status, tranches,
// the soonest open next step, …); the only two things this component
// does on its own are the sticky-on-scroll mini bar (IntersectionObserver
// below) and the inline "Mark done" action. Quick actions otherwise
// just navigate: #project-documents / #project-timeline are anchors
// already on those sections, and ?composer=…#project-timeline is read
// by the page to pre-open the right Timeline composer (same ?uploadType
// pattern components/projects/document-checklist-panel.tsx already uses
// for the Documents section).
export function ProjectSummaryHeader({
  projectId,
  projectName,
  productLabel,
  showRecoveryBadge,
  stage,
  statusLabel,
  statusColor,
  totalFaceValueLabel,
  matchedReceiver,
  contactPersonLabel,
  checklist,
  nextStep,
  tranches,
  lastActivityDaysAgo,
  stuckAfterDays,
  lang = "en",
}: ProjectSummaryHeaderProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [pastHeader, setPastHeader] = useState(false);
  const [isMarkingDone, startMarkingDone] = useTransition();
  const [markDoneError, setMarkDoneError] = useState<string | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setPastHeader(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleMarkDone() {
    if (!nextStep) return;
    setMarkDoneError(null);
    startMarkingDone(async () => {
      try {
        const result = await setProjectStepDone(nextStep.id, projectId, true);
        if (result.error) {
          setMarkDoneError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setMarkDoneError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  const docsVisible = checklist.hasChecklist;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5">
        {/* Line 1 — a <p>, not <h1>: the page's own title block right
            below this still carries the one semantic <h1> for the
            page. */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-lg font-semibold text-white sm:text-xl">{projectName}</p>
          <span className="text-sm text-white/50">{productLabel}</span>
          {showRecoveryBadge && <RecoveryBadge />}
          <StageBadge stage={stage} lang={lang} />
          {statusLabel && statusColor && <StatusBadge label={statusLabel} color={statusColor} />}
        </div>

        {/* Line 2 */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{totalFaceValueLabel}</Chip>
          {matchedReceiver ? (
            <Chip>
              {t.projectSummary.matchedWithPrefix}{" "}
              <Link href={`/receivers/${matchedReceiver.id}`} className="font-semibold hover:underline">
                {matchedReceiver.label}
              </Link>
            </Chip>
          ) : (
            <Chip tone="amber">
              {t.dashboard.notMatched} ·{" "}
              <Link
                href={`/projects/${projectId}?findReceivers=true#matched-with`}
                className="font-semibold underline underline-offset-2 hover:text-white"
              >
                {t.projectsList.findReceivers}
              </Link>
            </Chip>
          )}
          <Chip>{t.projectSummary.contactPerson(contactPersonLabel ?? "—")}</Chip>
          {docsVisible && (
            <Chip tone={checklist.isComplete ? "emerald" : undefined}>
              {t.projectSummary.docsCount(checklist.completeCount, checklist.totalCount)}
            </Chip>
          )}
        </div>

        {/* Line 3 */}
        <div className="flex flex-wrap items-center gap-2">
          {nextStep ? (
            <Chip>
              <CalendarClock className="h-3.5 w-3.5 text-white/40" />
              <span className="max-w-[220px] truncate">{nextStep.body}</span>
              {nextStep.dueDate && <DueDateBadge dueDate={nextStep.dueDate} lang={lang} />}
            </Chip>
          ) : (
            <Chip tone="grey">{t.projectsBoard.noNextStep}</Chip>
          )}
          <Chip>
            <Landmark className="h-3.5 w-3.5 text-white/40" />
            {t.projectSummary.tranchesSummary(
              tranches.sentCount,
              tranches.confirmedCount,
              tranches.paidOutCount,
              tranches.activeAmountLabel ? t.projectSummary.activeSuffix(tranches.activeAmountLabel) : ""
            )}
          </Chip>
          <Chip tone={lastActivityDaysAgo >= stuckAfterDays ? "amber" : undefined}>
            {t.projectSummary.lastActivity(lastActivityLabel(lastActivityDaysAgo, t))}
          </Chip>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href={`/projects/${projectId}?composer=next_step#project-timeline`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.projectSummary.nextStepAction}
          </Link>
          <Link
            href={`/projects/${projectId}?composer=note#project-timeline`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
          >
            <StickyNote className="h-3.5 w-3.5" />
            {t.projectSummary.noteAction}
          </Link>
          <Link
            href="#project-documents"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
          >
            <Upload className="h-3.5 w-3.5" />
            {t.projectSummary.upload}
          </Link>
          {nextStep && (
            <button
              type="button"
              onClick={handleMarkDone}
              disabled={isMarkingDone}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors duration-150 ease-out hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isMarkingDone ? t.projectSummary.marking : t.projectSummary.markDone}
            </button>
          )}
        </div>
        {markDoneError && <p className="text-xs text-rose-300">{markDoneError}</p>}

        <div ref={sentinelRef} />
      </div>

      {/* Desktop-only slim sticky bar — always in flow right below the
          full header above (reserving its height even while invisible)
          so showing/hiding it on scroll never shifts anything below. */}
      <div
        className={`sticky top-16 z-20 mb-6 hidden border-b border-white/[0.08] bg-[#0a0e17]/90 backdrop-blur-xl md:block ${
          pastHeader ? "visible" : "invisible"
        }`}
      >
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-1 py-2.5">
          <span className="min-w-0 truncate text-sm font-medium text-white">{projectName}</span>
          <StageBadge stage={stage} lang={lang} />
          {statusLabel && statusColor && <StatusBadge label={statusLabel} color={statusColor} />}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-white/60">
            {nextStep ? (
              <>
                <CalendarClock className="h-3.5 w-3.5 text-white/40" />
                {truncate(nextStep.body, 32)}
                {nextStep.dueDate && <DueDateBadge dueDate={nextStep.dueDate} lang={lang} />}
              </>
            ) : (
              <span className="text-white/35">{t.projectsBoard.noNextStep}</span>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
