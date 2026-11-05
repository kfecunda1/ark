import { GlassCard } from "@/components/glass-card";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ExportBackupButton } from "@/components/settings/export-backup-button";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = (profile as { role: string | null } | null)?.role === "admin";
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-white/45">Workspace and account preferences.</p>
      </div>

      <GlassCard interactive={false} className="p-6">
        <p className="text-sm text-white/45">Settings will be configurable here in a future stage.</p>
      </GlassCard>

      <div className="mt-6 max-w-sm">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Change Password</h2>
        <GlassCard interactive={false} className="p-6">
          <ChangePasswordForm />
        </GlassCard>
      </div>

      {isAdmin && (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Backup</h2>
          <GlassCard interactive={false} className="p-6">
            <ExportBackupButton />
          </GlassCard>
        </div>
      )}
    </div>
  );
}
