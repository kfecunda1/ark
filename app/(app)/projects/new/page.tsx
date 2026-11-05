import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const [{ data: contacts }, products, documentTypes, appSettings] = await Promise.all([
    supabase.from("contacts").select("id, full_name").order("full_name"),
    getAllProducts(),
    getActiveDocumentTypes(),
    getAppSettings(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Project</h1>
        <p className="mt-1 text-sm text-white/45">Add a new project to the pipeline.</p>
      </div>
      <ProjectForm
        mode="create"
        contacts={contacts ?? []}
        products={products}
        documentTypes={documentTypes}
        defaultCurrency={appSettings.default_currency}
      />
    </div>
  );
}
