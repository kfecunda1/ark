import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const { data: contacts } = await supabase.from("contacts").select("id, full_name").order("full_name");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Project</h1>
        <p className="mt-1 text-sm text-white/45">Add a new project to the pipeline.</p>
      </div>
      <ProjectForm mode="create" contacts={contacts ?? []} />
    </div>
  );
}
