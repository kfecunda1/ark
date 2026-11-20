import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { isCurrentUserAdmin } from "@/lib/auth";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ count }, appSettings, isAdmin] = await Promise.all([
    supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "new"),
    getAppSettings(),
    isCurrentUserAdmin(),
  ]);

  return (
    <AppShell inboxNewCount={count ?? 0} showRecovery={appSettings.show_recovery} isAdmin={isAdmin}>
      {children}
    </AppShell>
  );
}
