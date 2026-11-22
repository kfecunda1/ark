"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, FileText, Landmark } from "lucide-react";
import { StatusBadge, RecoveryBadge } from "@/components/projects/badges";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { useClickableNavigate } from "@/lib/use-clickable-navigate";
import { updateProjectStage } from "@/lib/actions/projects";
import { STAGES, stageLabel } from "@/lib/projects";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { ProjectStage, StatusColor, StatusRecord } from "@/lib/types";

export interface BoardProject {
  id: string;
  name: string;
  stage: ProjectStage;
  status: string | null;
  isRecovery: boolean;
  productLabel: string;
  totalFaceValueLabel: string;
  matchedReceiver: { id: string; label: string } | null;
  nextStep: { body: string; dueDate: string } | null;
  checklist: { complete: number; total: number; isComplete: boolean } | null;
  activeTrancheCount: number;
}

interface ProjectsBoardProps {
  projects: BoardProject[];
  statuses: StatusRecord[];
  lang?: Lang;
}

// Duplicated from lib/statuses.ts rather than imported: that module
// also exports getAllStatuses/getActiveStatuses, which pull in
// lib/supabase/server (next/headers) — a client component can't import
// that file at all, even just for this one pure helper. lib/morning-
// briefing.ts keeps its own copy for the same reason.
function isClosedStatus(status: string | null, statuses: StatusRecord[]): boolean {
  if (!status) return false;
  const kind = statuses.find((s) => s.name === status)?.kind;
  return kind === "completed" || kind === "lost";
}

// True for a coarse-pointer (touch) device — dragging is desktop-only;
// touch/mobile gets the "Move to…" menu on every card instead (always
// rendered either way, see ProjectBoardCard below). Must start false
// on *every* render pass that could produce the initial HTML — the
// server (no window at all) and the client's first, pre-hydration
// pass alike — since useDraggable's `attributes` are spread onto the
// card and do show up in the DOM (role/tabIndex/aria-*); reading
// matchMedia eagerly (e.g. in a lazy useState initializer) would make
// those differ between server and client and trigger a hydration
// mismatch. The sync-after-mount effect below is the standard,
// React-docs-sanctioned "subscribing to an external store" pattern
// (see "You Might Not Need an Effect"); the still-experimental
// react-hooks/set-state-in-effect rule flags its first line anyway, so
// it's silenced deliberately rather than contorted around.
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoarse(query.matches);
    const handleChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);
  return coarse;
}

