import Link from "next/link";
import { CalendarClock, CheckCircle2, Layers } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { createClient } from "@/lib/supabase/server";
import { STAGES, STAGE_LABELS, isClosedStatus } from "@/lib/projects";
import { PRODUCT_TYPES } from "@/lib/products";
import type { Project, ProjectStage } from "@/lib/types";

const STAGE_BAR_COLORS: Record<ProjectStage, string> = {
  new: "bg-accent/70",
  documents_received: "bg-cyan-500/70",
  match: "bg-teal-500/70",
  status: "bg-silver/70",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").is("archived_at", null);
  const projects = (data as Project[] | null) ?? [];

  const openProjects = projects.filter((project) => !isClosedStatus(project.status));

  const now = new Date();
  const completedThisMonth = projects.filter((project) => {
    if (!isClosedStatus(project.status) || project.status !== "completed") return false;
    const changed = new Date(project.last_activity_at);
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
      label: "Completed This Month",
      value: completedThisMonth,
      icon: CheckCircle2,
      tone: "text-emerald-300",
      href: "/projects?status=completed",
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <span className="w-36 shrink-0 text-sm text-white/60 group-hover:text-white/90">
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
                        className="block h-full rounded-full bg-accent/70 transition-all duration-300 ease-out"
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

        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <CalendarClock className="h-4 w-4 text-white/40" />
            Coming in Phase 3
          </h2>
          <p className="text-sm text-white/35">
            Stuck Deals and Follow-ups Due will come back here once the project timeline (next steps and
            activity tracking) exists. See AGENTS.md for the plan.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
