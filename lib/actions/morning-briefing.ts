"use server";

import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { telegramSendMessage } from "@/lib/telegram";
import { buildBriefingText, getBriefingSnapshot } from "@/lib/morning-briefing";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary, type Lang } from "@/lib/i18n";

function unexpectedErrorMessage(err: unknown, lang: Lang): string {
  return err instanceof Error ? err.message : getDictionary(lang).errors.somethingWentWrong;
}

// Settings → My Profile's "Send me a test briefing now" button — sends
// to the current user immediately, through their own session's RLS
// (so a non-admin's test send simply can't see the admin-only payout/
// backup figures, same as everywhere else those are gated). Never
// writes a briefing_sends row: this is a one-off, not today's real
// send, and must never block the actual cron send later that day.
export async function sendTestBriefing(): Promise<{ error: string | null }> {
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: t.errors.notSignedIn };
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
      return { error: t.settings.addTelegramIdFirst };
    }

    const isAdmin = await isCurrentUserAdmin();
    const snapshot = await getBriefingSnapshot(supabase, lang);
    const text = buildBriefingText(snapshot, isAdmin, lang);

    await telegramSendMessage(telegramUserId, text, { parseMode: "HTML", disableWebPagePreview: true });

    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err, lang) };
  }
}
