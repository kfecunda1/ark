import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildDocumentPath, computeFileHash } from "@/lib/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Procedure } from "@/lib/types";

interface TelegramChat {
  id: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface DownloadedFile {
  path: string;
  fileName: string;
  hash: string;
}

const FILE_PLACEHOLDER = "(no caption)";
const MERGE_WINDOW_MS = 2 * 60 * 1000;
const LEAD_PREFIX_RE = /^\/lead ?/i;

// Strips a leading "/lead" (optionally followed by a single space) from
// text or a caption, case-insensitively, and reports whether it was
// present. If stripping leaves nothing behind, falls back to the same
// placeholder used for captionless file messages.
function stripLeadPrefix(text: string): { content: string; isLead: boolean } {
  if (!LEAD_PREFIX_RE.test(text)) return { content: text, isLead: false };
  const stripped = text.replace(LEAD_PREFIX_RE, "").trim();
  return { content: stripped || FILE_PLACEHOLDER, isLead: true };
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const update = (await request.json()) as TelegramUpdate;

    if (update.update_id != null) {
      const isNewUpdate = await claimUpdateId(supabase, update.update_id);
      if (!isNewUpdate) {
        // Telegram retried an update we've already processed (it retries
        // aggressively on anything but a prompt 2xx) — ack without doing
        // anything further, so the retry can't create a second procedure
        // or double-merge a message into an existing one.
        return NextResponse.json({ ok: true });
      }
    }

    await handleUpdate(supabase, update);
  } catch (err) {
    console.error("[telegram-webhook] failed to process update:", err);
  }

  // Always ack quickly — Telegram retries aggressively on non-2xx/timeout.
  return NextResponse.json({ ok: true });
}

// Records that this update_id has been seen, returning true the first
// time (insert succeeded) and false if it's a retry of one already
// recorded (23505 = unique_violation on the primary key). Any other
// error fails open — process the update anyway rather than silently
// dropping a legitimate message over a transient DB hiccup.
async function claimUpdateId(supabase: SupabaseClient, updateId: number): Promise<boolean> {
  const { error } = await supabase.from("telegram_processed_updates").insert({ update_id: updateId });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[telegram-webhook] failed to record update_id, processing anyway:", error.message);
  return true;
}

