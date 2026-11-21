import type { InboxItem } from "@/lib/types";

// Telegram's own bot-API download ceiling (app/api/telegram/inbox/
// route.ts skips downloading anything over this and leaves storage_path
// null instead).
export const TELEGRAM_MAX_FILE_BYTES = 20 * 1024 * 1024;

// Whether an inbox item's file was too large for the webhook to ever
// download — deliberately keyed on file_size alone, which Telegram
// reports up front and nothing in this app ever changes afterward.
// storage_path is NOT part of this check: it's null both for a
// genuinely too-large file *and* for one that downloaded fine but has
// since been filed (markFiled, lib/actions/inbox.ts, clears it once
// the bytes live in the real documents bucket instead) — using it here
// was the bug that made every filed item show this warning.
export function isTooLargeForTelegram(item: Pick<InboxItem, "kind" | "file_size">): boolean {
  return item.kind !== "text" && item.file_size != null && item.file_size > TELEGRAM_MAX_FILE_BYTES;
}
