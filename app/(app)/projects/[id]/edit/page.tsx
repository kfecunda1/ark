import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getProjectIntermediaryChain } from "@/lib/intermediaries";
import { personLabel } from "@/lib/people";
import type { Contact, Person, ProjectProduct } from "@/lib/types";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: project },
    { data: receiversData },
    { data: peopleData },
    { data: projectProductsData },
    products,
    documentTypes,
    projectIntermediaries,
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, full_name, archived_at").order("full_name"),
    supabase.from("people").select("id, first_name, last_name, archived_at").order("first_name"),
    supabase.from("project_products").select("*").eq("project_id", id).order("sort_order"),
    getAllProducts(),
    getActiveDocumentTypes(),
    getProjectIntermediaryChain(id),
  ]);

  if (!project) {
    notFound();
  }

  const projectProducts = (projectProductsData as ProjectProduct[] | null) ?? [];
  // Archived rows are excluded from the picker, except whichever one
  // (if any) this project is already linked to — same "an existing
  // link keeps showing even if it's since been hidden" rule
  // components/receivers/product-fields.tsx already applies to hidden
  // products, labeled "(Archived)" so it's clear why it's still there.
  const allReceivers = (receiversData as Pick<Contact, "id" | "full_name" | "archived_at">[] | null) ?? [];
  const receivers = allReceivers
    .filter((r) => !r.archived_at || r.id === project.matched_contact_id)
    .map((r) => ({ id: r.id, label: r.full_name + (r.archived_at ? " (Archived)" : "") }));
  const allPeople = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const people = allPeople
    .filter((p) => !p.archived_at || p.id === project.contact_person_id)
    .map((p) => ({ id: p.id, label: personLabel(p) + (p.archived_at ? " (Archived)" : "") }));

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
        projectIntermediaries={projectIntermediaries}
        receivers={receivers}
        people={people}
        products={products}
        documentTypes={documentTypes}
      />
    </div>
  );
}
