import { LOCALE, TIME_ZONE, dateKeyInTimeZone, type Lang } from "@/lib/format";
import { PRIORITY_LABELS, STAGE_LABELS } from "@/lib/projects";
import { getDictionary } from "@/lib/i18n";
import type { ActivityAction, ActivityDetails, ActivityEntityType, ActivityLog } from "@/lib/types";

// The three buckets the Activity page filters by. "document" covers
// project_document and contact_document, "contact" also covers
// contact_product (a contact's own sub-record), and "project" also
// covers project_step (a timeline entry) — from the user's point of
// view, a document is a document and a sub-record is still just
// something that happened to its parent.
export type ActivityFilter = "project" | "contact" | "document";

export const ACTIVITY_FILTERS: ActivityFilter[] = ["project", "contact", "document"];

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  project: "Projects",
  contact: "Receivers",
  document: "Documents",
};

// Language-aware counterpart of the three English consts above — not
// yet wired into app/(app)/activity/page.tsx itself (which still
// renders the plain English consts, same as the per-row "detail
// chips" below), but ready for that page to switch to once it gets
// its own translated pass.
export function activityFilterLabel(filter: ActivityFilter, lang: Lang): string {
  return getDictionary(lang).activity.filters[filter];
}

// Opportunities (supabase/migrations/034_opportunities.sql) have no
// filter bucket of their own here — rows for 'opportunity'/
// 'opportunity_document' only show up under "All" (no filter applied),
// same as a handful of other entity types (backup, password_change, …)
// that predate this file's three-bucket filter.
export const ACTIVITY_FILTER_ENTITY_TYPES: Record<ActivityFilter, ActivityEntityType[]> = {
  project: ["project", "project_step", "project_product", "project_intermediary", "project_tranche"],
  contact: ["contact", "contact_product", "receiver_intermediary"],
  document: ["project_document", "contact_document"],
};

export function parseActivityFilter(value: string | undefined): ActivityFilter | null {
  return ACTIVITY_FILTERS.includes(value as ActivityFilter) ? (value as ActivityFilter) : null;
}

export const ENTITY_TYPE_LABELS: Record<ActivityEntityType, string> = {
  project: "Project",
  // UI: Receiver (see AGENTS.md's UI-naming-vs-database-naming note)
  // — entity_type stays "contact" in the database.
  contact: "Receiver",
  project_document: "Project document",
  contact_product: "Receiver product",
  contact_document: "Receiver document",
  project_step: "Timeline entry",
  backup: "Backup",
  password_change: "Password change",
  product: "Product",
  document_type: "Document type",
  app_settings: "Settings",
  user: "User",
  project_product: "Product option",
  note: "Note",
  person: "Contact",
  receiver_intermediary: "Receiver intermediary",
  project_intermediary: "Project intermediary",
  status: "Status",
  project_tranche: "Tranche",
  opportunity: "Opportunity",
  opportunity_document: "Opportunity document",
  note_participant: "Meeting participant",
  note_document: "Note document",
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
};

export function entityTypeLabel(entityType: ActivityEntityType, lang: Lang): string {
  return getDictionary(lang).activity.entityTypes[entityType];
}

export function actionLabel(action: ActivityAction, lang: Lang): string {
  return getDictionary(lang).activity.actions[action];
}

// Child-entity types whose own 'deleted' row should still link to the
// parent (which, unlike the child, still exists) — originally just the
// two document types, now also project_step entries.
export function isDocumentEntity(entityType: ActivityEntityType): boolean {
  return (
    entityType === "project_document" ||
    entityType === "contact_document" ||
    entityType === "project_step" ||
    entityType === "project_product" ||
    entityType === "note" ||
    entityType === "receiver_intermediary" ||
    entityType === "project_intermediary" ||
    entityType === "project_tranche" ||
    entityType === "opportunity_document" ||
    entityType === "note_document" ||
    entityType === "note_participant"
  );
}

// contact_person_id is shared by both contacts and projects (same
// column name, same generic "fields changed" chip), but the label
// differs: the Project side is "Contact Person Project" everywhere
// else in the UI, while the Receiver's own stays plain "Contact
// person" — entityType picks which one a given activity row means.
export function fieldLabel(field: string, entityType?: ActivityEntityType, lang: Lang = "en"): string {
  const labels = getDictionary(lang).activity.fieldLabels as Record<string, string>;
  if (field === "contact_person_id" && entityType === "project") return labels.contact_person_id_project;
  return labels[field] ?? field.replace(/_/g, " ");
}

