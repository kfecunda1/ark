import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIME_ZONE, dateKeyInTimeZone, truncate } from "@/lib/format";
import { dueDateLabel, followUpLabel } from "@/lib/projects";
import { formatMoney } from "@/lib/money";
import { computeChecklistStatus, getRequiredDocumentsByProduct } from "@/lib/checklists";
import type { Currency, Project, ProjectTranche } from "@/lib/types";

// Everything behind the ARK Telegram bot's morning briefing — shared
// by the daily cron (app/api/cron/morning-briefing/route.ts) and
// "Send me a test briefing now" (Settings → My Profile,
// lib/actions/morning-briefing.ts). Takes a Supabase client rather
// than constructing its own, so the caller decides which one: the
// service-role client for the cron (no logged-in session to read RLS
// against), or the current user's own session client for a test send
// (RLS-correct either way — a non-admin's own session simply can't
// read the admin-only payouts/backup data, same as it can't anywhere
// else in the app).

const ARK_BASE_URL = "https://ark-pink.vercel.app";
export const TELEGRAM_MESSAGE_LIMIT = 4096;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(href: string, label: string): string {
  return `<a href="${ARK_BASE_URL}${href}">${escapeHtml(label)}</a>`;
}

interface StatusLike {
  name: string;
  kind: "open" | "completed" | "lost";
}

function isClosedStatus(status: string | null, statuses: StatusLike[]): boolean {
  if (!status) return false;
  const kind = statuses.find((s) => s.name === status)?.kind;
  return kind === "completed" || kind === "lost";
}

export interface BriefingDueItem {
  href: string;
  body: string;
  parentName: string;
  label: string; // "Due today" / "N days overdue" — lib/projects.ts's dueDateLabel/followUpLabel
}

export interface BriefingStuckProject {
  href: string;
  name: string;
}

export interface BriefingSnapshot {
  dueItems: BriefingDueItem[];
  dueItemsTotalCount: number;
  stuckProjects: BriefingStuckProject[];
  activeTranchesCount: number;
  activeTrancheTotalsByCurrency: Partial<Record<Currency, number>>;
  notMatchedCount: number;
  notMatchedDocsReceivedCount: number;
  inboxToFileCount: number;
  projectsMissingDocumentsCount: number;
  // Admin-only figures — never an amount or a percentage, just counts/
  // days, same as every other payout-adjacent surface in this app.
  payoutsWithoutCommissionCount: number;
  daysSinceBackup: number | null;
}

const DUE_ITEMS_LIMIT = 10;
const STUCK_PROJECTS_LIMIT = 5;

