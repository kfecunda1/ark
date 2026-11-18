import { redirect } from "next/navigation";
import { ProjectsListView, type ProjectsListSearchParams } from "@/components/projects/projects-list-view";
import { getAppSettings } from "@/lib/app-settings";

interface RecoveryProjectsPageProps {
  searchParams: Promise<ProjectsListSearchParams>;
}

export default async function RecoveryProjectsPage({ searchParams }: RecoveryProjectsPageProps) {
  const appSettings = await getAppSettings();
  // Settings → Defaults' "Show Recovery" toggle, off (supabase/
  // migrations/024_show_recovery.sql) — recovery projects and their
  // data are untouched, but the tab itself is hidden, so a bookmarked
  // or typed-in /recovery link lands on the regular list instead of a
  // page nothing points to anymore.
  if (!appSettings.show_recovery) {
    redirect("/projects");
  }

  const params = await searchParams;
  return <ProjectsListView searchParams={params} isRecovery={true} />;
}
