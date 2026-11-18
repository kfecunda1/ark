import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ count }, appSettings] = await Promise.all([
    supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "new"),
    getAppSettings(),
  ]);

  return (
    <AppShell inboxNewCount={count ?? 0} showRecovery={appSettings.show_recovery}>
      {children}
    </AppShell>
  );
}
