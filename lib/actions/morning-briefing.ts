"use server";

import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { telegramSendMessage } from "@/lib/telegram";
import { buildBriefingText, getBriefingSnapshot } from "@/lib/morning-briefing";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Settings → My Profile's "Send me a test briefing now" button — sends
// to the current user immediately, through their own session's RLS
// (so a non-admin's test send simply can't see the admin-only payout/
// backup figures, same as everywhere else those are gated). Never
// writes a briefing_sends row: this is a one-off, not today's real
// send, and must never block the actual cron send later that day.
export async function sendTestBriefing(): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("telegram_user_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      return { error: profileError.message };
    }
    const telegramUserId = (profile as { telegram_user_id: number | null } | null)?.telegram_user_id ?? null;
    if (!telegramUserId) {
      return { error: "Add your Telegram Id above and save first." };
    }

    const isAdmin = await isCurrentUserAdmin();
    const snapshot = await getBriefingSnapshot(supabase);
    const text = buildBriefingText(snapshot, isAdmin);

    await telegramSendMessage(telegramUserId, text, { parseMode: "HTML", disableWebPagePreview: true });

    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
