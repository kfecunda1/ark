import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import type { ProjectProduct } from "@/lib/types";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: contacts }, { data: projectProductsData }, products, documentTypes] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("contacts").select("id, full_name").order("full_name"),
      supabase.from("project_products").select("*").eq("project_id", id).order("sort_order"),
      getAllProducts(),
      getActiveDocumentTypes(),
    ]);

  if (!project) {
    notFound();
  }

  const projectProducts = (projectProductsData as ProjectProduct[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Project</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {project.name}.</p>
      </div>
      <ProjectForm
        mode="edit"
        project={project}
        projectProducts={projectProducts}
        contacts={contacts ?? []}
        products={products}
        documentTypes={documentTypes}
      />
    </div>
  );
}
