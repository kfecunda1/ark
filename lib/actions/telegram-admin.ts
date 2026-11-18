"use server";

import { headers } from "next/headers";
import { isCurrentUserAdmin } from "@/lib/auth";
import { telegramGetWebhookInfo, telegramSetWebhook } from "@/lib/telegram";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Points Telegram at this exact deployment's own webhook URL —
// read from the request's own Host header rather than hardcoded, so
// this keeps working across preview deployments without editing env
// vars. Never touches, logs, or returns ARK_TELEGRAM_BOT_TOKEN itself
// (lib/telegram.ts keeps that entirely internal); the webhook secret
// is sent to Telegram (that's its job) but never echoed back here.
export async function connectTelegramWebhook(): Promise<{ error: string | null }> {
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only admins can manage the Telegram bot." };
  }

  const secret = process.env.ARK_TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return { error: "ARK_TELEGRAM_WEBHOOK_SECRET is not set." };
  }

  try {
    const headerList = await headers();
    const host = headerList.get("host");
    if (!host) {
      return { error: "Could not determine the current site's address." };
    }

    const result = await telegramSetWebhook(`https://${host}/api/telegram/inbox`, secret);
    if (!result.ok) {
      return { error: result.description ?? "setWebhook failed." };
    }
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface TelegramWebhookStatus {
  url: string | null;
  pendingUpdateCount: number | null;
  lastErrorMessage: string | null;
}

export async function getTelegramWebhookStatus(): Promise<{
  status: TelegramWebhookStatus | null;
  error: string | null;
}> {
  if (!(await isCurrentUserAdmin())) {
    return { status: null, error: "Only admins can manage the Telegram bot." };
  }

  try {
    const info = await telegramGetWebhookInfo();
    if (!info) {
      return { status: null, error: "Could not read webhook status." };
    }
    return {
      status: {
        url: info.url || null,
        pendingUpdateCount: info.pending_update_count ?? null,
        lastErrorMessage: info.last_error_message ?? null,
      },
      error: null,
    };
  } catch (err) {
    return { status: null, error: unexpectedErrorMessage(err) };
  }
}