// Fields whose change is already spelled out as its own "x -> y" chip, so
// listing them again under "fields changed" would just be repetition.
const FIELDS_DESCRIBED_SEPARATELY = new Set([
  "stage",
  "status",
  "priority",
  "archived",
  "full_name",
  "nickname",
  "done",
  "name",
  "active",
  "default_currency",
  "stuck_after_days",
  "show_recovery",
  "role",
  "event",
  "final_product",
  "reminder_done",
  "is_recovery",
  // already spelled out in the row's own summary ("<file> moved to
  // Tranche N" / "moved to General") — see log_project_document_
  // activity() in supabase/migrations/021_tranche_documents.sql.
  "tranche_id",
  // opportunities (supabase/migrations/034_opportunities.sql) —
  // converted_to_type gets its own dedicated chip below, and
  // converted_to_id is just its id counterpart, not worth repeating.
  // "title" is NOT listed here even though opportunities' own trigger
  // gives it the generic "name" chip treatment (its own details key is
  // literally 'name', not 'title' — see log_opportunity_activity()):
  // this set has no per-entity-type scoping, and notes also have a
  // `title` column that is NOT given a dedicated pair chip, so a
  // blanket exclusion would silently drop note title changes instead.
  // activityDetailChips filters 'title' out of the generic list itself,
  // scoped to entity_type === "opportunity" only.
  "converted_to_type",
  "converted_to_id",
  // notes/project_steps (supabase/migrations/035_meeting_notes.sql) —
  // an internal backlink, never shown on its own; the meeting note (or
  // project) it points at is already reachable from the row's own
  // link, not worth repeating as a raw id.
  "source_note_id",
]);

function asPair<T>(value: T | [T, T] | undefined): [T, T] | null {
  return Array.isArray(value) ? (value as [T, T]) : null;
}

function asScalar<T>(value: T | [T, T] | undefined): T | null {
  if (value === undefined || value === null || Array.isArray(value)) return null;
  return value as T;
}

function labelled<T extends string>(value: T | null, labels: Record<T, string>): string {
  return value && labels[value] ? labels[value] : (value ?? "—");
}

/**
 * Short human-readable bits describing one activity row — the "what
 * exactly changed" column on the Activity page.
 */
