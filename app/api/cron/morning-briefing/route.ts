import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { telegramSendMessage } from "@/lib/telegram";
import {
  buildBriefingText,
  currentWeekdayInTimeZone,
  getBriefingSnapshot,
  todayDateKey,
} from "@/lib/morning-briefing";

// Vercel Cron's own target (vercel.json's "0 11 * * *" = 07:00 America/
// Curacao, a fixed UTC-4 offset with no DST). Needs the full Node
// runtime for the Supabase service client and a loop of outbound
// Telegram calls, same reasoning as the inbox webhook.
export const runtime = "nodejs";

const WEEKEND_DAYS = new Set([0, 6]); // Sunday, Saturday

interface BriefingProfile {
  id: string;
  role: string | null;
  telegram_user_id: number;
  briefing_weekdays_only: boolean;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const expected = process.env.CRON_SECRET;
  // CRON_SECRET unset is treated the same as a bad secret (refuse,
  // never fall open) — never logged either way.
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = createServiceClient();
  const briefingDate = todayDateKey();
  const isWeekend = WEEKEND_DAYS.has(currentWeekdayInTimeZone());

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id, role, telegram_user_id, briefing_weekdays_only")
    .eq("active", true)
    .eq("briefing_enabled", true)
    .not("telegram_user_id", "is", null);

  if (profilesError) {
    console.error("[morning-briefing] failed to load profiles:", profilesError.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const candidates = ((profilesData as BriefingProfile[] | null) ?? []).filter(
    (p) => !(isWeekend && p.briefing_weekdays_only)
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
  }

  // Already sent today (a retried cron run) — never send twice.
  const { data: alreadySentData } = await supabase
    .from("briefing_sends")
    .select("profile_id")
    .eq("briefing_date", briefingDate)
    .in("profile_id", candidates.map((p) => p.id));
  const alreadySent = new Set(((alreadySentData as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id));

  const toSend = candidates.filter((p) => !alreadySent.has(p.id));
  let sent = 0;
  let failed = 0;
  const skipped = candidates.length - toSend.length;

  if (toSend.length > 0) {
    const snapshot = await getBriefingSnapshot(supabase);

    for (const profile of toSend) {
      try {
        const text = buildBriefingText(snapshot, profile.role === "admin");
        await telegramSendMessage(profile.telegram_user_id, text, {
          parseMode: "HTML",
          disableWebPagePreview: true,
        });

        const { error: insertError } = await supabase
          .from("briefing_sends")
          .insert({ profile_id: profile.id, briefing_date: briefingDate });
        // 23505 = unique_violation — a race with another invocation
        // that already recorded this send; the message still only
        // went out once per Telegram call above, so this isn't a
        // real failure.
        if (insertError && insertError.code !== "23505") {
          console.error("[morning-briefing] failed to record send:", insertError.message);
        }
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(
          "[morning-briefing] send failed for a profile:",
          err instanceof Error ? err.message : "unknown error"
        );
      }
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}
