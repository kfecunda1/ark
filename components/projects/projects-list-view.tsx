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
import { SortableHeader, MobileSortControl, type SortOption } from "@/components/sort-controls";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getProjectProductsByProjectIds, countedProducts, displayProduct } from "@/lib/project-products";
import { compareNullsLast, parseSortDirection } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STAGES, STATUSES } from "@/lib/projects";
import { personLabel } from "@/lib/people";
import type { Person, Project, ProjectStatus, ProjectStep } from "@/lib/types";

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

const SORT_OPTIONS: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "product", label: "Product" },
  { value: "stage", label: "Stage" },
  { value: "status", label: "Status" },
  { value: "total_face_value", label: "Total face value" },
  { value: "next_step_due", label: "Next step due" },
  { value: "last_activity_at", label: "Last activity" },
  { value: "created_at", label: "Created" },
];

export interface ProjectsListSearchParams {
  product_type?: string;
  stage?: string;
  status?: string;
  intermediary?: string;
  sort?: string;
  dir?: string;
  archived?: string;
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
  const sort: ProjectSortKey = isProjectSortKey(params.sort) ? params.sort : "next_step_due";
  const dir = parseSortDirection(params.dir);
  const showArchived = params.archived === "true";

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

  const products = await getAllProducts();
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
      personLabel(p) + (p.archived_at ? " (Archived)" : ""),
    ])
  );

  // Counted under its final product once there is one, otherwise under
  // every option — same rule the Dashboard's breakdown uses.
  if (params.product_type) {
    projects = projects.filter((p) =>
      countedProducts(p.final_product, projectProductsByProjectId.get(p.id) ?? []).includes(params.product_type!)
    );
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
    .map((p) => ({ id: p.id, label: personLabel(p) + (p.archived_at ? " (Archived)" : "") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (params.intermediary) {
    const allowedProjectIds = projectIdsByIntermediaryPerson.get(params.intermediary) ?? new Set<string>();
    projects = projects.filter((p) => allowedProjectIds.has(p.id));
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
        return project.status ? STATUSES.indexOf(project.status as ProjectStatus) : null;
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

  const noun = isRecovery ? "recovery projects" : "projects";
  const title = showArchived
    ? isRecovery
      ? "Archived Recovery Projects"
      : "Archived Projects"
    : isRecovery
      ? "Recovery Projects"
      : "Projects";
  const subtitle = showArchived
    ? `${isRecovery ? "Recovery projects" : "Projects"} that have been archived.`
    : isRecovery
      ? "Track and manage recovery projects."
      : "Track and manage incoming projects.";
  const emptyTitle = showArchived ? `No archived ${noun}` : isRecovery ? "No recovery projects yet" : "No projects yet";
  const filtered = Boolean(params.product_type || params.stage || params.status || params.intermediary);
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
          New Project
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Suspense>
          <ProjectFilters products={products} intermediaries={intermediaryFilterOptions} />
          <MobileSortControl options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load {noun}: {error.message}
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
              ? `No ${noun} match the current filters.`
              : showArchived
                ? `${isRecovery ? "Recovery projects" : "Projects"} you archive will show up here.`
                : isRecovery
                  ? "Recovery projects will show up here once you have one."
                  : "New projects will show up here once your pipeline is connected."}
          </p>
        </GlassCard>
      )}

      {!error && projects.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <SortableHeader sortKey="name" label="Name" currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="product" label="Product" currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="stage" label="Stage" currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="status" label="Status" currentSort={sort} currentDir={dir} />
                  <th className="px-4 py-3 font-medium">Contact Person Project</th>
                  <SortableHeader
                    sortKey="total_face_value"
                    label="Total Face Value"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader sortKey="next_step_due" label="Next Step" currentSort={sort} currentDir={dir} />
                  <SortableHeader
                    sortKey="last_activity_at"
                    label="Last Activity"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader
                    sortKey="created_at"
                    label="Created"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
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
                          {project.is_recovery && <RecoveryBadge />}
                          <span>
                            {productLabel ?? "—"}
                            {!project.final_product && options.length > 1 && (
                              <span className="ml-1.5 text-xs text-white/35">(+{options.length - 1})</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StageBadge stage={project.stage} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusSelect projectId={project.id} currentStatus={project.status} />
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
                              <DueDateBadge dueDate={nextStepByProjectId.get(project.id)!.due_date!} />
                            )}
                          </div>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/50">{formatDateTime(project.last_activity_at)}</td>
                      <td className="px-4 py-3 text-white/50">{formatDateTime(project.created_at)}</td>
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
                    <StageBadge stage={project.stage} />
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Product</dt>
                      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-white/70">
                        {project.is_recovery && <RecoveryBadge />}
                        <span>
                          {productLabel ?? "—"}
                          {!project.final_product && options.length > 1 && (
                            <span className="ml-1.5 text-xs text-white/35">(+{options.length - 1})</span>
                          )}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Status</dt>
                      <dd className="mt-0.5">
                        <StatusSelect projectId={project.id} currentStatus={project.status} />
                      </dd>
                    </div>
                    {project.contact_person_id && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                          Contact Person Project
                        </dt>
                        <dd className="mt-0.5 text-white/70">
                          {contactPersonNameById.get(project.contact_person_id) ?? "—"}
                        </dd>
                      </div>
                    )}
                    {project.total_face_value != null && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                          Total Face Value
                        </dt>
                        <dd className="mt-0.5 text-white/70">
                          {formatMoney(project.total_face_value, project.currency)}
                        </dd>
                      </div>
                    )}
                    {nextStepByProjectId.has(project.id) && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Next Step</dt>
                        <dd className="mt-0.5 flex flex-col gap-1">
                          <span className="text-white/70">{nextStepByProjectId.get(project.id)!.body}</span>
                          {nextStepByProjectId.get(project.id)!.due_date && (
                            <DueDateBadge dueDate={nextStepByProjectId.get(project.id)!.due_date!} />
                          )}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Last Activity
                      </dt>
                      <dd className="mt-0.5 text-white/50">{formatDateTime(project.last_activity_at)}</dd>
                    </div>
                  </dl>
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
