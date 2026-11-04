import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Layers } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PriorityBadge, StageBadge } from "@/components/projects/badges";
import { createClient } from "@/lib/supabase/server";
import {
  STAGES,
  STAGE_LABELS,
  daysSince,
  followUpLabel,
  formatDateOnly,
  isFollowUpDue,
  isStuckDeal,
  parseDateOnly,
} from "@/lib/projects";
import { PRODUCT_TYPES } from "@/lib/products";
import type { Project, ProjectStage } from "@/lib/types";

const STAGE_BAR_COLORS: Record<ProjectStage, string> = {
  new: "bg-sky-500/70",
  in_progress: "bg-amber-500/70",
  closed_won: "bg-emerald-500/70",
  closed_lost: "bg-rose-500/70",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").select("*").eq("archived", false);
  const projects = (data as Project[] | null) ?? [];

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );
  function contactName(project: Project): string {
    return (project.primary_contact_id && contactNameById.get(project.primary_contact_id)) || "Unknown contact";
  }

  const openProjects = projects.filter((project) => project.stage !== "closed_won" && project.stage !== "closed_lost");

  const stuckProjects = projects
    .filter((project) => isStuckDeal(project.stage, project.stage_updated_at))
    .sort((a, b) => daysSince(b.stage_updated_at) - daysSince(a.stage_updated_at));

  const followUpProjects = projects
    .filter((project) => isFollowUpDue(project.follow_up_date))
    .sort(
      (a, b) => parseDateOnly(a.follow_up_date!).getTime() - parseDateOnly(b.follow_up_date!).getTime()
    );

  const now = new Date();
  const closedWonThisMonth = projects.filter((project) => {
    if (project.stage !== "closed_won") return false;
    const changed = new Date(project.stage_updated_at);
    return changed.getFullYear() === now.getFullYear() && changed.getMonth() === now.getMonth();
  }).length;

  const stageCounts = STAGES.reduce(
    (acc, stage) => {
      acc[stage] = projects.filter((project) => project.stage === stage).length;
      return acc;
    },
    {} as Record<ProjectStage, number>
  );
  const maxStageCount = Math.max(1, ...STAGES.map((stage) => stageCounts[stage]));

  const productTypeCounts = PRODUCT_TYPES.reduce(
    (acc, product) => {
      acc[product] = openProjects.filter((project) => project.product_type === product).length;
      return acc;
    },
    {} as Record<string, number>
  );
  const maxProductCount = Math.max(1, ...PRODUCT_TYPES.map((product) => productTypeCounts[product]));

  const STATS = [
    {
      label: "Total Open Projects",
      value: openProjects.length,
      icon: Layers,
      tone: "text-white",
      href: "/projects",
    },
    {
      label: "Stuck Deals",
      value: stuckProjects.length,
      icon: AlertTriangle,
      tone: stuckProjects.length > 0 ? "text-amber-300" : "text-white",
      href: "#stuck-deals",
    },
    {
      label: "Follow-ups Due",
      value: followUpProjects.length,
      icon: CalendarClock,
      tone: followUpProjects.length > 0 ? "text-rose-300" : "text-white",
      href: "#follow-ups-due",
    },
    {
      label: "Closed Won This Month",
      value: closedWonThisMonth,
      icon: CheckCircle2,
      tone: "text-emerald-300",
      href: "/projects?stage=closed_won",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-white/45">Overview of your pipeline at a glance.</p>
      </div>

      {error && (
        <GlassCard interactive={false} className="mb-6 p-6 text-sm text-rose-300">
          Failed to load projects: {error.message}
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block">
            <GlassCard className="p-6">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-white/45">{stat.label}</p>
                <stat.icon className={`h-4 w-4 ${stat.tone}`} />
              </div>
              <p className={`mt-3 text-3xl font-semibold tracking-tight ${stat.tone}`}>
                {error ? "—" : stat.value}
              </p>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">Projects by Stage</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-white/35">No projects yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {STAGES.map((stage) => {
                const count = stageCounts[stage];
                const width = count === 0 ? 0 : Math.max(4, (count / maxStageCount) * 100);
                return (
                  <Link
                    key={stage}
                    href={`/projects?stage=${stage}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-28 shrink-0 text-sm text-white/60 group-hover:text-white/90">
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className={`block h-full rounded-full transition-all duration-300 ease-out ${STAGE_BAR_COLORS[stage]}`}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm font-medium text-white/80">
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <GlassCard interactive={false} className="p-6" id="stuck-deals">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Stuck Deals
          </h2>
          {stuckProjects.length === 0 ? (
            <p className="text-sm text-white/35">No stuck deals right now.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {stuckProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/85">{contactName(project)}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {project.product_type} · <StageBadge stage={project.stage} />
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium whitespace-nowrap text-amber-300">
                    {daysSince(project.stage_updated_at)}d stuck
                  </span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard interactive={false} className="p-6" id="follow-ups-due">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <CalendarClock className="h-4 w-4 text-rose-400" />
            Follow-ups Due
          </h2>
          {followUpProjects.length === 0 ? (
            <p className="text-sm text-white/35">No follow-ups due.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {followUpProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/85">{contactName(project)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40">
                      {project.product_type}
                      <PriorityBadge priority={project.priority} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium whitespace-nowrap text-rose-300">
                      {followUpLabel(project.follow_up_date!)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      {formatDateOnly(project.follow_up_date!)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">Open Projects by Product</h2>
          {openProjects.length === 0 ? (
            <p className="text-sm text-white/35">No open projects.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {PRODUCT_TYPES.map((product) => {
                const count = productTypeCounts[product];
                const width = count === 0 ? 0 : Math.max(4, (count / maxProductCount) * 100);
                return (
                  <Link
                    key={product}
                    href={`/projects?product_type=${product}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-14 shrink-0 text-sm text-white/60 group-hover:text-white/90">
                      {product}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-indigo-500/70 transition-all duration-300 ease-out"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm font-medium text-white/80">
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
