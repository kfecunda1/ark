import { GlassCard } from "@/components/glass-card";
import { ManageableList } from "@/components/settings/manageable-list";
import { DefaultsForm } from "@/components/settings/defaults-form";
import { MyProfileForm } from "@/components/settings/my-profile-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ExportBackupButton } from "@/components/settings/export-backup-button";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getAllDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  let fullName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();
    const row = profile as { role: string | null; full_name: string | null } | null;
    isAdmin = row?.role === "admin";
    fullName = row?.full_name ?? null;
  }

  const [products, documentTypes, appSettings] = isAdmin
    ? await Promise.all([getAllProducts(), getAllDocumentTypes(), getAppSettings()])
    : [[], [], null];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-white/45">Workspace and account preferences.</p>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">My Profile</h2>
        <GlassCard interactive={false} className="p-6">
          <MyProfileForm fullName={fullName} />
        </GlassCard>
      </div>

      <div className="mt-6 max-w-sm">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Change Password</h2>
        <GlassCard interactive={false} className="p-6">
          <ChangePasswordForm />
        </GlassCard>
      </div>

      {isAdmin && (
        <>
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Products</h2>
            <GlassCard interactive={false} className="p-6">
              <ManageableList table="products" items={products} itemLabel="product" />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Document Types</h2>
            <GlassCard interactive={false} className="p-6">
              <ManageableList table="document_types" items={documentTypes} itemLabel="document type" />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Defaults</h2>
            <GlassCard interactive={false} className="p-6">
              {appSettings && <DefaultsForm settings={appSettings} />}
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Backup</h2>
            <GlassCard interactive={false} className="p-6">
              <ExportBackupButton />
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
