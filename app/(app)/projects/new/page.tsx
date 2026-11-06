import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getAllStatuses } from "@/lib/statuses";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

interface NewProjectPageProps {
  searchParams: Promise<{ recovery?: string }>;
}

export default async function NewProjectPage({ searchParams }: NewProjectPageProps) {
  const { recovery } = await searchParams;
  const supabase = await createClient();
  const [{ data: receiversData }, { data: peopleData }, products, statuses, documentTypes, appSettings] =
    await Promise.all([
      supabase.from("contacts").select("id, full_name").is("archived_at", null).order("full_name"),
      supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
      getAllProducts(),
      getAllStatuses(),
      getActiveDocumentTypes(),
      getAppSettings(),
    ]);

  const receivers = (receiversData ?? []).map((r) => ({ id: r.id, label: r.full_name }));
  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));

  const defaultRecovery = recovery === "true";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {defaultRecovery ? "New Recovery Project" : "New Project"}
        </h1>
        <p className="mt-1 text-sm text-white/45">
          {defaultRecovery ? "Add a new recovery project to the pipeline." : "Add a new project to the pipeline."}
        </p>
      </div>
      <ProjectForm
        mode="create"
        receivers={receivers}
        people={people}
        products={products}
        statuses={statuses}
        documentTypes={documentTypes}
        defaultCurrency={appSettings.default_currency}
        defaultRecovery={defaultRecovery}
      />
    </div>
  );
}
