import { createClient } from "@/lib/supabase/server";

// The one shared check for "is the current user an admin" — every page
// that gated an admin-only section before this (Settings, Dashboard's
// backup indicator) re-derived this inline; introduced here because
// Receiver/Contact delete needs the same check from both a page (to
// decide whether to render the Delete button at all) and a server
// action (to return a clean error instead of relying solely on the
// RLS policy's opaque rejection).
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return (profile as { role: string | null } | null)?.role === "admin";
}
