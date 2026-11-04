import Link from "next/link";
import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ProjectFilters } from "@/components/projects/project-filters";
import { StageBadge } from "@/components/projects/badges";
import { StatusSelect } from "@/components/projects/status-select";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { Project } from "@/lib/types";

interface ProjectsPageProps {
  searchParams: Promise<{
    product_type?: string;
    stage?: string;
    status?: string;
    sort?: string;
    archived?: string;
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const sort = params.sort === "created_at" ? "created_at" : "last_activity_at";
  const showArchived = params.archived === "true";

  const supabase = await createClient();
  let query = supabase.from("projects").select("*");
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  if (params.product_type) {
    query = query.eq("product_type", params.product_type);
  }
  if (params.stage) {
    query = query.eq("stage", params.stage);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }

  query =
    sort === "created_at"
      ? query.order("created_at", { ascending: true })
      : query.order("last_activity_at", { ascending: false });

  const { data: projects, error } = await query;

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );

  const title = showArchived ? "Archived Projects" : "Projects";
  const subtitle = showArchived ? "Projects that have been archived." : "Track and manage incoming projects.";
  const emptyTitle = showArchived ? "No archived projects" : "No projects yet";
  const filtered = Boolean(params.product_type || params.stage || params.status);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/45">{subtitle}</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
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
            {filtered
              ? "No projects match the current filters."
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
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {(projects as Project[]).map((project) => (
                  <ClickableRow
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 text-white/80 group-hover:text-white">{project.name}</td>
                    <td className="px-4 py-3 text-white/70 group-hover:text-white">{project.product_type}</td>
                    <td className="px-4 py-3">
                      <StageBadge stage={project.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusSelect projectId={project.id} currentStatus={project.status} />
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {(project.client_contact_id && contactNameById.get(project.client_contact_id)) || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/50">{formatDateTime(project.last_activity_at)}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {(projects as Project[]).map((project) => (
              <ClickableCard key={project.id} href={`/projects/${project.id}`}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-white/85">{project.name}</span>
                  <StageBadge stage={project.stage} />
                </div>

                <dl className="flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Product</dt>
                    <dd className="mt-0.5 text-white/70">{project.product_type}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Status</dt>
                    <dd className="mt-0.5">
                      <StatusSelect projectId={project.id} currentStatus={project.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Client</dt>
                    <dd className="mt-0.5 text-white/70">
                      {(project.client_contact_id && contactNameById.get(project.client_contact_id)) || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                      Last Activity
                    </dt>
                    <dd className="mt-0.5 text-white/50">{formatDateTime(project.last_activity_at)}</dd>
                  </div>
                </dl>
              </ClickableCard>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