async function handleUpdate(supabase: SupabaseClient, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat?.id;
  const allowedChatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (chatId == null || !allowedChatIds.includes(String(chatId))) {
    return;
  }

  const file = largestPhoto(message.photo) ?? message.document ?? null;
  const isFileMessage = Boolean(file);

  let incomingRawContent: string | null = null;
  let incomingFile: DownloadedFile | null = null;
  let incomingIsLead = false;

  if (file) {
    const fileName = "file_name" in file ? file.file_name : undefined;
    incomingFile = await downloadAndStoreTelegramFile(supabase, file.file_id, fileName);
    const caption = message.caption?.trim();
    if (caption) {
      const stripped = stripLeadPrefix(caption);
      incomingRawContent = stripped.content;
      incomingIsLead = stripped.isLead;
    } else {
      incomingRawContent = FILE_PLACEHOLDER;
    }
  } else if (message.text?.trim()) {
    const stripped = stripLeadPrefix(message.text.trim());
    incomingRawContent = stripped.content;
    incomingIsLead = stripped.isLead;
  }

  if (!incomingRawContent) return;

  // Look for a recent, still-unmatched procedure from the same chat to
  // merge into — Telegram sends a photo/caption and a follow-up text (or
  // vice versa) as two separate messages, not one update.
  const existing = await findRecentUnmatchedTelegramProcedure(supabase, chatId);

  if (existing) {
    // A "/lead"-flagged message carries its flag onto whatever procedure
    // it merges into, but a merge never clears a flag already set.
    const carryLeadFlag = incomingIsLead && !existing.intended_as_lead;

    if (!isFileMessage && existing.raw_content === FILE_PLACEHOLDER) {
      const { error } = await supabase
        .from("procedures")
        .update({
          raw_content: `${existing.raw_content}\n${incomingRawContent}`,
          ...(carryLeadFlag ? { intended_as_lead: true } : {}),
        })
        .eq("id", existing.id);
      if (error) {
        console.error("[telegram-webhook] failed to merge text into existing procedure:", error.message);
      }
      return;
    }

    if (isFileMessage) {
      if (carryLeadFlag) {
        const { error: flagError } = await supabase
          .from("procedures")
          .update({ intended_as_lead: true })
          .eq("id", existing.id);
        if (flagError) {
          console.error("[telegram-webhook] failed to carry lead flag onto existing procedure:", flagError.message);
        }
      }

      // Multiple documents are supported now, so an incoming file
      // normally attaches as an additional document to the matched
      // procedure — unless this exact file (by hash) is already on it,
      // which happens when Telegram retries an update (a duplicate the
      // update_id guard above doesn't catch if it slipped in as a
      // *different* update_id carrying the same file, e.g. a forwarded
      // repeat): skip attaching and remove the copy just uploaded to
      // storage rather than leaving an orphaned duplicate object behind.
      if (incomingFile) {
        const alreadyAttached = await procedureHasFileHash(supabase, existing.id, incomingFile.hash);
        if (alreadyAttached) {
          const { error: removeError } = await supabase.storage
            .from("procedure-documents")
            .remove([incomingFile.path]);
          if (removeError) {
            console.error(
              "[telegram-webhook] failed to remove duplicate file upload:",
              removeError.message
            );
          }
        } else {
          const { error } = await supabase.from("procedure_documents").insert({
            procedure_id: existing.id,
            file_path: incomingFile.path,
            file_name: incomingFile.fileName,
            file_hash: incomingFile.hash,
          });
          if (error) {
            console.error("[telegram-webhook] failed to attach document to existing procedure:", error.message);
          }
        }
      }
      return;
    }
  }

  // Flag (but still create) a brand-new procedure whose raw_content
  // exactly matches one already on file — there's no human in this
  // automated path to show the Procedures form's "Add anyway" banner
  // to, so it's surfaced afterwards instead via the possible_duplicate
  // badge on the list/detail views. Skipped for the generic captionless-
  // file placeholder, which is not real content and would otherwise
  // flag nearly every photo/document message as a duplicate of every
  // other one.
  let possibleDuplicate = false;
  if (incomingRawContent !== FILE_PLACEHOLDER) {
    const { data: duplicateRow, error: duplicateError } = await supabase
      .from("procedures")
      .select("id")
      .eq("raw_content", incomingRawContent)
      .limit(1)
      .maybeSingle();
    if (duplicateError) {
      console.error("[telegram-webhook] duplicate raw_content check failed:", duplicateError.message);
    } else {
      possibleDuplicate = Boolean(duplicateRow);
    }
  }

  const { data: inserted, error } = await supabase
    .from("procedures")
    .insert({
      source: "telegram",
      raw_content: incomingRawContent,
      telegram_chat_id: chatId,
      area: null,
      status: "unmatched",
      intended_as_lead: incomingIsLead,
      possible_duplicate: possibleDuplicate,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[telegram-webhook] failed to insert procedure:", error?.message);
    return;
  }

  if (incomingFile) {
    const { error: docError } = await supabase.from("procedure_documents").insert({
      procedure_id: inserted.id,
      file_path: incomingFile.path,
      file_name: incomingFile.fileName,
      file_hash: incomingFile.hash,
    });
    if (docError) {
      console.error("[telegram-webhook] failed to insert procedure document:", docError.message);
    }
  }
}

async function procedureHasFileHash(
  supabase: SupabaseClient,
  procedureId: string,
  hash: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("procedure_documents")
    .select("id")
    .eq("procedure_id", procedureId)
    .eq("file_hash", hash)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[telegram-webhook] file_hash lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

async function findRecentUnmatchedTelegramProcedure(
  supabase: SupabaseClient,
  chatId: number
): Promise<Procedure | null> {
  const cutoff = new Date(Date.now() - MERGE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("procedures")
    .select("*")
    .eq("source", "telegram")
    .eq("status", "unmatched")
    .eq("telegram_chat_id", chatId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[telegram-webhook] failed to look up recent procedure:", error.message);
    return null;
  }

  return data as Procedure | null;
}

function largestPhoto(photos?: TelegramPhotoSize[]): TelegramPhotoSize | null {
  if (!photos || photos.length === 0) return null;
  // Telegram lists photo sizes smallest to largest.
  return photos[photos.length - 1];
}

async function downloadAndStoreTelegramFile(
  supabase: SupabaseClient,
  fileId: string,
  fileName?: string
): Promise<DownloadedFile | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("[telegram-webhook] TELEGRAM_BOT_TOKEN is not set; skipping file download.");
    return null;
  }

  try {
    const getFileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const getFileBody = await getFileRes.json();
    const filePath: string | undefined = getFileBody?.result?.file_path;

    if (!getFileRes.ok || !getFileBody?.ok || !filePath) {
      console.error("[telegram-webhook] getFile failed:", getFileBody);
      return null;
    }

    const downloadRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!downloadRes.ok) {
      console.error("[telegram-webhook] file download failed with status:", downloadRes.status);
      return null;
    }

    const fileBuffer = await downloadRes.arrayBuffer();
    const contentType = downloadRes.headers.get("content-type") ?? "application/octet-stream";
    const resolvedFileName = fileName ?? filePath.split("/").pop() ?? "telegram-file";
    const storagePath = buildDocumentPath(resolvedFileName);
    const hash = await computeFileHash(fileBuffer);

    const { error } = await supabase.storage
      .from("procedure-documents")
      .upload(storagePath, fileBuffer, { contentType, upsert: false });

    if (error) {
      console.error("[telegram-webhook] storage upload failed:", error.message);
      return null;
    }

    return { path: storagePath, fileName: resolvedFileName, hash };
  } catch (err) {
    console.error("[telegram-webhook] error downloading/storing file:", err);
    return null;
  }
}
