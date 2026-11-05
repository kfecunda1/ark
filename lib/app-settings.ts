import { createClient } from "@/lib/supabase/server";
import type { AppSettings } from "@/lib/types";

const FALLBACK: AppSettings = { default_currency: "USD", stuck_after_days: 7, updated_at: "" };

// app_settings is a singleton row (supabase/migrations/011_settings_
// tables.sql) seeded by that migration itself, so this should always
// find a row — the fallback only matters if someone queries before
// that migration has run.
export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("default_currency, stuck_after_days, updated_at")
    .maybeSingle();
  if (error) {
    console.error("[getAppSettings] query failed:", error.message);
  }
  return (data as AppSettings | null) ?? FALLBACK;
}
