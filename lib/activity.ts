import { BUSINESS_LINE_LABELS, PRIORITY_LABELS, STAGE_LABELS } from "@/lib/leads";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/procedures";
import type { ActivityAction, ActivityDetails, ActivityEntityType, ActivityLog } from "@/lib/types";

// The four buckets the Activity page filters by. "document" covers both
// lead_document and procedure_document, since from the user's point of
// view a document is a document.
export type ActivityFilter = "lead" | "procedure" | "contact" | "document";

export const ACTIVITY_FILTERS: ActivityFilter[] = ["lead", "procedure", "contact", "document"];

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  lead: "Leads",
  procedure: "Procedures",
  contact: "Contacts",
  document: "Documents",
};

export const ACTIVITY_FILTER_ENTITY_TYPES: Record<ActivityFilter, ActivityEntityType[]> = {
  lead: ["lead"],
  procedure: ["procedure"],
  contact: ["contact"],
  document: ["lead_document", "procedure_document"],
};

export function parseActivityFilter(value: string | undefined): ActivityFilter | null {
  return ACTIVITY_FILTERS.includes(value as ActivityFilter) ? (value as ActivityFilter) : null;
}

export const ENTITY_TYPE_LABELS: Record<ActivityEntityType, string> = {
  lead: "Lead",
  procedure: "Procedure",
  contact: "Contact",
  lead_document: "Lead document",
  procedure_document: "Procedure document",
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
};

export function isDocumentEntity(entityType: ActivityEntityType): boolean {
  return entityType === "lead_document" || entityType === "procedure_document";
}

// Column names as they appear in details.fields, prettified for display.
const FIELD_LABELS: Record<string, string> = {
  // leads
  business_line: "business line",
  product_type: "product type",
  procedure_type: "procedure type",
  primary_contact_id: "primary contact",
  counterparty_contact_id: "counterparty",
  deal_value: "deal value",
  currency: "currency",
  source: "source",
  notes: "notes",
  follow_up_date: "follow-up date",
  assigned_to: "assigned to",
  priority: "priority",
  stage: "stage",
  archived: "archived",
  // procedures
  title: "title",
  raw_content: "content",
  area: "area",
  status: "status",
  contact_id: "contact",
  telegram_chat_id: "Telegram chat",
  intended_as_lead: "intended as lead",
  // contacts
  full_name: "name",
  phone: "phone",
  email: "email",
  // documents
  document_type: "document type",
  file_name: "file name",
  file_path: "file path",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

// Fields whose change is already spelled out as its own "x -> y" chip, so
// listing them again under "fields changed" would just be repetition.
const FIELDS_DESCRIBED_SEPARATELY = new Set(["stage", "status", "priority", "archived", "full_name"]);

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

/**
 * Short human-readable bits describing one activity row — the "what
 * exactly changed" column on the Activity page. Plain strings, so the
 * digest can reuse the same wording in a Telegram message.
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

  const statusPair = asPair(details.status);
  if (statusPair) {
    chips.push(`status ${transition(statusPair, STATUS_LABELS)}`);
  } else if (row.action !== "updated") {
    const status = asScalar(details.status);
    if (status) chips.push(`status ${labelled(status, STATUS_LABELS)}`);
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

  if (row.action === "created" && details.business_line) {
    chips.push(BUSINESS_LINE_LABELS[details.business_line]);
  }

  if (row.action === "created" && details.source) {
    chips.push(SOURCE_LABELS[details.source]);
  }

  if (details.document_type) {
    chips.push(details.document_type);
  }

  const rest = (details.fields ?? []).filter((f) => !FIELDS_DESCRIBED_SEPARATELY.has(f));
  if (rest.length > 0) {
    chips.push(`${rest.map(fieldLabel).join(", ")} changed`);
  }

  return chips;
}

/** The leads/procedures/contacts row an activity row points at. */
export interface ActivityTarget {
  table: "leads" | "procedures" | "contacts";
  id: string;
}

export function activityTarget(row: ActivityLog): ActivityTarget | null {
  switch (row.entity_type) {
    case "lead":
      return { table: "leads", id: row.entity_id };
    case "procedure":
      return { table: "procedures", id: row.entity_id };
    case "contact":
      return { table: "contacts", id: row.entity_id };
    // Documents have no page of their own, so they point at their owner.
    case "lead_document":
      return row.details?.parent_id ? { table: "leads", id: row.details.parent_id } : null;
    case "procedure_document":
      return row.details?.parent_id ? { table: "procedures", id: row.details.parent_id } : null;
    default:
      return null;
  }
}

const TARGET_HREF_PREFIX: Record<ActivityTarget["table"], string> = {
  leads: "/leads",
  procedures: "/procedures",
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

/** Local-time HH:MM, matching the timezone the rest of the app renders in. */
export function formatActivityTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Stable per-day bucket key in the server's local timezone. */
export function activityDayKey(value: string): string {
  const d = new Date(value);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function formatActivityDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return date.toLocaleDateString(undefined, {
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
