import Link from "next/link";
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, Inbox, Landmark, Layers, RotateCcw, Unlink } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { RecoveryBadge } from "@/components/projects/badges";
import { DueTodayAndOverdue, type DueItem } from "@/components/dashboard/due-today";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { CURRENCIES, STAGES, daysSince, formatDateOnly, stageLabel } from "@/lib/projects";
import { getAllProducts } from "@/lib/products";
import { getAllStatuses, isClosedStatus } from "@/lib/statuses";
import { countedProducts, getProjectProductsByProjectIds } from "@/lib/project-products";
import { getAppSettings } from "@/lib/app-settings";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import { projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import type { Project, ProjectStage, ProjectTranche } from "@/lib/types";

const STAGE_BAR_COLORS: Record<ProjectStage, string> = {
  new: "bg-accent/70",
  documents_received: "bg-cyan-500/70",
  match: "bg-teal-500/70",
  status: "bg-silver/70",
};

// A full, standalone literal (not assembled from a template string or a
// variable) so Tailwind's static scan always picks it up — same reason
// every STAGE_BAR_COLORS value above is written out whole rather than
// built from parts.
const ACTIVE_TRANCHES_BAR_COLOR = "bg-amber-500/70";

interface DashboardPageProps {
  searchParams: Promise<{ passwordChanged?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { passwordChanged } = await searchParams;

  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);

  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").is("archived_at", null);
  const allProjects = (data as Project[] | null) ?? [];

  const [products, statuses, appSettings, { count: inboxNewCount }, { data: activeTranchesData }] = await Promise.all([
    getAllProducts(),
    getAllStatuses(),
    getAppSettings(),
    supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("project_tranches").select("*").not("confirmed_on", "is", null).is("paid_out_on", null),
  ]);

  // Settings → Defaults' "Show Recovery" toggle (supabase/migrations/
  // 024_show_recovery.sql): off means every count/list on this page
  // treats recovery projects as if they don't exist — their own data
  // is untouched, this just filters them out of everything derived
  // below. The "Open Recovery Projects" card and the Active Tranches
  // stage-chart row account for this separately further down (the
  // former is omitted outright rather than shown as 0; the latter
  // reads from `projects` like everything else here).
  const projects = appSettings.show_recovery ? allProjects : allProjects.filter((project) => !project.is_recovery);

  const statusByName = new Map(statuses.map((s) => [s.name, s]));
  const openProjects = projects.filter((project) => !isClosedStatus(project.status, statuses));
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
    if (!project.status || statusByName.get(project.status)?.kind !== "completed") return false;
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

  // Counted against every product (not just active ones) first — a
  // project already set to a since-hidden product must still count
  // toward this breakdown. Each open project counts under its final
  // product once it has one, otherwise under every option still in
  // play — same rule the Projects list's product filter uses.
  const openProjectProductsById = await getProjectProductsByProjectIds(openProjects.map((p) => p.id));
  const productTypeCounts = products.reduce(
    (acc, product) => {
      acc[product.name] = openProjects.filter((project) =>
        countedProducts(project.final_product, openProjectProductsById.get(project.id) ?? []).includes(product.name)
      ).length;
      return acc;
    },
    {} as Record<string, number>
  );
  // Display is scoped down to active products, plus any hidden one
  // that still has open projects counted against it (labeled "(hidden)"
  // below rather than silently vanishing) — order follows `products`
  // itself (Settings → Products' sort_order), just with the irrelevant
  // hidden/zero-count rows dropped out of it.
  const visibleProducts = products.filter((product) => product.active || productTypeCounts[product.name] > 0);
  const maxProductCount = Math.max(1, ...visibleProducts.map((product) => productTypeCounts[product.name]));

  // Stuck: open, not archived (already guaranteed by the `projects`
  // query above), not completed/lost (openProjects), has a matched
  // receiver, in the Match or Status stage, no activity for
  // stuck_after_days or more. A brand-new or still-unmatched project
  // isn't "stuck" by this rule — it just hasn't gotten there yet.
  const stuckProjects = openProjects
    .filter(
      (project) =>
        project.matched_contact_id != null &&
        (project.stage === "match" || project.stage === "status") &&
        now.getTime() - new Date(project.last_activity_at).getTime() >= STUCK_AFTER_MS
    )
    .sort((a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime());

  // Not matched: open, not archived, no matched receiver yet.
  const notMatchedProjects = openProjects.filter((project) => !project.matched_contact_id);
  const notMatchedDocsReceivedCount = notMatchedProjects.filter(
    (project) => project.stage === "documents_received"
  ).length;

  // Due today & overdue: open next steps AND note reminders, due today
  // or overdue, across every non-archived project (note reminders on a
  // contact, or unlinked, carry no "archived" concept and are always
  // included).
  const todayKey = dateKeyInTimeZone(new Date().toISOString());
  const projectNameById = new Map(projects.map((p) => [p.id, projectDisplayName(p)]));
  const projectFullNameById = new Map(projects.map((p) => [p.id, p.name]));
  const projectIsRecoveryById = new Map(projects.map((p) => [p.id, p.is_recovery]));
  const projectCurrencyById = new Map(projects.map((p) => [p.id, p.currency]));

  // Active Tranches: confirmed and NOT YET paid out (025_payouts.sql
  // adds the paid_out_on exclusion — once a tranche is paid out it's
  // done, not "active" anymore), on a project that's open (not
  // archived, and not completed/lost — exactly `openProjects`' own
  // definition above, which already respects the Show Recovery
  // switch too). Newest confirmation first.
  const openProjectIds = new Set(openProjects.map((p) => p.id));
  const activeTranches = ((activeTranchesData as ProjectTranche[] | null) ?? [])
    .filter((t) => openProjectIds.has(t.project_id))
    .sort((a, b) => (b.confirmed_on as string).localeCompare(a.confirmed_on as string));

  const activeTrancheTotalsByCurrency = new Map<string, number>();
  for (const tranche of activeTranches) {
    if (tranche.amount == null) continue;
    const currency = projectCurrencyById.get(tranche.project_id);
    if (!currency) continue;
    activeTrancheTotalsByCurrency.set(currency, (activeTrancheTotalsByCurrency.get(currency) ?? 0) + tranche.amount);
  }
  const activeTrancheTotalsLabel = CURRENCIES.filter((c) => activeTrancheTotalsByCurrency.has(c))
    .map((c) => formatMoney(activeTrancheTotalsByCurrency.get(c)!, c))
    .join(" · ");

  // Projects by Stage's own extra row below: a project can have more
  // than one active tranche, but only counts once here — this is a
  // project count, not a tranche count (unlike the STATS card above).
  const activeTrancheProjectCount = new Set(activeTranches.map((t) => t.project_id)).size;

  let dueItems: DueItem[] = [];
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

    dueItems = (
      (stepsData as { id: string; project_id: string; body: string; due_date: string }[] | null) ?? []
    ).map((step) => ({
      id: step.id,
      kind: "step" as const,
      projectId: step.project_id,
      parentName: projectNameById.get(step.project_id) ?? "Project",
      parentFullName: projectFullNameById.get(step.project_id),
      body: step.body,
      dueDate: step.due_date,
      href: `/projects/${step.project_id}`,
      isRecovery: projectIsRecoveryById.get(step.project_id),
    }));
  }

  const { data: reminderNotesData } = await supabase
    .from("notes")
    .select("id, content, due_date, project_id, contact_id, opportunity_id")
    .eq("is_reminder", true)
    .eq("reminder_done", false)
    .lte("due_date", todayKey)
    .order("due_date", { ascending: true });

  const reminderNotes =
    (reminderNotesData as
      | {
          id: string;
          content: string;
          due_date: string;
          project_id: string | null;
          contact_id: string | null;
          opportunity_id: string | null;
        }[]
      | null) ?? [];

  const reminderContactIds = [
    ...new Set(reminderNotes.map((n) => n.contact_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: reminderContactsData } =
    reminderContactIds.length > 0
      ? await supabase.from("contacts").select("id, full_name, nickname").in("id", reminderContactIds)
      : { data: [] };
  const reminderContacts = (reminderContactsData as { id: string; full_name: string; nickname: string | null }[] | null) ?? [];
  const contactNameById = new Map(reminderContacts.map((c) => [c.id, receiverDisplayName(c)]));
  const contactFullNameById = new Map(reminderContacts.map((c) => [c.id, c.full_name]));

  const reminderOpportunityIds = [
    ...new Set(reminderNotes.map((n) => n.opportunity_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: reminderOpportunitiesData } =
    reminderOpportunityIds.length > 0
      ? await supabase.from("opportunities").select("id, title").in("id", reminderOpportunityIds)
      : { data: [] };
  const opportunityTitleById = new Map(
    ((reminderOpportunitiesData as { id: string; title: string }[] | null) ?? []).map((o) => [o.id, o.title])
  );

  const noteDueItems: DueItem[] = reminderNotes
    // A project-linked reminder whose project is archived (or otherwise
    // not in the non-archived `projects` list) is dropped, matching the
    // next-step query's scope above.
    .filter((note) => !note.project_id || projectNameById.has(note.project_id))
    .map((note) => ({
      id: note.id,
      kind: "note" as const,
      body: note.content,
      dueDate: note.due_date,
      parentName: note.project_id
        ? projectNameById.get(note.project_id) ?? "Project"
        : note.contact_id
          ? contactNameById.get(note.contact_id) ?? "Receiver"
          : note.opportunity_id
            ? opportunityTitleById.get(note.opportunity_id) ?? "Opportunity"
            : "—",
      parentFullName: note.project_id
        ? projectFullNameById.get(note.project_id)
        : note.contact_id
          ? contactFullNameById.get(note.contact_id)
          : undefined,
      href: note.project_id
        ? `/projects/${note.project_id}`
        : note.contact_id
          ? `/receivers/${note.contact_id}`
          : note.opportunity_id
            ? `/opportunities/${note.opportunity_id}`
            : `/notes/${note.id}/edit`,
      isRecovery: note.project_id ? projectIsRecoveryById.get(note.project_id) : undefined,
    }));

  dueItems = [...dueItems, ...noteDueItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const backupTone: "ok" | "warning" | "danger" =
    daysSinceBackup === null ? "danger" : daysSinceBackup > 14 ? "danger" : daysSinceBackup > 7 ? "warning" : "ok";
  const backupLabel =
    daysSinceBackup === null
      ? t.dashboard.lastBackupNever
      : daysSinceBackup === 0
        ? t.dashboard.lastBackupToday
        : t.dashboard.lastBackupDaysAgo(daysSinceBackup);
  const BACKUP_TONE_CLASSES: Record<typeof backupTone, string> = {
    ok: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    danger: "border-red-500/25 bg-red-500/10 text-red-300",
  };

  // Projects and Recovery Projects are now separate tabs over the same
  // `projects` table (is_recovery) — these two cards partition "open"
  // the same way, instead of one counting everyone and the other just
  // a subset of it.
  const openNonRecoveryCount = openProjects.filter((project) => !project.is_recovery).length;
  const openRecoveryCount = openProjects.filter((project) => project.is_recovery).length;

  // Statuses are admin-managed now (no fixed "completed" slug to link
  // to) — this points at whichever completed-kind status sorts first,
  // same best-effort single-status link the old hard-coded href was.
  const completedStatusName = statuses.find((s) => s.active && s.kind === "completed")?.name;

  const STATS: {
    label: string;
    value: number;
    icon: typeof Layers;
    tone: string;
    href: string;
    suffix: string | null;
    extra: string | null;
  }[] = [
    {
      label: t.dashboard.openProjects,
      value: openNonRecoveryCount,
      icon: Layers,
      tone: "text-white",
      href: "/projects",
      suffix: null,
      extra: null,
    },
    {
      label: t.dashboard.notMatched,
      value: notMatchedProjects.length,
      icon: Unlink,
      tone: "text-sky-300",
      href: "/projects?unmatched=true",
      suffix: null,
      extra: t.dashboard.withDocumentsReceived(notMatchedDocsReceivedCount),
    },
    {
      label: t.dashboard.completedMonth,
      value: completedThisMonth,
      icon: CheckCircle2,
      tone: "text-emerald-300",
      href: completedStatusName ? `/projects?status=${encodeURIComponent(completedStatusName)}` : "/projects",
      suffix: null,
      extra: null,
    },
    ...(appSettings.show_recovery
      ? [
          {
            label: t.dashboard.recoveryProjects,
            value: openRecoveryCount,
            icon: RotateCcw,
            tone: "text-amber-300",
            href: "/recovery",
            suffix: null,
            extra: null,
          },
        ]
      : []),
    {
      label: t.dashboard.inbox,
      value: inboxNewCount ?? 0,
      icon: Inbox,
      tone: "text-cyan-300",
      href: "/inbox",
      suffix: t.dashboard.toFile,
      extra: null,
    },
    {
      label: t.dashboard.activeTranches,
      value: activeTranches.length,
      icon: Landmark,
      tone: "text-teal-300",
      href: "#active-tranches",
      suffix: null,
      extra: activeTrancheTotalsLabel || null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.dashboard.title}</h1>
          <p className="mt-1 text-sm text-white/45">{t.dashboard.subtitle}</p>
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
          {t.dashboard.passwordChanged}
        </GlassCard>
      )}

      {error && (
        <GlassCard interactive={false} className="mb-6 p-6 text-sm text-rose-300">
          {t.dashboard.failedToLoadProjects(error.message)}
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {STATS.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block h-full">
            <GlassCard className="flex h-full flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-white/45">{stat.label}</p>
                <stat.icon className={`h-4 w-4 shrink-0 ${stat.tone}`} />
              </div>
              <p className={`mt-3 text-3xl font-semibold tracking-tight ${stat.tone}`}>
                {error ? "—" : stat.value}
                {!error && stat.suffix && <span className="text-sm font-medium text-white/40">{stat.suffix}</span>}
              </p>
              <p className="mt-1 text-xs text-white/40">{!error && stat.extra ? stat.extra : " "}</p>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div id="active-tranches" className="mt-6">
        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <Landmark className="h-4 w-4 text-white/40" />
            {t.dashboard.activeTranchesHeading}
          </h2>
          {activeTranches.length === 0 ? (
            <p className="text-sm text-white/35">{t.dashboard.noActiveTranches}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {activeTranches.map((tranche) => {
                const days = daysSince(tranche.confirmed_on as string);
                return (
                  <Link
                    key={tranche.id}
                    href={`/projects/${tranche.project_id}`}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                  >
                    <span
                      title={
                        projectFullNameById.get(tranche.project_id) &&
                        projectFullNameById.get(tranche.project_id) !== projectNameById.get(tranche.project_id)
                          ? projectFullNameById.get(tranche.project_id)
                          : undefined
                      }
                      className="min-w-0 flex-1 truncate text-sm text-white/80"
                    >
                      {projectNameById.get(tranche.project_id) ?? "Project"}
                    </span>
                    {projectIsRecoveryById.get(tranche.project_id) && <RecoveryBadge />}
                    <span className="shrink-0 text-xs text-white/50">{t.dashboard.trancheNumber(tranche.tranche_number)}</span>
                    <span className="shrink-0 text-xs font-medium text-white/80">
                      {formatMoney(tranche.amount, projectCurrencyById.get(tranche.project_id))}
                    </span>
                    <span className="shrink-0 text-xs text-white/40">
                      {t.dashboard.confirmedOn(formatDateOnly(tranche.confirmed_on as string, lang))}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-white/50">
                      {t.dashboard.daysSinceConfirmed(days)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="mt-6">
        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">{t.dashboard.projectsByStage}</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-white/35">{t.dashboard.noProjectsYet}</p>
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
                      {stageLabel(stage, lang)}
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

              <div className="my-1 border-t border-white/[0.06]" />

              {(() => {
                // Same formula and same max as the stage bars above —
                // scaled against maxStageCount, not its own count, so
                // it's directly comparable to them at a glance.
                const activeTrancheWidth =
                  activeTrancheProjectCount === 0 ? 0 : Math.max(4, (activeTrancheProjectCount / maxStageCount) * 100);
                return (
                  <div className="flex flex-col gap-1">
                    <Link
                      href="/projects?active_tranches=true"
                      className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                    >
                      <span className="w-36 shrink-0 text-sm text-white/60 group-hover:text-white/90">
                        {t.dashboard.activeTranches}
                      </span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <span
                          className={`block h-full rounded-full transition-all duration-300 ease-out ${ACTIVE_TRANCHES_BAR_COLOR}`}
                          style={{ width: `${activeTrancheWidth}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right text-sm font-medium text-white/80">
                        {activeTrancheProjectCount}
                      </span>
                    </Link>
                    <p className="px-2 text-[11px] text-white/30">{t.dashboard.alsoCountedInStage}</p>
                  </div>
                );
              })()}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassCard interactive={false} className="flex h-full flex-col p-6">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <AlertTriangle className="h-4 w-4 text-white/40" />
            {t.dashboard.stuckProjectsHeading}
          </h2>
          {stuckProjects.length === 0 ? (
            <p className="text-sm text-white/35">{t.dashboard.noStuckProjects}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {stuckProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <span
                    title={project.nickname ? project.name : undefined}
                    className="min-w-0 flex-1 truncate text-sm text-white/80"
                  >
                    {projectDisplayName(project)}
                  </span>
                  {project.is_recovery && <RecoveryBadge />}
                  <span className="shrink-0 text-xs text-white/40">{formatDateTime(project.last_activity_at, lang)}</span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard interactive={false} className="flex h-full flex-col p-6">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <CalendarClock className="h-4 w-4 text-white/40" />
            {t.dashboard.dueTodayOverdue}
          </h2>
          <DueTodayAndOverdue items={dueItems} lang={lang} />
        </GlassCard>

        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">{t.dashboard.openProjectsByProduct}</h2>
          {openProjects.length === 0 ? (
            <p className="text-sm text-white/35">{t.dashboard.noOpenProjects}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleProducts.map((product) => {
                const count = productTypeCounts[product.name];
                const width = count === 0 ? 0 : Math.max(4, (count / maxProductCount) * 100);
                return (
                  <Link
                    key={product.id}
                    href={`/projects?product_type=${encodeURIComponent(product.name)}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-24 shrink-0 text-sm break-words text-white/60 group-hover:text-white/90">
                      {product.name}
                      {!product.active && t.dashboard.hiddenSuffix}
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
      </div>
    </div>
  );
}
