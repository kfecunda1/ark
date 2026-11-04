import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage } from "@/lib/telegram";
import { ENTITY_TYPE_LABELS, fieldLabel, isDocumentEntity } from "@/lib/activity";
import { PRIORITY_LABELS, STAGE_LABELS } from "@/lib/leads";
import { STATUS_LABELS, truncate } from "@/lib/procedures";
import type {
  ActivityEntityType,
  ActivityLog,
  Contact,
  Lead,
  LeadPriority,
  LeadStage,
  Procedure,
  ProcedureStatus,
} from "@/lib/types";

// Scheduled in vercel.json at "0 1 * * *" — 01:00 UTC, i.e. 9:00 PM the
// previous evening in Curaçao (UTC-4, no DST). Vercel Cron schedules are
// UTC-only, so that offset is baked into the cron expression itself; if
// the relevant timezone ever changes, update both the schedule there and
// this comment. The reminders digest keeps its own separate 12:00 UTC
// schedule.
//
// Notify-once strategy: every activity_log row is reported in exactly one
// digest, then stamped with notified_at. The query is "notified_at is
// null" with no date floor, so a run that fails (or a day the cron did
// not fire) is not lost — those rows simply roll into the next digest.
//
// Telegram's 4096-character cap is handled by splitting into several
// messages, and notified_at is set only on the rows whose message was
// actually delivered. A chunk nobody received stays un-notified and is
// retried tomorrow rather than silently dropped.

// Telegram's hard per-message limit.
const TELEGRAM_MAX_CHARS = 4096;
// Room set aside for the "Activity <date> (2/3):" header prepended after
// packing, so a full chunk plus its header still fits the limit.
const HEADER_BUDGET = 80;
// Defensive per-line cap: keeps one pathological summary from blowing past
// the limit on its own, and keeps the message readable.
const MAX_LINE_CHARS = 500;
const MAX_LABEL_CHARS = 80;

/**
 * One digest line's worth of state: everything that happened to a single
 * record since the last digest, including events on its documents.
 */
interface RecordGroup {
  key: string;
  // The record the line is about. Normally lead/procedure/contact; falls
  // back to the document's own type if a document row somehow has no
  // parent recorded.
  entityType: ActivityEntityType;
  entityId: string;
  firstAt: string;
  // Newest summary seen on the record's own rows (document rows carry
  // file names, which must not be mistaken for the record's label).
  summary: string | null;
  created: boolean;
  deleted: boolean;
  updated: boolean;
  stageFrom: LeadStage | null;
  stageTo: LeadStage | null;
  statusFrom: ProcedureStatus | null;
  statusTo: ProcedureStatus | null;
  priorityFrom: LeadPriority | null;
  priorityTo: LeadPriority | null;
  archivedTo: boolean | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  fields: Set<string>;
  docsAdded: number;
  docsRemoved: number;
  docsUpdated: number;
  rowIds: string[];
}

// Changes that get their own clause, so they are not repeated in the
// trailing "<fields> changed" list.
const FIELDS_DESCRIBED_SEPARATELY = new Set(["stage", "status", "priority", "archived", "full_name"]);

