import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("inbox_items")
    .select("*", { count: "exact", head: true })
    .eq("status", "new");

  return <AppShell inboxNewCount={count ?? 0}>{children}</AppShell>;
}