export function activityDetailChips(row: ActivityLog, lang: Lang = "en"): string[] {
  const details: ActivityDetails = row.details ?? {};
  const chips: string[] = [];
  const c = getDictionary(lang).activity.chips;
  const stageLabels: Record<string, string> = lang === "es"
    ? { new: "Nuevo", documents_received: "Documentos recibidos", match: "Coincidencia", status: "Estado" }
    : STAGE_LABELS;
  const priorityLabels: Record<string, string> = lang === "es"
    ? { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" }
    : PRIORITY_LABELS;

  const stagePair = asPair(details.stage);
  if (stagePair) {
    chips.push(c.stageTransition(labelled(stagePair[0], stageLabels), labelled(stagePair[1], stageLabels)));
  } else if (row.action !== "updated") {
    const stage = asScalar(details.stage);
    if (stage) chips.push(c.stageSet(labelled(stage, stageLabels)));
  }

  if (Array.isArray(details.status)) {
    // Opportunities (supabase/migrations/034_opportunities.sql) reuse
    // this same generic details.status pair, but their status values
    // ('open'/'converted'/'closed') need their own translated labels —
    // every other entity_type using this field (projects) already
    // carries admin-managed, already-display-ready status names.
    const opportunityStatusLabels: Record<string, string> =
      row.entity_type === "opportunity" ? c.opportunityStatusLabels : {};
    const from = opportunityStatusLabels[details.status[0] ?? ""] ?? details.status[0] ?? "—";
    const to = opportunityStatusLabels[details.status[1] ?? ""] ?? details.status[1] ?? "—";
    chips.push(c.statusTransition(from, to));
  }

  if (details.converted_to_type) {
    chips.push(details.converted_to_type === "project" ? c.convertedToProject : c.convertedToReceiver);
  }

  const priorityPair = asPair(details.priority);
  if (priorityPair) {
    chips.push(c.priorityTransition(labelled(priorityPair[0], priorityLabels), labelled(priorityPair[1], priorityLabels)));
  }

  if (details.archived) {
    chips.push(details.archived[1] ? c.archived : c.unarchived);
  }

  if (details.is_recovery) {
    chips.push(details.is_recovery[1] ? c.markedRecovery : c.unmarkedRecovery);
  }

  if (details.full_name) {
    const [before, after] = details.full_name;
    if (before !== after) chips.push(c.renamed(before ?? "—", after ?? "—"));
  }

  if (details.document_type) {
    chips.push(details.document_type);
  }

  if (details.kind) {
    const timelineLabels = getDictionary(lang).projectTimeline;
    chips.push(details.kind === "step_taken" ? timelineLabels.stepTaken : timelineLabels.nextStep);
  }

  if (details.done) {
    chips.push(details.done[1] ? c.markedDone : c.reopened);
  }

  if (details.name) {
    const [before, after] = details.name;
    if (before !== after) chips.push(c.renamed(before ?? "—", after ?? "—"));
  }

  if (details.nickname) {
    const [before, after] = details.nickname;
    if (before !== after) {
      if (after && !before) chips.push(c.nicknameSet(after));
      else if (before && !after) chips.push(c.nicknameRemoved(before));
      else if (before && after) chips.push(c.nicknameChanged(before, after));
    }
  }

  if (details.active) {
    const isUser = row.entity_type === "user";
    chips.push(details.active[1] ? (isUser ? c.reactivated : c.shown) : isUser ? c.deactivated : c.hidden);
  }

  if (details.default_currency) {
    chips.push(c.defaultCurrencyTransition(details.default_currency[0], details.default_currency[1]));
  }

  if (details.stuck_after_days) {
    chips.push(c.stuckAfterTransition(String(details.stuck_after_days[0]), String(details.stuck_after_days[1])));
  }

  if (details.show_recovery) {
    chips.push(details.show_recovery[1] ? c.recoveryShown : c.recoveryHidden);
  }

  if (details.role) {
    chips.push(c.roleTransition(details.role[0] ?? "—", details.role[1] ?? "—"));
  }

  if (details.event === "password_reset") {
    chips.push(c.passwordReset);
  }

  if (details.product) {
    chips.push(details.product);
  }

  if (details.final_product) {
    const [before, after] = details.final_product;
    if (after && !before) chips.push(c.finalProductChosen(after));
    else if (after && before && after !== before) chips.push(c.finalProductChanged(before, after));
    else if (!after && before) chips.push(c.finalProductUndone);
  }

  if (details.is_reminder) {
    chips.push(c.reminder);
  }

  if (details.reminder_done) {
    chips.push(details.reminder_done[1] ? c.reminderDone : c.reminderReopened);
  }

  // project_intermediary's only UPDATE is a reorder (position moving);
  // receiver_intermediary never updates (only created/deleted), so
  // details.position is always a scalar there, never reached here.
  if (Array.isArray(details.position)) {
    chips.push(c.movedPosition(String(details.position[0]), String(details.position[1])));
  }

  const rest = (details.fields ?? []).filter(
    (f) => !FIELDS_DESCRIBED_SEPARATELY.has(f) && !(f === "title" && row.entity_type === "opportunity")
  );
  if (rest.length > 0) {
    chips.push(c.fieldsChanged(rest.map((f) => fieldLabel(f, row.entity_type, lang)).join(", ")));
  }

  return chips;
}

/** The row an activity row points at. */
export interface ActivityTarget {
  table: "projects" | "contacts" | "people" | "opportunities" | "notes";
  id: string;
}

export function activityTarget(row: ActivityLog): ActivityTarget | null {
  switch (row.entity_type) {
    case "project":
      return { table: "projects", id: row.entity_id };
    case "contact":
      return { table: "contacts", id: row.entity_id };
    case "opportunity":
      return { table: "opportunities", id: row.entity_id };
    // Documents and products have no page of their own, so they point
    // at their owner.
    case "project_document":
    case "project_step":
    case "project_product":
    case "project_intermediary":
    case "project_tranche":
      return row.details?.parent_id ? { table: "projects", id: row.details.parent_id } : null;
    case "contact_product":
    case "contact_document":
    case "receiver_intermediary":
      return row.details?.parent_id ? { table: "contacts", id: row.details.parent_id } : null;
    case "opportunity_document":
      return row.details?.parent_id ? { table: "opportunities", id: row.details.parent_id } : null;
    case "note_participant":
    case "note_document":
      return row.details?.parent_id ? { table: "notes", id: row.details.parent_id } : null;
    // A note's parent is a project, a contact, an opportunity, or none
    // at all — chosen dynamically per row instead of being fixed by
    // entity_type. Falling back to the note's own page (a meeting has
    // one; /notes/[id] redirects to the edit page for a plain note)
    // rather than null means even an unlinked note's own activity rows
    // still go somewhere.
    case "note":
      if (!row.details?.parent_id || !row.details?.parent_type) return { table: "notes", id: row.entity_id };
      if (row.details.parent_type === "project") return { table: "projects", id: row.details.parent_id };
      if (row.details.parent_type === "opportunity") return { table: "opportunities", id: row.details.parent_id };
      return { table: "contacts", id: row.details.parent_id };
    case "person":
      return { table: "people", id: row.entity_id };
    default:
      return null;
  }
}

const TARGET_HREF_PREFIX: Record<ActivityTarget["table"], string> = {
  projects: "/projects",
  contacts: "/receivers",
  people: "/people",
  opportunities: "/opportunities",
  notes: "/notes",
};

/**
 * Link to the record an activity row is about, or null when there is
 * nothing to link to: the record itself was deleted, or it has since been
 * deleted and so is absent from `existing` (which avoids linking users
 * straight into a 404).
 */
export function activityHref(row: ActivityLog, existing: Set<string>): string | null {
  if (row.action === "deleted" && !isDocumentEntity(row.entity_type)) return null;

  const target = activityTarget(row);
  if (!target || !existing.has(`${target.table}:${target.id}`)) return null;

  return `${TARGET_HREF_PREFIX[target.table]}/${target.id}`;
}

export function targetKey(table: ActivityTarget["table"], id: string): string {
  return `${table}:${id}`;
}

/** HH:MM in the fixed business timezone, matching formatDateTime. */
export function formatActivityTime(value: string, lang: Lang = "en"): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = String(Number(parts.find((p) => p.type === "minute")?.value)).padStart(2, "0");
  return lang === "es"
    ? `${hour}:${minute}`
    : `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Stable per-day bucket key, in the fixed business timezone — not
 * whatever timezone the server process happens to default to. */
export function activityDayKey(value: string): string {
  return dateKeyInTimeZone(value);
}

export function formatActivityDayHeading(dayKey: string, lang: Lang = "en"): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  // A locally-constructed Date here (as opposed to parsing dayKey as a
  // UTC string) is safe and intentional: it's only used below for
  // getTime() day-diffing and toLocaleDateString's weekday/month/day —
  // never with an explicit `timeZone` option, which would risk shifting
  // the calendar day this key already pins.
  const date = new Date(year, month - 1, day);

  const todayKey = dateKeyInTimeZone(new Date().toISOString());
  const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
  const today = new Date(todayYear, todayMonth - 1, todayDay);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  const t = getDictionary(lang).activity;
  if (diffDays === 0) return t.today;
  if (diffDays === 1) return t.yesterday;

  if (lang === "es") {
    const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${WEEKDAYS_ES[date.getDay()]}, ${day} ${MONTHS_ES[month - 1]} ${year}`;
  }

  return date.toLocaleDateString(LOCALE, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface ActivityDayGroup {
  dayKey: string;
  heading: string;
  rows: ActivityLog[];
}

/** Groups rows (already newest-first) into newest-first day buckets. */
export function groupActivityByDay(rows: ActivityLog[], lang: Lang = "en"): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];

  for (const row of rows) {
    const dayKey = activityDayKey(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.rows.push(row);
    } else {
      groups.push({ dayKey, heading: formatActivityDayHeading(dayKey, lang), rows: [row] });
    }
  }

  return groups;
}
