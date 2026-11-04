import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ProjectFilters } from "@/components/projects/project-filters";
import { StageBadge } from "@/components/projects/badges";
import { createClient } from "@/lib/supabase/server";
import { STUCK_THRESHOLD_DAYS, formatDateOnly, isFollowUpDue, isStuckDeal } from "@/lib/projects";
import type { Project } from "@/lib/types";

const CLOSED_STAGES = ["closed_won", "closed_lost"];

interface ProjectsPageProps {
  searchParams: Promise<{
    product_type?: string;
    stage?: string;
    sort?: string;
    archived?: string;
    closed?: string;
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const sort = params.sort === "stage_updated_at" ? "stage_updated_at" : "follow_up_date";
  const showArchived = params.archived === "true";
  const showClosed = params.closed === "true";

  const supabase = await createClient();
  let query = supabase.from("leads").select("*").eq("archived", showArchived);

  if (params.product_type) {
    query = query.eq("product_type", params.product_type);
  }
  if (params.stage) {
    // An explicit stage filter (e.g. the Dashboard's "Closed Won this
    // month" link) always wins over the Closed toggle's default
    // inclusion/exclusion below.
    query = query.eq("stage", params.stage);
  } else if (showClosed) {
    query = query.in("stage", CLOSED_STAGES);
  } else {
    query = query.not("stage", "in", `(${CLOSED_STAGES.join(",")})`);
  }

  query =
    sort === "follow_up_date"
      ? query.order("follow_up_date", { ascending: true, nullsFirst: false })
      : query.order("stage_updated_at", { ascending: true });

  const { data: projects, error } = await query;

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );

  const title = showClosed && showArchived
    ? "Closed & Archived Projects"
    : showClosed
      ? "Closed Projects"
      : showArchived
        ? "Archived Projects"
        : "Projects";
  const subtitle = showClosed && showArchived
    ? "Archived projects that are closed won or closed lost."
    : showClosed
      ? "Projects that are closed won or closed lost."
      : showArchived
        ? "Projects that have been archived."
        : "Track and manage incoming projects.";
  const emptyTitle = showClosed && showArchived
    ? "No closed, archived projects"
    : showClosed
      ? "No closed projects"
      : showArchived
        ? "No archived projects"
        : "No projects yet";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/45">{subtitle}</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400"
        >
          <Plus className="h-4 w-4" />
          New Project
        </Link>
      </div>

      <div className="mb-4">
        <Suspense>
          <ProjectFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load projects: {error.message}
        </GlassCard>
      )}

      {!error && (!projects || projects.length === 0) && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Users className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">{emptyTitle}</p>
          <p className="max-w-xs text-xs text-white/35">
            {params.product_type || params.stage
              ? "No projects match the current filters."
              : showClosed
                ? "Projects you move to Closed Won or Closed Lost will show up here."
                : showArchived
                  ? "Projects you archive will show up here."
                  : "New projects will show up here once your pipeline is connected."}
          </p>
        </GlassCard>
      )}

      {!error && projects && projects.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Procedure Type</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {(projects as Project[]).map((project) => {
                  const stuck = isStuckDeal(project.stage, project.stage_updated_at);
                  const followUpDue = isFollowUpDue(project.follow_up_date);

                  return (
                    <ClickableRow
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className={`border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03] ${
                        stuck ? "border-l-2 border-l-amber-500/50 bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-white/80 group-hover:text-white">{project.product_type}</td>
                      <td className="px-4 py-3 text-white/70 group-hover:text-white">{project.procedure_type}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StageBadge stage={project.stage} />
                          {stuck && (
                            <span title={`No stage change in over ${STUCK_THRESHOLD_DAYS} days`}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {(project.primary_contact_id && contactNameById.get(project.primary_contact_id)) || "—"}
                      </td>
                      <td
                        className={`px-4 py-3 ${followUpDue ? "font-medium text-rose-300" : "text-white/50"}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {project.follow_up_date ? formatDateOnly(project.follow_up_date) : "—"}
                          {followUpDue && (
                            <span
                              title="Follow-up due"
                              className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400"
                            />
                          )}
                        </span>
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {(projects as Project[]).map((project) => {
              const stuck = isStuckDeal(project.stage, project.stage_updated_at);
              const followUpDue = isFollowUpDue(project.follow_up_date);

              return (
                <ClickableCard
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className={stuck ? "border-l-2 border-l-amber-500/50 bg-amber-500/[0.04]" : ""}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-white/85">{project.product_type}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <StageBadge stage={project.stage} />
                      {stuck && (
                        <span title={`No stage change in over ${STUCK_THRESHOLD_DAYS} days`}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Procedure Type
                      </dt>
                      <dd className="mt-0.5 text-white/70">{project.procedure_type}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Contact</dt>
                      <dd className="mt-0.5 text-white/70">
                        {(project.primary_contact_id && contactNameById.get(project.primary_contact_id)) || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Follow-up
                      </dt>
                      <dd
                        className={`mt-0.5 inline-flex items-center gap-1.5 ${followUpDue ? "font-medium text-rose-300" : "text-white/50"}`}
                      >
                        {project.follow_up_date ? formatDateOnly(project.follow_up_date) : "—"}
                        {followUpDue && (
                          <span
                            title="Follow-up due"
                            className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400"
                          />
                        )}
                      </dd>
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