function MoveToMenu({
  projectId,
  currentStage,
  onMove,
  lang,
}: {
  projectId: string;
  currentStage: ProjectStage;
  onMove: (projectId: string, stage: ProjectStage) => void;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const t = getDictionary(lang);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.08] hover:text-white"
      >
        {t.projectsBoard.moveTo}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <ul className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
          {STAGES.filter((s) => s !== currentStage).map((s) => (
            <li
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onMove(projectId, s);
              }}
              className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
            >
              {stageLabel(s, lang)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectBoardCard({
  project,
  currentStage,
  dragEnabled,
  statusColor,
  onMove,
  lang,
}: {
  project: BoardProject;
  currentStage: ProjectStage;
  dragEnabled: boolean;
  statusColor: StatusColor | null;
  onMove: (projectId: string, stage: ProjectStage) => void;
  lang: Lang;
}) {
  const t = getDictionary(lang);
  const handleClick = useClickableNavigate(`/projects/${project.id}`);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: project.id,
    disabled: !dragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...(dragEnabled ? listeners : {})}
      {...(dragEnabled ? attributes : {})}
      onClick={handleClick}
      className={`cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 transition-colors duration-150 ease-out hover:bg-white/[0.06] ${
        isDragging ? "opacity-30" : ""
      } ${dragEnabled ? "touch-none" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-white/85">{project.name}</p>
        {project.isRecovery && <RecoveryBadge lang={lang} />}
      </div>
      <p className="mt-0.5 truncate text-xs text-white/45">{project.productLabel}</p>

      {currentStage === "status" && project.status && statusColor && (
        <div className="mt-1.5">
          <StatusBadge label={project.status} color={statusColor} />
        </div>
      )}

      <p className="mt-2 text-xs font-medium text-white/70">{project.totalFaceValueLabel}</p>

      <p className="mt-1 text-xs">
        {project.matchedReceiver ? (
          <span className="text-white/50">{t.projectsBoard.matchedWith(project.matchedReceiver.label)}</span>
        ) : (
          <span className="font-medium text-amber-300">{t.dashboard.notMatched}</span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {project.nextStep ? (
          <DueDateBadge dueDate={project.nextStep.dueDate} lang={lang} />
        ) : (
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/30">
            {t.projectsBoard.noNextStep}
          </span>
        )}
        {project.checklist && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              project.checklist.isComplete
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.04] text-white/60"
            }`}
          >
            <FileText className="h-3 w-3" />
            {project.checklist.complete}/{project.checklist.total}
          </span>
        )}
        {project.activeTrancheCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-300">
            <Landmark className="h-3 w-3" />
            {t.projectsBoard.activeCount(project.activeTrancheCount)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex justify-end" onClick={(e) => e.stopPropagation()}>
        <MoveToMenu projectId={project.id} currentStage={currentStage} onMove={onMove} lang={lang} />
      </div>
    </div>
  );
}

function ProjectBoardColumn({
  stage,
  projects,
  dragEnabled,
  statusColorByName,
  onMove,
  extraHeader,
  lang,
}: {
  stage: ProjectStage;
  // Already grouped by their *displayed* stage (prop stage, overridden
  // by any pending optimistic move) — stage itself doubles as each of
  // these cards' own currentStage for the Move to… menu.
  projects: BoardProject[];
  dragEnabled: boolean;
  statusColorByName: Map<string, StatusColor>;
  onMove: (projectId: string, stage: ProjectStage) => void;
  extraHeader?: React.ReactNode;
  lang: Lang;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !dragEnabled });
  const t = getDictionary(lang);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[280px] shrink-0 flex-col gap-3 rounded-xl border p-3 snap-start md:w-auto md:min-w-[260px] md:flex-1 ${
        isOver ? "border-accent/40 bg-accent/[0.04]" : "border-white/[0.08] bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-medium tracking-wide text-white/50 uppercase">{stageLabel(stage, lang)}</h3>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/50">
          {projects.length}
        </span>
      </div>
      {extraHeader}
      <div className="flex min-h-[60px] flex-col gap-2">
        {projects.length === 0 ? (
          <p className="px-1 text-xs text-white/30">{t.projectsBoard.noProjectsInColumn}</p>
        ) : (
          projects.map((project) => (
            <ProjectBoardCard
              key={project.id}
              project={project}
              currentStage={stage}
              dragEnabled={dragEnabled}
              statusColor={project.status ? statusColorByName.get(project.status) ?? null : null}
              onMove={onMove}
              lang={lang}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function ProjectsBoard({ projects, statuses, lang = "en" }: ProjectsBoardProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const isCoarsePointer = useCoarsePointer();
  const dragEnabled = !isCoarsePointer;

  const [pendingMoves, setPendingMoves] = useState<Map<string, ProjectStage>>(new Map());
  const [prevProjects, setPrevProjects] = useState(projects);
  const [hideClosed, setHideClosed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Fresh props (after router.refresh() below) are the real answer —
  // drop whatever optimistic overrides were covering the gap until
  // they arrived. Adjusting state during render (not an effect) is the
  // React-documented way to do this without a synchronous setState-in-
  // effect warning.
  if (projects !== prevProjects) {
    setPrevProjects(projects);
    setPendingMoves(new Map());
  }

  const statusColorByName = new Map(statuses.map((s) => [s.name, s.color]));

  function displayedStage(project: BoardProject): ProjectStage {
    return pendingMoves.get(project.id) ?? project.stage;
  }

  function handleMove(projectId: string, targetStage: ProjectStage) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || displayedStage(project) === targetStage) return;

    setError(null);
    setPendingMoves((prev) => new Map(prev).set(projectId, targetStage));

    updateProjectStage(projectId, targetStage).then((result) => {
      if (result.error) {
        setError(resolveError(result.error, lang));
        setPendingMoves((prev) => {
          const next = new Map(prev);
          next.delete(projectId);
          return next;
        });
        return;
      }
      router.refresh();
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const targetStage = event.over?.id as ProjectStage | undefined;
    if (!targetStage || !STAGES.includes(targetStage)) return;
    handleMove(String(event.active.id), targetStage);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const byStage = new Map<ProjectStage, BoardProject[]>(STAGES.map((s) => [s, []]));
  for (const project of projects) {
    const stage = displayedStage(project);
    byStage.get(stage)!.push(project);
  }

  const statusProjects = byStage.get("status")!;
  const visibleStatusProjects = hideClosed
    ? statusProjects.filter((p) => !isClosedStatus(p.status, statuses))
    : statusProjects;
  const hiddenClosedCount = statusProjects.length - visibleStatusProjects.length;

  const activeProject = activeId ? projects.find((p) => p.id === activeId) ?? null : null;

  const columns = STAGES.map((stage) => (
    <ProjectBoardColumn
      key={stage}
      stage={stage}
      projects={stage === "status" ? visibleStatusProjects : byStage.get(stage)!}
      dragEnabled={dragEnabled}
      statusColorByName={statusColorByName}
      onMove={handleMove}
      lang={lang}
      extraHeader={
        stage === "status" ? (
          <label className="flex items-center gap-1.5 px-1 text-[11px] text-white/40">
            <input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
              className="h-3 w-3 rounded border-white/20 bg-white/[0.03] accent-accent"
            />
            {t.projectsBoard.hideCompletedLost(hiddenClosedCount)}
          </label>
        ) : undefined
      }
    />
  ));

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-4 md:overflow-visible md:snap-none">
        {dragEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {columns}
            <DragOverlay>
              {activeProject ? (
                <div className="w-[260px] rounded-lg border border-accent/40 bg-[#0f1420] p-3 shadow-2xl">
                  <p className="truncate text-sm font-medium text-white/85">{activeProject.name}</p>
                  <p className="mt-0.5 truncate text-xs text-white/45">{activeProject.productLabel}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          columns
        )}
      </div>
    </div>
  );
}
