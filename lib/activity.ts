import { LOCALE, TIME_ZONE, dateKeyInTimeZone } from "@/lib/format";
import { PRIORITY_LABELS, STAGE_LABELS, STATUS_LABELS } from "@/lib/projects";
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
  contact: "Contacts",
  document: "Documents",
};

export const ACTIVITY_FILTER_ENTITY_TYPES: Record<ActivityFilter, ActivityEntityType[]> = {
  project: ["project", "project_step"],
  contact: ["contact", "contact_product"],
  document: ["project_document", "contact_document"],
};

export function parseActivityFilter(value: string | undefined): ActivityFilter | null {
  return ACTIVITY_FILTERS.includes(value as ActivityFilter) ? (value as ActivityFilter) : null;
}

export const ENTITY_TYPE_LABELS: Record<ActivityEntityType, string> = {
  project: "Project",
  contact: "Contact",
  project_document: "Project document",
  contact_product: "Contact product",
  contact_document: "Contact document",
  project_step: "Timeline entry",
  backup: "Backup",
  password_change: "Password change",
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
};

// Child-entity types whose own 'deleted' row should still link to the
// parent (which, unlike the child, still exists) — originally just the
// two document types, now also project_step entries.
export function isDocumentEntity(entityType: ActivityEntityType): boolean {
  return entityType === "project_document" || entityType === "contact_document" || entityType === "project_step";
}

// Column names as they appear in details.fields, prettified for display.
const FIELD_LABELS: Record<string, string> = {
  // projects
  name: "name",
  product_type: "product type",
  client_contact_id: "client contact",
  assigned_contact_id: "assigned contact",
  matched_contact_id: "matched contact",
  ratio_presented: "ratio presented",
  ratio_real: "ratio real",
  total_face_value: "total face value",
  currency: "currency",
  priority: "priority",
  stage: "stage",
  status: "status",
  archived: "archived",
  // contacts
  full_name: "name",
  // contact products
  ratio: "ratio",
  // documents
  document_type: "document type",
  file_name: "file name",
  file_path: "file path",
  // project steps (timeline)
  kind: "type",
  body: "text",
  due_date: "due date",
  done: "done",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

// Fields whose change is already spelled out as its own "x -> y" chip, so
// listing them again under "fields changed" would just be repetition.
const FIELDS_DESCRIBED_SEPARATELY = new Set(["stage", "status", "priority", "archived", "full_name", "done"]);

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

function transition<T extends string>(pair: [T, T], labels: Record<T, string>): string {
  return `${labelled(pair[0], labels)} -> ${labelled(pair[1], labels)}`;
}

// status's pair can have a null side (a project's very first status, or
// one cleared by moving back out of the Status stage), unlike stage/
// priority which are never null — so this can't reuse the generic
// transition() above without widening labels to accept a null key too.
function statusTransition(pair: [string | null, string | null]): string {
  const label = (value: string | null) => (value ? (STATUS_LABELS as Record<string, string>)[value] ?? value : "—");
  return `${label(pair[0])} -> ${label(pair[1])}`;
}

/**
 * Short human-readable bits describing one activity row — the "what
 * exactly changed" column on the Activity page.
 */
export function activityDetailChips(row: ActivityLog): string[] {
  const details: ActivityDetails = row.details ?? {};
  const chips: string[] = [];

  const stagePair = asPair(details.stage);
  if (stagePair) {
    chips.push(`stage ${transition(stagePair, STAGE_LABELS)}`);
  } else if (row.action !== "updated") {
    const stage = asScalar(details.stage);
    if (stage) chips.push(`stage ${labelled(stage, STAGE_LABELS)}`);
  }

  if (Array.isArray(details.status)) {
    chips.push(`status ${statusTransition(details.status)}`);
  }

  const priorityPair = asPair(details.priority);
  if (priorityPair) {
    chips.push(`priority ${transition(priorityPair, PRIORITY_LABELS)}`);
  }

  if (details.archived) {
    chips.push(details.archived[1] ? "archived" : "unarchived");
  }

  if (details.full_name) {
    const [before, after] = details.full_name;
    if (before !== after) chips.push(`renamed ${before ?? "—"} -> ${after ?? "—"}`);
  }

  if (details.document_type) {
    chips.push(details.document_type);
  }

  if (details.kind) {
    chips.push(details.kind.replace("_", " "));
  }

  if (details.done) {
    chips.push(details.done[1] ? "marked done" : "reopened");
  }

  const rest = (details.fields ?? []).filter((f) => !FIELDS_DESCRIBED_SEPARATELY.has(f));
  if (rest.length > 0) {
    chips.push(`${rest.map(fieldLabel).join(", ")} changed`);
  }

  return chips;
}

/** The projects/contacts row an activity row points at. */
export interface ActivityTarget {
  table: "projects" | "contacts";
  id: string;
}

export function activityTarget(row: ActivityLog): ActivityTarget | null {
  switch (row.entity_type) {
    case "project":
      return { table: "projects", id: row.entity_id };
    case "contact":
      return { table: "contacts", id: row.entity_id };
    // Documents and products have no page of their own, so they point
    // at their owner.
    case "project_document":
    case "project_step":
      return row.details?.parent_id ? { table: "projects", id: row.details.parent_id } : null;
    case "contact_product":
    case "contact_document":
      return row.details?.parent_id ? { table: "contacts", id: row.details.parent_id } : null;
    default:
      return null;
  }
}

const TARGET_HREF_PREFIX: Record<ActivityTarget["table"], string> = {
  projects: "/projects",
  contacts: "/contacts",
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
export function formatActivityTime(value: string): string {
  return new Date(value).toLocaleTimeString(LOCALE, { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

/** Stable per-day bucket key, in the fixed business timezone — not
 * whatever timezone the server process happens to default to. */
export function activityDayKey(value: string): string {
  return dateKeyInTimeZone(value);
}

export function formatActivityDayHeading(dayKey: string): string {
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
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

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
export function groupActivityByDay(rows: ActivityLog[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];

  for (const row of rows) {
    const dayKey = activityDayKey(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.rows.push(row);
    } else {
      groups.push({ dayKey, heading: formatActivityDayHeading(dayKey), rows: [row] });
    }
  }

  return groups;
}
