import Link from "next/link";
import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ProjectFilters } from "@/components/projects/project-filters";
import { StageBadge, RecoveryBadge } from "@/components/projects/badges";
import { StatusSelect } from "@/components/projects/status-select";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { ViewToggle } from "@/components/projects/view-toggle";
import { ProjectsBoard, type BoardProject } from "@/components/projects/projects-board";
import { SortableHeader, MobileSortControl, type SortOption } from "@/components/sort-controls";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getAllStatuses, isClosedStatus } from "@/lib/statuses";
import { getAppSettings } from "@/lib/app-settings";
import { getProjectProductsByProjectIds, countedProducts, displayProduct } from "@/lib/project-products";
import { computeChecklistStatus, getRequiredDocumentsByProduct, type ChecklistStatus } from "@/lib/checklists";
import { compareNullsLast, parseSortDirection } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STAGES } from "@/lib/projects";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Person, Project, ProjectStep } from "@/lib/types";

const PROJECT_SORT_KEYS = [
  "name",
  "product",
  "stage",
  "status",
  "total_face_value",
  "next_step_due",
  "last_activity_at",
  "created_at",
] as const;
type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

function isProjectSortKey(value: string | undefined): value is ProjectSortKey {
  return (PROJECT_SORT_KEYS as readonly string[]).includes(value ?? "");
}

function sortOptions(t: ReturnType<typeof getDictionary>): SortOption[] {
  return [
    { value: "name", label: t.projectsList.colName },
    { value: "product", label: t.projectsList.colProduct },
    { value: "stage", label: t.projectsList.colStage },
    { value: "status", label: t.projectsList.colStatus },
    { value: "total_face_value", label: t.projectsList.colTotalFaceValue },
    { value: "next_step_due", label: t.projectsList.colNextStep },
    { value: "last_activity_at", label: t.projectsList.colLastActivity },
    { value: "created_at", label: t.projectsList.colCreated },
  ];
}

export interface ProjectsListSearchParams {
  product_type?: string;
  stage?: string;
  status?: string;
  intermediary?: string;
  active_tranches?: string;
  unmatched?: string;
  missing_documents?: string;
  sort?: string;
  dir?: string;
  archived?: string;
  view?: string;
}

interface ProjectsListViewProps {
  searchParams: ProjectsListSearchParams;
  // The whole reason /projects and /recovery (app/(app)/recovery/
  // page.tsx) share this one component instead of each having their
  // own copy: everything here is identical except which half of the
  // same `projects` table (is_recovery) it's scoped to, and the few
  // bits of copy that say so.
  isRecovery: boolean;
}