function pair<T>(value: T | [T, T] | undefined): [T, T] | null {
  return Array.isArray(value) ? (value as [T, T]) : null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Groups rows (oldest first) by the record they concern. */
function groupByRecord(rows: ActivityLog[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();

  for (const row of rows) {
    const details = row.details ?? {};
    const isDoc = isDocumentEntity(row.entity_type);

    // A document rolls up into the record it hangs off, so one record is
    // still one line.
    const entityType: ActivityEntityType =
      isDoc && details.parent_type ? details.parent_type : row.entity_type;
    const entityId = isDoc && details.parent_id ? details.parent_id : row.entity_id;
    const key = `${entityType}:${entityId}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        entityType,
        entityId,
        firstAt: row.created_at,
        summary: null,
        created: false,
        deleted: false,
        updated: false,
        stageFrom: null,
        stageTo: null,
        statusFrom: null,
        statusTo: null,
        priorityFrom: null,
        priorityTo: null,
        archivedTo: null,
        renamedFrom: null,
        renamedTo: null,
        fields: new Set<string>(),
        docsAdded: 0,
        docsRemoved: 0,
        docsUpdated: 0,
        rowIds: [],
      };
      groups.set(key, group);
    }

    group.rowIds.push(row.id);

    if (isDoc) {
      if (row.action === "created") group.docsAdded += 1;
      else if (row.action === "deleted") group.docsRemoved += 1;
      else group.docsUpdated += 1;
      continue;
    }

    // Rows arrive oldest first, so the last summary wins and multiple
    // hops collapse into one before -> after pair.
    if (row.summary) group.summary = row.summary;

    if (row.action === "created") group.created = true;
    else if (row.action === "deleted") group.deleted = true;
    else group.updated = true;

    const stage = pair(details.stage);
    if (stage) {
      if (group.stageFrom === null) group.stageFrom = stage[0];
      group.stageTo = stage[1];
    }

    const status = pair(details.status);
    if (status) {
      if (group.statusFrom === null) group.statusFrom = status[0];
      group.statusTo = status[1];
    }

    const priority = pair(details.priority);
    if (priority) {
      if (group.priorityFrom === null) group.priorityFrom = priority[0];
      group.priorityTo = priority[1];
    }

    if (details.archived) group.archivedTo = details.archived[1];

    if (details.full_name) {
      if (group.renamedFrom === null) group.renamedFrom = details.full_name[0];
      group.renamedTo = details.full_name[1];
    }

    for (const field of details.fields ?? []) {
      if (!FIELDS_DESCRIBED_SEPARATELY.has(field)) group.fields.add(field);
    }
  }

  return [...groups.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}

/** Lowercase "new -> in progress", matching the digest's prose style. */
function transition<T extends string>(from: T, to: T, labels: Record<T, string>): string {
  const label = (v: T) => (labels[v] ?? v).toLowerCase();
  return `${label(from)} -> ${label(to)}`;
}

function describeGroup(group: RecordGroup): string[] {
  const parts: string[] = [];

  if (group.created && group.deleted) parts.push("created, then deleted");
  else if (group.created) parts.push("created");
  else if (group.deleted) parts.push("deleted");

  if (group.stageFrom && group.stageTo && group.stageFrom !== group.stageTo) {
    parts.push(`stage ${transition(group.stageFrom, group.stageTo, STAGE_LABELS)}`);
  }
  if (group.statusFrom && group.statusTo && group.statusFrom !== group.statusTo) {
    parts.push(`status ${transition(group.statusFrom, group.statusTo, STATUS_LABELS)}`);
  }
  if (group.priorityFrom && group.priorityTo && group.priorityFrom !== group.priorityTo) {
    parts.push(`priority ${transition(group.priorityFrom, group.priorityTo, PRIORITY_LABELS)}`);
  }
  if (group.archivedTo !== null) {
    parts.push(group.archivedTo ? "archived" : "unarchived");
  }
  if (group.renamedTo !== null && group.renamedFrom !== group.renamedTo) {
    parts.push(`renamed from ${group.renamedFrom ?? "—"}`);
  }

  if (group.fields.size > 0) {
    parts.push(`${[...group.fields].map(fieldLabel).sort().join(", ")} changed`);
  } else if (group.updated && !group.created && !group.deleted && parts.length === 0) {
    parts.push("updated");
  }

  if (group.docsAdded > 0) parts.push(`${plural(group.docsAdded, "document")} added`);
  if (group.docsUpdated > 0) parts.push(`${plural(group.docsUpdated, "document")} updated`);
  // A record that is gone explains its own documents going with it — this
  // is what collapses Convert to Lead's document moves (and any parent
  // deletion) instead of listing them as removals.
  if (group.docsRemoved > 0 && !group.deleted) {
    parts.push(`${plural(group.docsRemoved, "document")} removed`);
  }

  return parts;
}

interface Chunk {
  text: string;
  rowIds: string[];
}

/** Packs lines into as few Telegram-sized messages as possible. */
function chunkLines(lines: { text: string; rowIds: string[] }[], today: string): Chunk[] {
  const budget = TELEGRAM_MAX_CHARS - HEADER_BUDGET;
  const packed: { texts: string[]; rowIds: string[] }[] = [];

  for (const line of lines) {
    const current = packed[packed.length - 1];
    // +1 for the newline that will join it to the previous line.
    if (current && current.texts.join("\n").length + 1 + line.text.length <= budget) {
      current.texts.push(line.text);
      current.rowIds.push(...line.rowIds);
    } else {
      packed.push({ texts: [line.text], rowIds: [...line.rowIds] });
    }
  }

  return packed.map((chunk, i) => {
    const header =
      packed.length === 1 ? `Activity ${today}:` : `Activity ${today} (${i + 1}/${packed.length}):`;
    return { text: `${header}\n\n${chunk.texts.join("\n")}`, rowIds: chunk.rowIds };
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For manually verifying the digest content without sending a real
  // Telegram message or consuming any rows (notified_at is left alone).
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Oldest first, so transitions collapse in the order they happened.
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .is("notified_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as ActivityLog[] | null) ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "No activity since the last digest.", count: 0 });
  }

  const groups = groupByRecord(rows);

  // A group made up only of document events has no summary of its own, so
  // look the owning record's label up the same way the triggers do.
  const needLabel = groups.filter((g) => !g.summary);
  const leadIds = needLabel.filter((g) => g.entityType === "lead").map((g) => g.entityId);
  const procedureIds = needLabel.filter((g) => g.entityType === "procedure").map((g) => g.entityId);
  const contactIds = needLabel.filter((g) => g.entityType === "contact").map((g) => g.entityId);

  const [{ data: leadsData }, { data: proceduresData }, { data: contactsData }] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("leads").select("id, primary_contact_id, product_type").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    procedureIds.length > 0
      ? supabase.from("procedures").select("id, title, raw_content").in("id", procedureIds)
      : Promise.resolve({ data: [] }),
    contactIds.length > 0
      ? supabase.from("contacts").select("id, full_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
  ]);

  const leadsById = new Map(
    ((leadsData as Pick<Lead, "id" | "primary_contact_id" | "product_type">[] | null) ?? []).map((l) => [
      l.id,
      l,
    ])
  );
  const proceduresById = new Map(
    ((proceduresData as Pick<Procedure, "id" | "title" | "raw_content">[] | null) ?? []).map((p) => [p.id, p])
  );
  const contactsById = new Map(
    ((contactsData as Pick<Contact, "id" | "full_name">[] | null) ?? []).map((c) => [c.id, c])
  );

  // Primary contact names for the leads looked up above.
  const primaryContactIds = [...leadsById.values()]
    .map((l) => l.primary_contact_id)
    .filter((cid): cid is string => Boolean(cid));
  if (primaryContactIds.length > 0) {
    const { data: extraContacts } = await supabase
      .from("contacts")
      .select("id, full_name")
      .in("id", primaryContactIds);
    for (const contact of ((extraContacts as Pick<Contact, "id" | "full_name">[] | null) ?? [])) {
      contactsById.set(contact.id, contact);
    }
  }

  function labelFor(group: RecordGroup): string {
    if (group.summary) return truncate(group.summary, MAX_LABEL_CHARS);

    if (group.entityType === "lead") {
      const lead = leadsById.get(group.entityId);
      if (!lead) return "—";
      const contactName = lead.primary_contact_id ? contactsById.get(lead.primary_contact_id)?.full_name : null;
      return truncate(contactName || lead.product_type || "Lead", MAX_LABEL_CHARS);
    }
    if (group.entityType === "procedure") {
      const procedure = proceduresById.get(group.entityId);
      if (!procedure) return "—";
      return truncate(procedure.title || procedure.raw_content || "Procedure", MAX_LABEL_CHARS);
    }
    if (group.entityType === "contact") {
      return truncate(contactsById.get(group.entityId)?.full_name || "Contact", MAX_LABEL_CHARS);
    }
    return "—";
  }

  const lines = groups.map((group) => {
    const parts = describeGroup(group);
    const label = labelFor(group);
    const text = `${ENTITY_TYPE_LABELS[group.entityType]}: ${label}${
      parts.length > 0 ? ` - ${parts.join(", ")}` : ""
    }`;
    return { text: truncate(text, MAX_LINE_CHARS), rowIds: group.rowIds };
  });

  const chunks = chunkLines(lines, today);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      count: rows.length,
      records: groups.length,
      messages: chunks.map((c) => c.text),
      activityIds: rows.map((r) => r.id),
    });
  }

  const chatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (chatIds.length === 0) {
    // Nothing was delivered, so nothing may be marked notified — the rows
    // roll into the next run once a chat id is configured.
    console.error("[activity-digest] TELEGRAM_ALLOWED_CHAT_IDS is empty; nothing sent.");
    return NextResponse.json(
      { ok: false, sent: false, reason: "TELEGRAM_ALLOWED_CHAT_IDS is not set.", count: rows.length },
      { status: 500 }
    );
  }

  // Sequential so the chunks land in the chat in order.
  const sentRowIds: string[] = [];
  const chunkResults: { part: number; delivered: string[]; failed: { chatId: string; error?: string }[] }[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const results = await Promise.all(chatIds.map((chatId) => sendTelegramMessage(chatId, chunk.text)));

    const delivered: string[] = [];
    const failed: { chatId: string; error?: string }[] = [];
    results.forEach((result, i) => {
      if (result.ok) {
        delivered.push(chatIds[i]);
      } else {
        failed.push({ chatId: chatIds[i], error: result.error });
        console.error(`[activity-digest] failed to notify chat ${chatIds[i]}:`, result.error);
      }
    });

    // Reported to at least one chat counts as sent; re-sending the whole
    // chunk tomorrow would duplicate it for everyone who did get it.
    if (delivered.length > 0) sentRowIds.push(...chunk.rowIds);

    chunkResults.push({ part: index + 1, delivered, failed });
  }

  if (sentRowIds.length > 0) {
    const { error: updateError } = await supabase
      .from("activity_log")
      .update({ notified_at: new Date().toISOString() })
      .in("id", sentRowIds);

    if (updateError) {
      console.error("[activity-digest] failed to mark notified_at:", updateError.message);
    }
  }

  return NextResponse.json({
    ok: true,
    sent: sentRowIds.length > 0,
    count: rows.length,
    records: groups.length,
    parts: chunks.length,
    notified: sentRowIds.length,
    chunkResults,
  });
}
