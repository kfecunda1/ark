import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage } from "@/lib/telegram";
import { BUSINESS_LINE_LABELS } from "@/lib/leads";
import { truncate } from "@/lib/procedures";
import type { Contact, Lead, Note, Procedure } from "@/lib/types";

// Scheduled in vercel.json at "0 12 * * *" — 12:00 UTC, i.e. 8:00 AM in
// Curaçao/Suriname (UTC-4, no DST). Vercel Cron schedules are UTC-only,
// so that offset is baked into the cron expression itself; if the
// relevant timezone ever changes, update both the schedule there and
// this comment.
//
// Notify-once strategy: a reminder is included in exactly one digest (the
// first run on/after its due date), then reminded_at is stamped so it's
// never picked up again — it does not re-notify daily until resolved.
// Picked for simplicity and to avoid daily repeat-spam for a reminder
// nobody has gotten around to dismissing yet; revisit if that turns out
// to be the wrong tradeoff in practice.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For manually verifying the digest content without sending a real
  // Telegram message or consuming reminders (reminded_at is left alone).
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Piggybacks on this existing daily cron rather than adding a third
  // schedule — telegram_processed_updates exists only so the webhook can
  // recognize a Telegram retry (see migration 020), so rows older than
  // any plausible retry window are safe to drop; 14 days gives generous
  // headroom. Skipped on a dry run along with everything else below that
  // writes, consistent with ?dryRun=true touching nothing.
  if (!dryRun) {
    const pruneCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { error: pruneError } = await supabase
      .from("telegram_processed_updates")
      .delete()
      .lt("created_at", pruneCutoff);
    if (pruneError) {
      console.error("[reminders-digest] failed to prune telegram_processed_updates:", pruneError.message);
    }
  }

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("is_reminder", true)
    .lte("due_date", today)
    .is("reminded_at", null)
    .order("due_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notes = (data as Note[] | null) ?? [];
  if (notes.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "No reminders due.", count: 0 });
  }

  const leadIds = notes.map((n) => n.lead_id).filter((id): id is string => Boolean(id));
  const procedureIds = notes.map((n) => n.procedure_id).filter((id): id is string => Boolean(id));
  const contactIds = notes.map((n) => n.contact_id).filter((id): id is string => Boolean(id));

  const [{ data: leadsData }, { data: proceduresData }, { data: contactsData }] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("leads").select("id, business_line, product_type").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    procedureIds.length > 0
      ? supabase.from("procedures").select("id, title, raw_content").in("id", procedureIds)
      : Promise.resolve({ data: [] }),
    contactIds.length > 0
      ? supabase.from("contacts").select("id, full_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
  ]);

  const leadsById = new Map(
    ((leadsData as Pick<Lead, "id" | "business_line" | "product_type">[] | null) ?? []).map((l) => [l.id, l])
  );
  const proceduresById = new Map(
    ((proceduresData as Pick<Procedure, "id" | "title" | "raw_content">[] | null) ?? []).map((p) => [p.id, p])
  );
  const contactsById = new Map(
    ((contactsData as Pick<Contact, "id" | "full_name">[] | null) ?? []).map((c) => [c.id, c])
  );

  function linkLabel(note: Note): string | null {
    if (note.lead_id) {
      const lead = leadsById.get(note.lead_id);
      return lead ? `Lead: ${BUSINESS_LINE_LABELS[lead.business_line]} — ${lead.product_type}` : "Lead";
    }
    if (note.procedure_id) {
      const procedure = proceduresById.get(note.procedure_id);
      return `Procedure: ${procedure ? procedure.title || truncate(procedure.raw_content, 40) : "—"}`;
    }
    if (note.contact_id) {
      const contact = contactsById.get(note.contact_id);
      return `Contact: ${contact?.full_name ?? "—"}`;
    }
    return null;
  }

  const lines = notes.map((note, i) => {
    const label = note.title || truncate(note.content, 60);
    const link = linkLabel(note);
    const overdue = note.due_date && note.due_date < today;
    const dueNote = overdue ? ` (overdue, was due ${note.due_date})` : "";
    return `${i + 1}. ${label}${dueNote}${link ? `\n   ${link}` : ""}`;
  });

  const message = `⏰ Reminders due (${today}):\n\n${lines.join("\n")}`;

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count: notes.length, message, noteIds: notes.map((n) => n.id) });
  }

  const chatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const sendResults = await Promise.all(chatIds.map((chatId) => sendTelegramMessage(chatId, message)));
  sendResults.forEach((result, i) => {
    if (!result.ok) {
      console.error(`[reminders-digest] failed to notify chat ${chatIds[i]}:`, result.error);
    }
  });

  const { error: updateError } = await supabase
    .from("notes")
    .update({ reminded_at: new Date().toISOString() })
    .in(
      "id",
      notes.map((n) => n.id)
    );

  if (updateError) {
    console.error("[reminders-digest] failed to mark reminded_at:", updateError.message);
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    count: notes.length,
    chatResults: chatIds.map((chatId, i) => ({ chatId, ...sendResults[i] })),
  });
}