// Shared by app/(app)/projects/page.tsx (isRecovery: false) and
// app/(app)/recovery/page.tsx (isRecovery: true) — same list, same
// filters/sort, same columns; only the `is_recovery` scope and the
// page copy (title, empty state, "New Project" link) differ. There is
// no "All / Recovery only / Exclude recovery" filter here anymore —
// which tab you're on *is* that filter now.
export async function ProjectsListView({ searchParams: params, isRecovery }: ProjectsListViewProps) {
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const SORT_OPTIONS = sortOptions(t);
  const sort: ProjectSortKey = isProjectSortKey(params.sort) ? params.sort : "next_step_due";
  const dir = parseSortDirection(params.dir);
  const showArchived = params.archived === "true";
  const appSettings = await getAppSettings();
  // The Board toggle itself always shows on /projects; on /recovery it
  // only shows (and ?view=board only takes effect) when Settings →
  // Defaults' "Show Recovery" switch is on — same gate every other
  // recovery-only piece of UI already respects.
  const showViewToggle = !isRecovery || appSettings.show_recovery;
  const view = showViewToggle && params.view === "board" ? "board" : "list";

  const supabase = await createClient();
  let query = supabase.from("projects").select("*").eq("is_recovery", isRecovery);
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  if (params.stage) {
    query = query.eq("stage", params.stage);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data: projectsData, error } = await query.order("created_at", { ascending: false });
  let projects = (projectsData as Project[] | null) ?? [];

  const [products, statuses] = await Promise.all([getAllProducts(), getAllStatuses()]);
  const statusByName = new Map(statuses.map((s) => [s.name, s]));
  const projectProductsByProjectId = await getProjectProductsByProjectIds(projects.map((p) => p.id));

  // Optional "Contact Person Project" column — only fetched for the
  // people actually linked to a project on this page.
  const contactPersonIds = [...new Set(projects.map((p) => p.contact_person_id).filter((id): id is string => Boolean(id)))];
  const { data: contactPeopleData } =
    contactPersonIds.length > 0
      ? await supabase.from("people").select("id, first_name, last_name, archived_at").in("id", contactPersonIds)
      : { data: [] };
  const contactPersonNameById = new Map(
    ((contactPeopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? []).map((p) => [
      p.id,
      personLabel(p) + (p.archived_at ? ` (${t.common.archived})` : ""),
    ])
  );

  // Counted under its final product once there is one, otherwise under
  // every option — same rule the Dashboard's breakdown uses.
  if (params.product_type) {
    projects = projects.filter((p) =>
      countedProducts(p.final_product, projectProductsByProjectId.get(p.id) ?? []).includes(params.product_type!)
    );
  }

  // "Not matched" filter (Dashboard's own card) — no matched receiver
  // yet. Works the same on /recovery as on /projects.
  if (params.unmatched === "true") {
    projects = projects.filter((p) => !p.matched_contact_id);
  }

  // "Intermediary" filter — every person who appears in at least one
  // project's intermediary chain, system-wide (not just among the
  // projects already on this page, same "every product, not just the
  // ones in use here" reasoning the product filter's own options
  // list follows), plus which projects each one maps to for filtering.
  const { data: allIntermediariesData } = await supabase.from("project_intermediaries").select("project_id, person_id");
  const allIntermediaries = (allIntermediariesData as { project_id: string; person_id: string }[] | null) ?? [];
  const projectIdsByIntermediaryPerson = new Map<string, Set<string>>();
  for (const row of allIntermediaries) {
    const set = projectIdsByIntermediaryPerson.get(row.person_id) ?? new Set<string>();
    set.add(row.project_id);
    projectIdsByIntermediaryPerson.set(row.person_id, set);
  }
  const intermediaryPersonIds = [...projectIdsByIntermediaryPerson.keys()];
  const { data: intermediaryPeopleData } =
    intermediaryPersonIds.length > 0
      ? await supabase.from("people").select("id, first_name, last_name, archived_at").in("id", intermediaryPersonIds)
      : { data: [] };
  const intermediaryFilterOptions = (
    (intermediaryPeopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? []
  )
    .map((p) => ({ id: p.id, label: personLabel(p) + (p.archived_at ? ` (${t.common.archived})` : "") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (params.intermediary) {
    const allowedProjectIds = projectIdsByIntermediaryPerson.get(params.intermediary) ?? new Set<string>();
    projects = projects.filter((p) => allowedProjectIds.has(p.id));
  }

  // "Active Tranches" filter — a confirmed, not-yet-paid-out tranche
  // on a project that's open (not archived, not completed/lost), same
  // definition as the Dashboard's Active Tranches card/row (app/(app)/
  // dashboard/page.tsx). Only queried when the filter is actually on,
  // since every other filter above works off columns already on
  // `projects` itself.
  if (params.active_tranches === "true") {
    const { data: activeTrancheRows } = await supabase
      .from("project_tranches")
      .select("project_id")
      .not("confirmed_on", "is", null)
      .is("paid_out_on", null);
    const activeTrancheProjectIds = new Set(
      ((activeTrancheRows as { project_id: string }[] | null) ?? []).map((t) => t.project_id)
    );
    projects = projects.filter(
      (p) => activeTrancheProjectIds.has(p.id) && !p.archived_at && !isClosedStatus(p.status, statuses)
    );
  }

  // Document checklist per project (lib/checklists.ts) — the "Docs"
  // column and the "Missing documents" filter below both read this
  // same map, computed for whatever `projects` already survived every
  // other filter above.
  const requiredByProduct = await getRequiredDocumentsByProduct(supabase);
  const { data: checklistDocsData } =
    projects.length > 0
      ? await supabase.from("project_documents").select("project_id, document_type").in(
          "project_id",
          projects.map((p) => p.id)
        )
      : { data: [] as { project_id: string; document_type: string }[] };
  const documentTypesByProjectId = new Map<string, Set<string>>();
  for (const row of (checklistDocsData as { project_id: string; document_type: string }[] | null) ?? []) {
    const set = documentTypesByProjectId.get(row.project_id) ?? new Set<string>();
    set.add(row.document_type);
    documentTypesByProjectId.set(row.project_id, set);
  }
  const checklistStatusByProjectId = new Map<string, ChecklistStatus>(
    projects.map((p) => [
      p.id,
      computeChecklistStatus(
        p.final_product,
        projectProductsByProjectId.get(p.id)?.map((o) => o.product) ?? [],
        requiredByProduct,
        documentTypesByProjectId.get(p.id) ?? new Set<string>()
      ),
    ])
  );

  // "Missing documents" filter — a checklist exists for this project
  // but isn't complete yet.
  if (params.missing_documents === "true") {
    projects = projects.filter((p) => {
      const status = checklistStatusByProjectId.get(p.id);
      return status?.hasChecklist && !status.isComplete;
    });
  }

  // Earliest open next step per project — "open" meaning not yet done.
  const nextStepByProjectId = new Map<string, Pick<ProjectStep, "body" | "due_date">>();
  if (projects.length > 0) {
    const { data: stepsData } = await supabase
      .from("project_steps")
      .select("project_id, body, due_date")
      .in(
        "project_id",
        projects.map((p) => p.id)
      )
      .eq("kind", "next_step")
      .eq("done", false)
      .order("due_date", { ascending: true });

    for (const step of (stepsData as Pick<ProjectStep, "project_id" | "body" | "due_date">[] | null) ?? []) {
      if (!nextStepByProjectId.has(step.project_id)) {
        nextStepByProjectId.set(step.project_id, { body: step.body, due_date: step.due_date });
      }
    }
  }

  // Board-only data (components/projects/projects-board.tsx) — matched
  // receiver names and active-tranche counts aren't needed by the List
  // view at all, so these two only run when there's actually a board
  // to feed.
  let matchedContactNameById = new Map<string, string>();
  const activeTrancheCountByProjectId = new Map<string, number>();
  if (view === "board" && projects.length > 0) {
    const matchedContactIds = [
      ...new Set(projects.map((p) => p.matched_contact_id).filter((id): id is string => Boolean(id))),
    ];
    const [{ data: matchedContactsData }, { data: boardTranchesData }] = await Promise.all([
      matchedContactIds.length > 0
        ? supabase.from("contacts").select("id, full_name").in("id", matchedContactIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      supabase
        .from("project_tranches")
        .select("project_id")
        .not("confirmed_on", "is", null)
        .is("paid_out_on", null)
        .in(
          "project_id",
          projects.map((p) => p.id)
        ),
    ]);
    matchedContactNameById = new Map(
      ((matchedContactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
    );
    for (const row of (boardTranchesData as { project_id: string }[] | null) ?? []) {
      activeTrancheCountByProjectId.set(row.project_id, (activeTrancheCountByProjectId.get(row.project_id) ?? 0) + 1);
    }
  }

  function sortValue(project: Project, key: ProjectSortKey): number | string | null {
    switch (key) {
      case "name":
        return project.name.toLowerCase();
      case "product": {
        const value = displayProduct(project.final_product, projectProductsByProjectId.get(project.id) ?? []);
        return value ? value.toLowerCase() : null;
      }
      case "stage":
        return STAGES.indexOf(project.stage);
      case "status":
        return project.status ? statusByName.get(project.status)?.sort_order ?? null : null;
      case "total_face_value":
        return project.total_face_value;
      case "next_step_due":
        return nextStepByProjectId.get(project.id)?.due_date ?? null;
      case "last_activity_at":
        return project.last_activity_at;
      case "created_at":
        return project.created_at;
    }
  }

  projects = [...projects].sort((a, b) => compareNullsLast(a, b, (p) => sortValue(p, sort), dir));

  const boardProjects: BoardProject[] =
    view === "board"
      ? projects.map((p) => {
          const options = projectProductsByProjectId.get(p.id) ?? [];
          const checklist = checklistStatusByProjectId.get(p.id);
          const nextStep = nextStepByProjectId.get(p.id);
          return {
            id: p.id,
            name: p.name,
            stage: p.stage,
            status: p.status,
            isRecovery: p.is_recovery,
            productLabel: p.final_product ?? `Options: ${options.map((o) => o.product).join("/")}`,
            totalFaceValueLabel: formatMoney(p.total_face_value, p.currency),
            matchedReceiver: p.matched_contact_id
              ? { id: p.matched_contact_id, label: matchedContactNameById.get(p.matched_contact_id) ?? "Receiver" }
              : null,
            nextStep: nextStep?.due_date ? { body: nextStep.body, dueDate: nextStep.due_date } : null,
            checklist:
              checklist && checklist.hasChecklist
                ? {
                    complete: checklist.requiredTypes.length - checklist.missingTypes.length,
                    total: checklist.requiredTypes.length,
                    isComplete: checklist.isComplete,
                  }
                : null,
            activeTrancheCount: activeTrancheCountByProjectId.get(p.id) ?? 0,
          };
        })
      : [];

  const noun = isRecovery ? t.projectsList.recoveryProjectsNoun : t.projectsList.projectsNoun;
  const singularNoun = lang === "es" ? (isRecovery ? "proyecto de recuperación" : "proyecto") : noun;
  const title = showArchived
    ? isRecovery
      ? t.projectsList.archivedRecoveryTitle
      : t.projectsList.archivedTitle
    : isRecovery
      ? t.projectsList.recoveryTitle
      : t.projectsList.title;
  const subtitle = showArchived
    ? isRecovery
      ? t.projectsList.subtitleArchivedRecovery
      : t.projectsList.subtitleArchivedProjects
    : isRecovery
      ? t.projectsList.subtitleRecovery
      : t.projectsList.subtitleProjects;
  const emptyTitle = showArchived
    ? t.projectsList.noArchivedProjects(noun)
    : isRecovery
      ? t.projectsList.noRecoveryProjectsYet
      : t.projectsList.noProjectsYet;
  const filtered = Boolean(
    params.product_type ||
      params.stage ||
      params.status ||
      params.intermediary ||
      params.active_tranches === "true" ||
      params.unmatched === "true" ||
      params.missing_documents === "true"
  );
  const newProjectHref = isRecovery ? "/projects/new?recovery=true" : "/projects/new";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/45">{subtitle}</p>
        </div>
        <Link
          href={newProjectHref}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          {t.projectsList.newProject}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Suspense>
          <div className="flex flex-wrap items-center gap-3">
            <ProjectFilters products={products} statuses={statuses} intermediaries={intermediaryFilterOptions} lang={lang} />
            {view !== "board" && (
              <MobileSortControl options={SORT_OPTIONS} currentSort={sort} currentDir={dir} lang={lang} />
            )}
          </div>
          {showViewToggle && <ViewToggle lang={lang} />}
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          {t.projectsList.failedToLoad(noun, error.message)}
        </GlassCard>
      )}

      {!error && projects.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Users className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">{emptyTitle}</p>
          <p className="max-w-xs text-xs text-white/35">
            {filtered
              ? t.projectsList.noMatchFiltered(lang === "es" ? singularNoun : noun)
              : showArchived
                ? isRecovery
                  ? t.projectsList.archivedWillShowHereRecovery
                  : t.projectsList.archivedWillShowHereProjects
                : isRecovery
                  ? t.projectsList.recoveryWillShowHere
                  : t.projectsList.newWillShowHere}
          </p>
        </GlassCard>
      )}

      {!error && projects.length > 0 && view === "board" && (
        <ProjectsBoard projects={boardProjects} statuses={statuses} lang={lang} />
      )}

      {!error && projects.length > 0 && view !== "board" && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <SortableHeader sortKey="name" label={t.projectsList.colName} currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="product" label={t.projectsList.colProduct} currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="stage" label={t.projectsList.colStage} currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="status" label={t.projectsList.colStatus} currentSort={sort} currentDir={dir} />
                  <th className="px-4 py-3 font-medium">{t.projectsList.colDocs}</th>
                  <th className="px-4 py-3 font-medium">{t.projectsList.colContactPersonProject}</th>
                  <SortableHeader
                    sortKey="total_face_value"
                    label={t.projectsList.colTotalFaceValue}
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader sortKey="next_step_due" label={t.projectsList.colNextStep} currentSort={sort} currentDir={dir} />
                  <SortableHeader
                    sortKey="last_activity_at"
                    label={t.projectsList.colLastActivity}
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader
                    sortKey="created_at"
                    label={t.projectsList.colCreated}
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const options = projectProductsByProjectId.get(project.id) ?? [];
                  const productLabel = displayProduct(project.final_product, options);
                  return (
                    <ClickableRow
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 text-white/80 group-hover:text-white">{project.name}</td>
                      <td className="px-4 py-3 text-white/70 group-hover:text-white">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {project.is_recovery && <RecoveryBadge lang={lang} />}
                          <span>
                            {productLabel ?? "—"}
                            {!project.final_product && options.length > 1 && (
                              <span className="ml-1.5 text-xs text-white/35">(+{options.length - 1})</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StageBadge stage={project.stage} lang={lang} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusSelect projectId={project.id} currentStatus={project.status} statuses={statuses} />
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const checklist = checklistStatusByProjectId.get(project.id);
                          if (!checklist?.hasChecklist) return <span className="text-white/30">—</span>;
                          const complete = checklist.requiredTypes.length - checklist.missingTypes.length;
                          return (
                            <span
                              title={
                                checklist.missingTypes.length > 0
                                  ? t.projectsList.missingLabel(checklist.missingTypes.join(", "))
                                  : t.projectsList.complete
                              }
                              className={`font-medium ${checklist.isComplete ? "text-emerald-300" : "text-white/60"}`}
                            >
                              {complete}/{checklist.requiredTypes.length}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {project.contact_person_id ? contactPersonNameById.get(project.contact_person_id) ?? "—" : "—"}
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {formatMoney(project.total_face_value, project.currency)}
                      </td>
                      <td className="px-4 py-3">
                        {nextStepByProjectId.has(project.id) ? (
                          <div className="flex flex-col gap-1">
                            <span className="max-w-[200px] truncate text-white/70">
                              {nextStepByProjectId.get(project.id)!.body}
                            </span>
                            {nextStepByProjectId.get(project.id)!.due_date && (
                              <DueDateBadge dueDate={nextStepByProjectId.get(project.id)!.due_date!} lang={lang} />
                            )}
                          </div>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/50">{formatDateTime(project.last_activity_at, lang)}</td>
                      <td className="px-4 py-3 text-white/50">{formatDateTime(project.created_at, lang)}</td>
                      <td className="px-4 py-3">
                        {!project.matched_contact_id && (
                          <Link
                            href={`/projects/${project.id}?findReceivers=true`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:underline"
                          >
                            <Users className="h-3.5 w-3.5" />
                            {t.projectsList.findReceivers}
                          </Link>
                        )}
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {projects.map((project) => {
              const options = projectProductsByProjectId.get(project.id) ?? [];
              const productLabel = displayProduct(project.final_product, options);
              return (
                <ClickableCard key={project.id} href={`/projects/${project.id}`}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-white/85">{project.name}</span>
                    <StageBadge stage={project.stage} lang={lang} />
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">{t.projectsList.colProduct}</dt>
                      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-white/70">
                        {project.is_recovery && <RecoveryBadge lang={lang} />}
                        <span>
                          {productLabel ?? "—"}
                          {!project.final_product && options.length > 1 && (
                            <span className="ml-1.5 text-xs text-white/35">(+{options.length - 1})</span>
                          )}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">{t.projectsList.colStatus}</dt>
                      <dd className="mt-0.5">
                        <StatusSelect projectId={project.id} currentStatus={project.status} statuses={statuses} />
                      </dd>
                    </div>
                    {checklistStatusByProjectId.get(project.id)?.hasChecklist && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">{t.projectsList.colDocs}</dt>
                        <dd className="mt-0.5">
                          {(() => {
                            const checklist = checklistStatusByProjectId.get(project.id)!;
                            const complete = checklist.requiredTypes.length - checklist.missingTypes.length;
                            return (
                              <span
                                title={
                                  checklist.missingTypes.length > 0
                                    ? t.projectsList.missingLabel(checklist.missingTypes.join(", "))
                                    : t.projectsList.complete
                                }
                                className={`font-medium ${checklist.isComplete ? "text-emerald-300" : "text-white/70"}`}
                              >
                                {complete}/{checklist.requiredTypes.length}
                              </span>
                            );
                          })()}
                        </dd>
                      </div>
                    )}
                    {project.contact_person_id && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                          {t.projectsList.colContactPersonProject}
                        </dt>
                        <dd className="mt-0.5 text-white/70">
                          {contactPersonNameById.get(project.contact_person_id) ?? "—"}
                        </dd>
                      </div>
                    )}
                    {project.total_face_value != null && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                          {t.projectsList.colTotalFaceValue}
                        </dt>
                        <dd className="mt-0.5 text-white/70">
                          {formatMoney(project.total_face_value, project.currency)}
                        </dd>
                      </div>
                    )}
                    {nextStepByProjectId.has(project.id) && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">{t.projectsList.colNextStep}</dt>
                        <dd className="mt-0.5 flex flex-col gap-1">
                          <span className="text-white/70">{nextStepByProjectId.get(project.id)!.body}</span>
                          {nextStepByProjectId.get(project.id)!.due_date && (
                            <DueDateBadge dueDate={nextStepByProjectId.get(project.id)!.due_date!} lang={lang} />
                          )}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        {t.projectsList.colLastActivity}
                      </dt>
                      <dd className="mt-0.5 text-white/50">{formatDateTime(project.last_activity_at, lang)}</dd>
                    </div>
                  </dl>

                  {!project.matched_contact_id && (
                    <Link
                      href={`/projects/${project.id}?findReceivers=true`}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:underline"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {t.projectsList.findReceivers}
                    </Link>
                  )}
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
