import "server-only";

// Thin wrapper over the Telegram Bot API, used by the inbound webhook
// (app/api/telegram/inbox/route.ts) and the admin "Connect webhook"
// action (lib/actions/telegram-admin.ts). ARK_TELEGRAM_BOT_TOKEN is
// never logged, printed, or included in a thrown error message —
// every function here catches its own fetch failures and rethrows a
// generic message instead of letting the original (which could carry
// the token-bearing URL) propagate.

const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.ARK_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("ARK_TELEGRAM_BOT_TOKEN is not set.");
  }
  return token;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function callTelegramApi<T>(method: string, body?: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
  const token = botToken();
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram API call to ${method} failed.`);
  }
}

export interface SendMessageOptions {
  // "HTML" for the morning briefing (app/api/cron/morning-briefing/
  // route.ts) — Telegram's own supported subset (<b>, <a href>, …),
  // not full HTML. Omitted entirely for the plain-text inbox webhook
  // reply, which has no markup to escape.
  parseMode?: "HTML";
  // The briefing links to several ARK pages — without this, Telegram
  // renders a large link-preview card under the message for whichever
  // URL appears first, which isn't wanted here.
  disableWebPagePreview?: boolean;
}

export async function telegramSendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void> {
  const result = await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options?.disableWebPagePreview ? { disable_web_page_preview: true } : {}),
  });
  if (!result.ok) {
    throw new Error(result.description ?? "sendMessage failed.");
  }
}

export interface TelegramFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
}

export async function telegramGetFile(fileId: string): Promise<TelegramFile | null> {
  const result = await callTelegramApi<TelegramFile>("getFile", { file_id: fileId });
  return result.ok ? result.result ?? null : null;
}

// Telegram's file-download endpoint is a plain GET on a different host
// path (not a bot* method), so it doesn't go through callTelegramApi.
export async function telegramDownloadFile(filePath: string): Promise<ArrayBuffer> {
  const token = botToken();
  try {
    const res = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
    if (!res.ok) {
      throw new Error(`Telegram file download failed (${res.status}).`);
    }
    return await res.arrayBuffer();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Telegram file download failed")) throw err;
    throw new Error("Telegram file download failed.");
  }
}

export async function telegramSetWebhook(url: string, secretToken: string): Promise<{ ok: boolean; description?: string }> {
  const result = await callTelegramApi("setWebhook", { url, secret_token: secretToken });
  return { ok: result.ok, description: result.description };
}

export interface TelegramWebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}

export async function telegramGetWebhookInfo(): Promise<TelegramWebhookInfo | null> {
  const result = await callTelegramApi<TelegramWebhookInfo>("getWebhookInfo");
  return result.ok ? result.result ?? null : null;
}
