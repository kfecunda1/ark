import { ProjectsListView, type ProjectsListSearchParams } from "@/components/projects/projects-list-view";

interface RecoveryProjectsPageProps {
  searchParams: Promise<ProjectsListSearchParams>;
}

export default async function RecoveryProjectsPage({ searchParams }: RecoveryProjectsPageProps) {
  const params = await searchParams;
  return <ProjectsListView searchParams={params} isRecovery={true} />;
}
