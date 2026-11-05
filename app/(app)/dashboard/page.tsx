import Link from "next/link";
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, Layers } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { FollowUpsDue, type FollowUpItem } from "@/components/dashboard/follow-ups-due";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone, formatDateTime } from "@/lib/format";
import { STAGES, STAGE_LABELS, isClosedStatus } from "@/lib/projects";
import { getAllProducts } from "@/lib/products";
import { getAppSettings } from "@/lib/app-settings";
import type { Project, ProjectStage } from "@/lib/types";

const STAGE_BAR_COLORS: Record<ProjectStage, string> = {
  new: "bg-accent/70",
  documents_received: "bg-cyan-500/70",
  match: "bg-teal-500/70",
  status: "bg-silver/70",
};

interface DashboardPageProps {
  searchParams: Promise<{ passwordChanged?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { passwordChanged } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").is("archived_at", null);
  const projects = (data as Project[] | null) ?? [];

  const openProjects = projects.filter((project) => !isClosedStatus(project.status));

  const [products, appSettings] = await Promise.all([getAllProducts(), getAppSettings()]);
  const STUCK_AFTER_MS = appSettings.stuck_after_days * 24 * 60 * 60 * 1000;

  const now = new Date();

  // "Last backup" is admin-only, both because only admins can trigger
  // one (see 007_backup_log.sql's log_backup_export) and because a
  // member has no action to take from seeing it.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = (profile as { role: string | null } | null)?.role === "admin";
  }

  let daysSinceBackup: number | null = null;
  if (isAdmin) {
    const { data: backupRow } = await supabase
      .from("activity_log")
      .select("created_at")
      .eq("entity_type", "backup")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastBackupAt = (backupRow as { created_at: string } | null)?.created_at ?? null;
    daysSinceBackup = lastBackupAt
      ? Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / 86_400_000)
      : null;
  }
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

  // All products, not just active ones — a project already set to a
  // since-hidden product must still count toward this breakdown.
  const productTypeCounts = products.reduce(
    (acc, product) => {
      acc[product.name] = openProjects.filter((project) => project.product_type === product.name).length;
      return acc;
    },
    {} as Record<string, number>
  );
  const maxProductCount = Math.max(1, ...products.map((product) => productTypeCounts[product.name]));

  // Stuck: open, not archived (already guaranteed by the `projects`
  // query above), not completed/lost, no activity in 7+ days.
  const stuckProjects = openProjects
    .filter((project) => now.getTime() - new Date(project.last_activity_at).getTime() >= STUCK_AFTER_MS)
    .sort((a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime());

  // Follow-ups due: open next steps, due today or overdue, across every
  // non-archived project.
  const todayKey = dateKeyInTimeZone(new Date().toISOString());
  let followUps: FollowUpItem[] = [];
  if (projects.length > 0) {
    const { data: stepsData } = await supabase
      .from("project_steps")
      .select("id, project_id, body, due_date")
      .in(
        "project_id",
        projects.map((p) => p.id)
      )
      .eq("kind", "next_step")
      .eq("done", false)
      .lte("due_date", todayKey)
      .order("due_date", { ascending: true });

    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
    followUps = (
      (stepsData as { id: string; project_id: string; body: string; due_date: string }[] | null) ?? []
    ).map((step) => ({
      id: step.id,
      projectId: step.project_id,
      projectName: projectNameById.get(step.project_id) ?? "Project",
      body: step.body,
      dueDate: step.due_date,
    }));
  }

  const backupTone: "ok" | "warning" | "danger" =
    daysSinceBackup === null ? "danger" : daysSinceBackup > 14 ? "danger" : daysSinceBackup > 7 ? "warning" : "ok";
  const backupLabel =
    daysSinceBackup === null
      ? "Last backup: never"
      : daysSinceBackup === 0
        ? "Last backup: today"
        : `Last backup: ${daysSinceBackup} day${daysSinceBackup === 1 ? "" : "s"} ago`;
  const BACKUP_TONE_CLASSES: Record<typeof backupTone, string> = {
    ok: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    danger: "border-red-500/25 bg-red-500/10 text-red-300",
  };

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
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-white/45">Overview of your pipeline at a glance.</p>
        </div>
        {isAdmin && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${BACKUP_TONE_CLASSES[backupTone]}`}
          >
            <Archive className="h-3.5 w-3.5" />
            {backupLabel}
          </span>
        )}
      </div>

      {passwordChanged === "1" && (
        <GlassCard
          interactive={false}
          className="mb-6 border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300"
        >
          Password changed — welcome to ARK.
        </GlassCard>
      )}

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
              {products.map((product) => {
                const count = productTypeCounts[product.name];
                const width = count === 0 ? 0 : Math.max(4, (count / maxProductCount) * 100);
                return (
                  <Link
                    key={product.id}
                    href={`/projects?product_type=${encodeURIComponent(product.name)}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-14 shrink-0 truncate text-sm text-white/60 group-hover:text-white/90">
                      {product.name}
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
            Follow-ups Due
          </h2>
          <FollowUpsDue items={followUps} />
        </GlassCard>

        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <AlertTriangle className="h-4 w-4 text-white/40" />
            Stuck Projects
          </h2>
          {stuckProjects.length === 0 ? (
            <p className="text-sm text-white/35">No stuck projects.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {stuckProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-white/80">{project.name}</span>
                  <span className="shrink-0 text-xs text-white/40">{formatDateTime(project.last_activity_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
