import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const [{ data: receiversData }, { data: peopleData }, products, documentTypes, appSettings] = await Promise.all([
    supabase.from("contacts").select("id, full_name").order("full_name"),
    supabase.from("people").select("id, first_name, last_name").order("first_name"),
    getAllProducts(),
    getActiveDocumentTypes(),
    getAppSettings(),
  ]);

  const receivers = (receiversData ?? []).map((r) => ({ id: r.id, label: r.full_name }));
  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Project</h1>
        <p className="mt-1 text-sm text-white/45">Add a new project to the pipeline.</p>
      </div>
      <ProjectForm
        mode="create"
        receivers={receivers}
        people={people}
        products={products}
        documentTypes={documentTypes}
        defaultCurrency={appSettings.default_currency}
      />
    </div>
  );
}
