import { redirect } from "next/navigation";
import { ProjectsListView, type ProjectsListSearchParams } from "@/components/projects/projects-list-view";

interface ProjectsPageProps {
  searchParams: Promise<ProjectsListSearchParams & { recovery?: string }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;

  // The old "All / Recovery only / Exclude recovery" filter lived here
  // as ?recovery=true — now that's its own tab (/recovery) instead, so
  // an old bookmarked/shared link with that param lands there directly.
  // Done here rather than as a next.config.ts redirect (see /contacts
  // -> /receivers there): a config-level redirect to a static
  // destination still forwards along any query params that aren't
  // consumed by it, leaving a stray "?recovery=true" on the result —
  // redirect() here always lands on a clean "/recovery".
  if (params.recovery === "true") {
    redirect("/recovery");
  }

  return <ProjectsListView searchParams={params} isRecovery={false} />;
}
