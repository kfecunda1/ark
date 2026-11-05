import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: contacts }, products, documentTypes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, full_name").order("full_name"),
    getAllProducts(),
    getActiveDocumentTypes(),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Project</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {project.name}.</p>
      </div>
      <ProjectForm mode="edit" project={project} contacts={contacts ?? []} products={products} documentTypes={documentTypes} />
    </div>
  );
}