// One snapshot covers every recipient — none of this is per-user
// except which role gets to see the admin-only figures, decided later
// by buildBriefingText. Mirrors app/(app)/dashboard/page.tsx's own
// queries (Due today & overdue, Stuck Projects, Active Tranches, Not
// matched, Inbox) scoped down to just the counts/top-N this message
// needs.
export async function getBriefingSnapshot(supabase: SupabaseClient): Promise<BriefingSnapshot> {
  const [{ data: statusesData }, { data: appSettingsData }, { data: projectsData }, { count: inboxToFileCount }] =
    await Promise.all([
      supabase.from("statuses").select("name, kind"),
      supabase.from("app_settings").select("show_recovery, stuck_after_days").maybeSingle(),
      supabase.from("projects").select("*").is("archived_at", null),
      supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "new"),
    ]);

  const statuses = (statusesData as StatusLike[] | null) ?? [];
  const appSettings = (appSettingsData as { show_recovery: boolean; stuck_after_days: number } | null) ?? {
    show_recovery: true,
    stuck_after_days: 7,
  };
  const allProjects = (projectsData as Project[] | null) ?? [];
  // Settings → Defaults' "Show Recovery" switch (024_show_recovery.sql)
  // — off means recovery projects don't exist for any count/list below,
  // same as the Dashboard.
  const projects = appSettings.show_recovery ? allProjects : allProjects.filter((p) => !p.is_recovery);
  const openProjects = projects.filter((p) => !isClosedStatus(p.status, statuses));
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const todayKey = dateKeyInTimeZone(new Date().toISOString());

  const [{ data: stepsData }, { data: reminderNotesData }] =
    projects.length > 0
      ? await Promise.all([
          supabase
            .from("project_steps")
            .select("id, project_id, body, due_date")
            .in("project_id", projects.map((p) => p.id))
            .eq("kind", "next_step")
            .eq("done", false)
            .lte("due_date", todayKey)
            .order("due_date", { ascending: true }),
          supabase
            .from("notes")
            .select("id, content, due_date, project_id, contact_id")
            .eq("is_reminder", true)
            .eq("reminder_done", false)
            .lte("due_date", todayKey)
            .order("due_date", { ascending: true }),
        ])
      : [{ data: [] }, { data: [] }];

  const stepRows =
    (stepsData as { id: string; project_id: string; body: string; due_date: string }[] | null) ?? [];
  const reminderRows =
    (reminderNotesData as
      | { id: string; content: string; due_date: string; project_id: string | null; contact_id: string | null }[]
      | null) ?? [];

  const reminderContactIds = [...new Set(reminderRows.map((n) => n.contact_id).filter((id): id is string => Boolean(id)))];
  const { data: reminderContactsData } =
    reminderContactIds.length > 0
      ? await supabase.from("contacts").select("id, full_name").in("id", reminderContactIds)
      : { data: [] as { id: string; full_name: string }[] };
  const contactNameById = new Map(
    ((reminderContactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );

  interface RawDueItem extends BriefingDueItem {
    dueDate: string;
  }

  const stepDueItems: RawDueItem[] = stepRows.map((s) => ({
    href: `/projects/${s.project_id}`,
    body: s.body,
    parentName: projectNameById.get(s.project_id) ?? "Project",
    label: dueDateLabel(s.due_date),
    dueDate: s.due_date,
  }));

  const noteDueItems: RawDueItem[] = reminderRows
    .filter((n) => !n.project_id || projectNameById.has(n.project_id))
    .map((n) => ({
      href: n.project_id ? `/projects/${n.project_id}` : n.contact_id ? `/receivers/${n.contact_id}` : `/notes/${n.id}/edit`,
      body: n.content,
      parentName: n.project_id
        ? projectNameById.get(n.project_id) ?? "Project"
        : n.contact_id
          ? contactNameById.get(n.contact_id) ?? "Receiver"
          : "—",
      label: followUpLabel(n.due_date),
      dueDate: n.due_date,
    }));

  const allDueItems = [...stepDueItems, ...noteDueItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const STUCK_AFTER_MS = appSettings.stuck_after_days * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const stuckProjects: BriefingStuckProject[] = openProjects
    .filter(
      (p) =>
        p.matched_contact_id != null &&
        (p.stage === "match" || p.stage === "status") &&
        now - new Date(p.last_activity_at).getTime() >= STUCK_AFTER_MS
    )
    .sort((a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime())
    .slice(0, STUCK_PROJECTS_LIMIT)
    .map((p) => ({ href: `/projects/${p.id}`, name: p.name }));

  const openProjectIds = new Set(openProjects.map((p) => p.id));
  const projectCurrencyById = new Map(projects.map((p) => [p.id, p.currency]));
  const { data: activeTranchesData } = await supabase
    .from("project_tranches")
    .select("*")
    .not("confirmed_on", "is", null)
    .is("paid_out_on", null);
  const activeTranches = ((activeTranchesData as ProjectTranche[] | null) ?? []).filter((t) =>
    openProjectIds.has(t.project_id)
  );
  const activeTrancheTotalsByCurrency: Partial<Record<Currency, number>> = {};
  for (const t of activeTranches) {
    if (t.amount == null) continue;
    const currency = projectCurrencyById.get(t.project_id);
    if (!currency) continue;
    activeTrancheTotalsByCurrency[currency] = (activeTrancheTotalsByCurrency[currency] ?? 0) + t.amount;
  }

  const notMatchedProjects = openProjects.filter((p) => !p.matched_contact_id);
  const notMatchedDocsReceivedCount = notMatchedProjects.filter((p) => p.stage === "documents_received").length;

  // "N projects missing documents" — same checklist math as the
  // Project page/Projects list (lib/checklists.ts), scoped to the same
  // open-projects set as everything else in this briefing.
  const [requiredByProduct, { data: openProjectProductsData }, { data: openProjectDocsData }] =
    openProjects.length > 0
      ? await Promise.all([
          getRequiredDocumentsByProduct(supabase),
          supabase.from("project_products").select("project_id, product").in("project_id", openProjects.map((p) => p.id)),
          supabase
            .from("project_documents")
            .select("project_id, document_type")
            .in("project_id", openProjects.map((p) => p.id)),
        ])
      : [new Map<string, string[]>(), { data: [] }, { data: [] }];

  const optionsByProjectId = new Map<string, string[]>();
  for (const row of (openProjectProductsData as { project_id: string; product: string }[] | null) ?? []) {
    optionsByProjectId.set(row.project_id, [...(optionsByProjectId.get(row.project_id) ?? []), row.product]);
  }
  const docTypesByProjectId = new Map<string, Set<string>>();
  for (const row of (openProjectDocsData as { project_id: string; document_type: string }[] | null) ?? []) {
    const set = docTypesByProjectId.get(row.project_id) ?? new Set<string>();
    set.add(row.document_type);
    docTypesByProjectId.set(row.project_id, set);
  }
  const projectsMissingDocumentsCount = openProjects.filter((p) => {
    const status = computeChecklistStatus(
      p.final_product,
      optionsByProjectId.get(p.id) ?? [],
      requiredByProduct,
      docTypesByProjectId.get(p.id) ?? new Set<string>()
    );
    return status.hasChecklist && !status.isComplete;
  }).length;

  // Admin-only — same "Commission not set" definition the Payouts page
  // uses (lib/actions/matching.ts has no equivalent; this is its own
  // small query, same shape as app/(app)/payouts/page.tsx's).
  const { data: paidTranchesData } = await supabase.from("project_tranches").select("id").not("paid_out_on", "is", null);
  const paidTrancheIds = ((paidTranchesData as { id: string }[] | null) ?? []).map((t) => t.id);
  const { data: payoutsData } =
    paidTrancheIds.length > 0
      ? await supabase.from("tranche_payouts").select("tranche_id, our_pct").in("tranche_id", paidTrancheIds)
      : { data: [] as { tranche_id: string; our_pct: number | null }[] };
  const ourPctByTranche = new Map(
    ((payoutsData as { tranche_id: string; our_pct: number | null }[] | null) ?? []).map((p) => [p.tranche_id, p.our_pct])
  );
  const payoutsWithoutCommissionCount = paidTrancheIds.filter((id) => ourPctByTranche.get(id) == null).length;

  const { data: backupRow } = await supabase
    .from("activity_log")
    .select("created_at")
    .eq("entity_type", "backup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastBackupAt = (backupRow as { created_at: string } | null)?.created_at ?? null;
  const daysSinceBackup = lastBackupAt ? Math.floor((now - new Date(lastBackupAt).getTime()) / 86_400_000) : null;

  return {
    dueItems: allDueItems.slice(0, DUE_ITEMS_LIMIT).map(({ href, body, parentName, label }) => ({
      href,
      body,
      parentName,
      label,
    })),
    dueItemsTotalCount: allDueItems.length,
    stuckProjects,
    activeTranchesCount: activeTranches.length,
    activeTrancheTotalsByCurrency,
    notMatchedCount: notMatchedProjects.length,
    notMatchedDocsReceivedCount,
    inboxToFileCount: inboxToFileCount ?? 0,
    projectsMissingDocumentsCount,
    payoutsWithoutCommissionCount,
    daysSinceBackup,
  };
}

function headerDateLabel(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" });
}

// Curacao's own calendar weekday (0 = Sunday … 6 = Saturday) for
// "today", independent of whatever timezone the server process itself
// runs in — used to decide briefing_weekdays_only skips.
export function currentWeekdayInTimeZone(): number {
  const key = dateKeyInTimeZone(new Date().toISOString());
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function todayDateKey(): string {
  return dateKeyInTimeZone(new Date().toISOString());
}

// Builds the Telegram HTML text for one recipient — isAdmin gates the
// Payouts/Backup lines (never shown, never queried-for-display, to a
// member); every other section is identical for everyone. A section
// with nothing to report is omitted outright rather than printed as a
// bare "0", so a quiet day reads as quiet instead of noisy; if that
// leaves nothing at all, the whole body collapses to "All clear".
export function buildBriefingText(snapshot: BriefingSnapshot, isAdmin: boolean): string {
  const sections: string[] = [];

  if (snapshot.dueItems.length > 0) {
    const lines = snapshot.dueItems.map(
      (item) => `• ${link(item.href, truncate(item.body, 80))} — ${escapeHtml(item.parentName)} · ${item.label}`
    );
    const extra = snapshot.dueItemsTotalCount - snapshot.dueItems.length;
    if (extra > 0) lines.push(`+${extra} more`);
    sections.push(`📌 <b>Due today &amp; overdue</b>\n${lines.join("\n")}`);
  }

  if (snapshot.stuckProjects.length > 0) {
    const lines = snapshot.stuckProjects.map((p) => `• ${link(p.href, p.name)}`);
    sections.push(`⏳ <b>Stuck projects</b>\n${lines.join("\n")}`);
  }

  if (snapshot.activeTranchesCount > 0) {
    const totals = (Object.entries(snapshot.activeTrancheTotalsByCurrency) as [Currency, number][])
      .map(([currency, amount]) => formatMoney(amount, currency))
      .join(" · ");
    sections.push(
      `💶 Active tranches: ${snapshot.activeTranchesCount}${totals ? ` (${totals})` : ""}`
    );
  }

  if (snapshot.notMatchedCount > 0) {
    sections.push(
      `🔗 Not matched: ${snapshot.notMatchedCount} (${snapshot.notMatchedDocsReceivedCount} with documents received)`
    );
  }

  if (snapshot.inboxToFileCount > 0) {
    sections.push(`📥 Inbox: ${snapshot.inboxToFileCount} to file`);
  }

  if (snapshot.projectsMissingDocumentsCount > 0) {
    sections.push(`📄 ${snapshot.projectsMissingDocumentsCount} projects missing documents`);
  }

  if (isAdmin) {
    if (snapshot.payoutsWithoutCommissionCount > 0) {
      sections.push(`💰 Payouts: ${snapshot.payoutsWithoutCommissionCount} without commission set`);
    }
    if (snapshot.daysSinceBackup === null) {
      sections.push(`🗄 Backup: never backed up`);
    } else if (snapshot.daysSinceBackup > 7) {
      sections.push(`🗄 Backup: last ${snapshot.daysSinceBackup} days ago`);
    }
  }

  const header = `☀️ <b>ARK — ${headerDateLabel()}</b>`;
  const body = sections.length > 0 ? sections.join("\n\n") : "✅ All clear today.";
  const text = `${header}\n\n${body}`;

  return text.length > TELEGRAM_MESSAGE_LIMIT ? `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…` : text;
}
