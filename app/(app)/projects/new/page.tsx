import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const [{ data: profiles }, { data: contacts }, { data: projectFieldsData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
    supabase.from("leads").select("procedure_type, source"),
  ]);

  const projectFields = (projectFieldsData as { procedure_type: string; source: string | null }[] | null) ?? [];
  const existingProcedureTypes = [...new Set(projectFields.map((p) => p.procedure_type))].sort();
  const existingSources = [...new Set(projectFields.map((p) => p.source).filter((s): s is string => Boolean(s)))].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Project</h1>
        <p className="mt-1 text-sm text-white/45">Add a new project to the pipeline.</p>
      </div>
      <ProjectForm
        mode="create"
        profiles={profiles ?? []}
        contacts={contacts ?? []}
        existingProcedureTypes={existingProcedureTypes}
        existingSources={existingSources}
      />
    </div>
  );
}
