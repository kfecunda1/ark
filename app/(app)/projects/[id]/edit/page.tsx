import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: profiles }, { data: contacts }, { data: projectFieldsData }] =
    await Promise.all([
      supabase.from("leads").select("*").eq("id", id).maybeSingle(),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
      supabase.from("leads").select("procedure_type, source"),
    ]);

  if (!project) {
    notFound();
  }

  const projectFields = (projectFieldsData as { procedure_type: string; source: string | null }[] | null) ?? [];
  const existingProcedureTypes = [...new Set(projectFields.map((p) => p.procedure_type))].sort();
  const existingSources = [...new Set(projectFields.map((p) => p.source).filter((s): s is string => Boolean(s)))].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Project</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {project.product_type}.</p>
      </div>
      <ProjectForm
        mode="edit"
        project={project}
        profiles={profiles ?? []}
        contacts={contacts ?? []}
        existingProcedureTypes={existingProcedureTypes}
        existingSources={existingSources}
      />
    </div>
  );
}
