import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { isCurrentUserAdmin } from "@/lib/auth";
import { getCurrentUserLanguage } from "@/lib/i18n/server";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ count }, appSettings, isAdmin, lang] = await Promise.all([
    supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "new"),
    getAppSettings(),
    isCurrentUserAdmin(),
    getCurrentUserLanguage(),
  ]);

  return (
    <AppShell inboxNewCount={count ?? 0} showRecovery={appSettings.show_recovery} isAdmin={isAdmin} lang={lang}>
      {children}
    </AppShell>
  );
}
