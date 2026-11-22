import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { telegramDownloadFile, telegramGetFile, telegramSendMessage } from "@/lib/telegram";
import { getDictionary, isLang } from "@/lib/i18n";

// Needs the full Node runtime (crypto.randomUUID, arbitrary-size
// ArrayBuffer handling for up to-20MB files) rather than the Edge
// runtime.
export const runtime = "nodejs";

const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024; // Telegram bot API's own download ceiling

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  title?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

// Telegram Bot API 7.0+ ("forward_origin") replaced the older flat
// forward_from/forward_from_chat/forward_sender_name fields — both
// shapes are handled below since either can show up depending on the
// client that sent the message.
interface TelegramForwardOrigin {
  type: string;
  sender_user?: TelegramUser;
  sender_user_name?: string;
  sender_chat?: { title?: string };
  chat?: { title?: string };
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  media_group_id?: string;
  forward_origin?: TelegramForwardOrigin;
  forward_from?: TelegramUser;
  forward_from_chat?: { title?: string };
  forward_sender_name?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function formatUserName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Unknown";
}

function extractForwardedFrom(message: TelegramMessage): string | null {
  const origin = message.forward_origin;
  if (origin) {
    if (origin.sender_user) return formatUserName(origin.sender_user);
    if (origin.sender_user_name) return origin.sender_user_name;
    if (origin.sender_chat?.title) return origin.sender_chat.title;
    if (origin.chat?.title) return origin.chat.title;
  }
  if (message.forward_from) return formatUserName(message.forward_from);
  if (message.forward_from_chat?.title) return message.forward_from_chat.title;
  if (message.forward_sender_name) return message.forward_sender_name;
  return null;
}

interface ExtractedFile {
  kind: "document" | "photo" | "video";
  fileId: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
}

function extractFile(message: TelegramMessage, updateId: number): ExtractedFile | null {
  if (message.document) {
    return {
      kind: "document",
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? `document_${updateId}`,
      mimeType: message.document.mime_type ?? null,
      fileSize: message.document.file_size ?? null,
    };
  }
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
    return {
      kind: "photo",
      fileId: largest.file_id,
      fileName: `photo_${updateId}.jpg`,
      mimeType: "image/jpeg",
      fileSize: largest.file_size ?? null,
    };
  }
  if (message.video) {
    return {
      kind: "video",
      fileId: message.video.file_id,
      fileName: message.video.file_name ?? `video_${updateId}.mp4`,
      mimeType: message.video.mime_type ?? "video/mp4",
      fileSize: message.video.file_size ?? null,
    };
  }
  return null;
}

function buildInboxPath(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return `${crypto.randomUUID()}-${safeName}`;
}

export async function POST(request: Request) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== process.env.ARK_TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = update.message;
  if (!message?.from) {
    // Nothing we can attribute to a user (a channel post, a bot
    // command from an unknown chat type, …) — ack and move on.
    return NextResponse.json({ ok: true });
  }

  const supabase = createServiceClient();

  // Only a recognized, active ARK user's Telegram id is accepted —
  // everyone else (including this same bot token added to some other
  // chat) is silently ignored.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, language")
    .eq("telegram_user_id", message.from.id)
    .eq("active", true)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ ok: true });
  }

  const profileRow = profile as { id: string; language: string | null };
  const lang = isLang(profileRow.language) ? profileRow.language : "en";
  const t = getDictionary(lang);

  // Dedupe on update_id — Telegram redelivers an update that didn't
  // get a timely 200 back. The unique index on telegram_update_id is
  // the hard guarantee; this pre-check just avoids redoing a file
  // download/upload for an update we already have.
  const { data: existing } = await supabase
    .from("inbox_items")
    .select("id")
    .eq("telegram_update_id", update.update_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true });
  }

  const text = message.text ?? message.caption ?? null;
  const forwardedFrom = extractForwardedFrom(message);
  const file = extractFile(message, update.update_id);

  const kind = file?.kind ?? (text ? "text" : null);
  if (!kind) {
    // A message type we don't handle (sticker, voice, location, …).
    return NextResponse.json({ ok: true });
  }

  let storagePath: string | null = null;
  let tooLarge = false;

  if (file) {
    if (file.fileSize != null && file.fileSize > MAX_TELEGRAM_FILE_BYTES) {
      tooLarge = true;
    } else {
      try {
        const telegramFile = await telegramGetFile(file.fileId);
        if (telegramFile?.file_path) {
          const bytes = await telegramDownloadFile(telegramFile.file_path);
          const path = buildInboxPath(file.fileName);
          const { error: uploadError } = await supabase.storage
            .from("inbox")
            .upload(path, Buffer.from(bytes), { contentType: file.mimeType ?? "application/octet-stream" });
          if (uploadError) {
            console.error("[telegram inbox] storage upload failed:", uploadError.message);
          } else {
            storagePath = path;
          }
        }
      } catch (err) {
        console.error("[telegram inbox] file download failed:", err instanceof Error ? err.message : "unknown error");
      }
    }
  }

  const { error: insertError } = await supabase.from("inbox_items").insert({
    telegram_update_id: update.update_id,
    profile_id: profile.id,
    kind,
    text_or_caption: text,
    forwarded_from: forwardedFrom,
    file_name: file?.fileName ?? null,
    mime_type: file?.mimeType ?? null,
    file_size: file?.fileSize ?? null,
    storage_path: storagePath,
    media_group_id: message.media_group_id ?? null,
  });

  if (insertError) {
    // 23505 = unique_violation — a race with a redelivered update
    // that another request already saved; not a real failure.
    if (insertError.code !== "23505") {
      console.error("[telegram inbox] insert failed:", insertError.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  } else {
    try {
      await telegramSendMessage(message.chat.id, tooLarge ? t.telegram.tooLarge : t.telegram.saved);
    } catch (err) {
      console.error("[telegram inbox] reply failed:", err instanceof Error ? err.message : "unknown error");
    }
  }

  return NextResponse.json({ ok: true });
}
