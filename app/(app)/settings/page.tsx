import { GlassCard } from "@/components/glass-card";
import { ManageableList } from "@/components/settings/manageable-list";
import { ManageableStatusList } from "@/components/settings/manageable-status-list";
import { ManageablePayoutGroupList } from "@/components/settings/manageable-payout-group-list";
import { DefaultsForm } from "@/components/settings/defaults-form";
import { MyProfileForm } from "@/components/settings/my-profile-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ExportBackupButton } from "@/components/settings/export-backup-button";
import { UsersSection } from "@/components/settings/users-section";
import { StorageMeter } from "@/components/settings/storage-meter";
import { TelegramBotPanel } from "@/components/settings/telegram-bot-panel";
import { DocumentChecklistGrid } from "@/components/settings/document-checklist-grid";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts, getActiveProducts } from "@/lib/products";
import { getAllStatuses } from "@/lib/statuses";
import { getAllPayoutGroups } from "@/lib/payout-groups";
import { getAllDocumentTypes, getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { getStorageUsedBytes } from "@/lib/storage-usage";
import { getRequiredDocumentsByProduct } from "@/lib/checklists";
import { listUsers } from "@/lib/actions/users";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary, resolveError } from "@/lib/i18n";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);

  let isAdmin = false;
  let fullName: string | null = null;
  let telegramUserId: number | null = null;
  let briefingEnabled = true;
  let briefingWeekdaysOnly = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, telegram_user_id, briefing_enabled, briefing_weekdays_only")
      .eq("id", user.id)
      .maybeSingle();
    const row = profile as {
      role: string | null;
      full_name: string | null;
      telegram_user_id: number | null;
      briefing_enabled: boolean;
      briefing_weekdays_only: boolean;
    } | null;
    isAdmin = row?.role === "admin";
    fullName = row?.full_name ?? null;
    telegramUserId = row?.telegram_user_id ?? null;
    briefingEnabled = row?.briefing_enabled ?? true;
    briefingWeekdaysOnly = row?.briefing_weekdays_only ?? false;
  }

  const [
    products,
    statuses,
    documentTypes,
    payoutGroups,
    appSettings,
    usersResult,
    storageUsedBytes,
    activeProducts,
    activeDocumentTypes,
    requiredByProduct,
  ] = isAdmin
    ? await Promise.all([
        getAllProducts(),
        getAllStatuses(),
        getAllDocumentTypes(),
        getAllPayoutGroups(),
        getAppSettings(),
        listUsers(),
        getStorageUsedBytes(),
        getActiveProducts(),
        getActiveDocumentTypes(),
        getRequiredDocumentsByProduct(supabase),
      ])
    : [[], [], [], [], null, { users: [], error: null }, 0, [], [], new Map<string, string[]>()];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-white/45">{t.settings.subtitle}</p>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.myProfile}</h2>
        <GlassCard interactive={false} className="p-6">
          <MyProfileForm
            fullName={fullName}
            telegramUserId={telegramUserId}
            briefingEnabled={briefingEnabled}
            briefingWeekdaysOnly={briefingWeekdaysOnly}
            language={lang}
          />
        </GlassCard>
      </div>

      <div className="mt-6 max-w-sm">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.changePassword}</h2>
        <GlassCard interactive={false} className="p-6">
          <ChangePasswordForm lang={lang} />
        </GlassCard>
      </div>

      {isAdmin && (
        <>
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.products}</h2>
            <GlassCard interactive={false} className="p-6">
              <ManageableList table="products" items={products} itemLabel="product" lang={lang} />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">
              {t.settings.documentTypes}
            </h2>
            <GlassCard interactive={false} className="p-6">
              <ManageableList table="document_types" items={documentTypes} itemLabel="document type" withSpanishName lang={lang} />
            </GlassCard>
          </div>

          <div id="document-checklists" className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">
              {t.settings.documentChecklists}
            </h2>
            <GlassCard interactive={false} className="p-6">
              <DocumentChecklistGrid
                products={activeProducts}
                documentTypes={activeDocumentTypes}
                requiredByProduct={requiredByProduct}
                autoAdvanceOnDocuments={appSettings?.auto_advance_on_documents ?? true}
                lang={lang}
              />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.statuses}</h2>
            <GlassCard interactive={false} className="p-6">
              <ManageableStatusList statuses={statuses} lang={lang} />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.groups}</h2>
            <GlassCard interactive={false} className="p-6">
              <ManageablePayoutGroupList groups={payoutGroups} lang={lang} />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.defaults}</h2>
            <GlassCard interactive={false} className="p-6">
              {appSettings && <DefaultsForm settings={appSettings} lang={lang} />}
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.users}</h2>
            <GlassCard interactive={false} className="p-6">
              {usersResult.error ? (
                <p className="text-sm text-red-300">{t.settingsUsers.failedToLoadUsers(resolveError(usersResult.error, lang) ?? usersResult.error)}</p>
              ) : (
                user && <UsersSection users={usersResult.users} currentUserId={user.id} lang={lang} />
              )}
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.storage}</h2>
            <GlassCard interactive={false} className="p-6">
              <StorageMeter usedBytes={storageUsedBytes} lang={lang} />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">
              {t.settings.telegramBot}
            </h2>
            <GlassCard interactive={false} className="p-6">
              <TelegramBotPanel lang={lang} />
            </GlassCard>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.settings.backup}</h2>
            <GlassCard interactive={false} className="p-6">
              <ExportBackupButton lang={lang} />
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
