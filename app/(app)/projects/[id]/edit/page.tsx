import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getAllStatuses } from "@/lib/statuses";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { getProjectIntermediaryChain } from "@/lib/intermediaries";
import { hasDisplayNickname, receiverDisplayName } from "@/lib/display-name";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Person, ProjectProduct } from "@/lib/types";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const [
    { data: project },
    { data: receiversData },
    { data: peopleData },
    { data: projectProductsData },
    products,
    statuses,
    documentTypes,
    projectIntermediaries,
    appSettings,
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, full_name, nickname, archived_at").order("full_name"),
    supabase.from("people").select("id, first_name, last_name, archived_at").order("first_name"),
    supabase.from("project_products").select("*").eq("project_id", id).order("sort_order"),
    getAllProducts(),
    getAllStatuses(),
    getActiveDocumentTypes(),
    getProjectIntermediaryChain(id, lang),
    getAppSettings(),
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
  const allReceivers = (receiversData as Pick<Contact, "id" | "full_name" | "nickname" | "archived_at">[] | null) ?? [];
  const receivers = allReceivers
    .filter((r) => !r.archived_at || r.id === project.matched_contact_id)
    .map((r) => ({
      id: r.id,
      label: receiverDisplayName(r) + (r.archived_at ? ` (${t.common.archived})` : ""),
      sublabel: hasDisplayNickname(r.nickname) ? r.full_name + (r.archived_at ? ` (${t.common.archived})` : "") : undefined,
    }));
  const allPeople = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const people = allPeople
    .filter((p) => !p.archived_at || p.id === project.contact_person_id)
    .map((p) => ({ id: p.id, label: personLabel(p) + (p.archived_at ? ` (${t.common.archived})` : "") }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.projectForm.editProjectTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.projectForm.updateDetailsFor(project.name)}</p>
      </div>
      <ProjectForm
        mode="edit"
        project={project}
        projectProducts={projectProducts}
        projectIntermediaries={projectIntermediaries}
        receivers={receivers}
        people={people}
        products={products}
        statuses={statuses}
        documentTypes={documentTypes}
        showRecovery={appSettings.show_recovery}
        lang={lang}
      />
    </div>
  );
}
