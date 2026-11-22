import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isLang, type Lang } from "@/lib/i18n";

// The one place every server component/action in the translated scope
// (Sidebar/TopBar via app/(app)/layout.tsx, Settings, Dashboard, the
// morning briefing's test-send) reads "what language is this session
// in" from — profiles.language, defaulting to "en" for a signed-out
// request or a profile row that predates this column.
export async function getCurrentUserLanguage(): Promise<Lang> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "en";

  const { data: profile } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
  const language = (profile as { language: string | null } | null)?.language;
  return isLang(language) ? language : "en";
}
