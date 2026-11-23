import { ProjectForm } from "@/components/projects/project-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getAllStatuses } from "@/lib/statuses";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { hasDisplayNickname, receiverDisplayName } from "@/lib/display-name";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Person } from "@/lib/types";

interface NewProjectPageProps {
  searchParams: Promise<{ recovery?: string; fromOpportunity?: string }>;
}

export default async function NewProjectPage({ searchParams }: NewProjectPageProps) {
  const { recovery, fromOpportunity } = await searchParams;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();
  const [{ data: receiversData }, { data: peopleData }, products, statuses, documentTypes, appSettings] =
    await Promise.all([
      supabase.from("contacts").select("id, full_name, nickname").is("archived_at", null).order("full_name"),
      supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
      getAllProducts(),
      getAllStatuses(),
      getActiveDocumentTypes(),
      getAppSettings(),
    ]);

  // Pre-fill from an Opportunity's "Convert to project" action
  // (components/opportunities/opportunity-actions.tsx links here with
  // ?fromOpportunity=<id>) — title becomes the Name field, its product
  // guesses seed the product picker, and its intermediary (if any)
  // seeds the chain. Nothing is written yet; the actual move of
  // documents/notes and marking the opportunity converted only happens
  // once this form is actually submitted (components/projects/
  // project-form.tsx's create flow calls convertOpportunityToProject
  // right after the project itself is saved).
  let opportunityDefaultName: string | undefined;
  let opportunityDefaultProducts: string[] | undefined;
  let opportunityIntermediary: { key: string; personId: string; label: string } | null = null;
  if (fromOpportunity) {
    const { data: opportunityRow } = await supabase
      .from("opportunities")
      .select("title, intermediary_person_id")
      .eq("id", fromOpportunity)
      .maybeSingle();
    if (opportunityRow) {
      opportunityDefaultName = opportunityRow.title as string;
      const { data: opportunityProductRows } = await supabase
        .from("opportunity_products")
        .select("product")
        .eq("opportunity_id", fromOpportunity)
        .order("sort_order");
      opportunityDefaultProducts = ((opportunityProductRows as { product: string }[] | null) ?? []).map((r) => r.product);
      const intermediaryPersonId = opportunityRow.intermediary_person_id as string | null;
      if (intermediaryPersonId) {
        const { data: personRow } = await supabase
          .from("people")
          .select("id, first_name, last_name")
          .eq("id", intermediaryPersonId)
          .maybeSingle();
        if (personRow) {
          opportunityIntermediary = {
            key: personRow.id as string,
            personId: personRow.id as string,
            label: personLabel(personRow as Pick<Person, "first_name" | "last_name">),
          };
        }
      }
    }
  }

  const receivers = (
    (receiversData as { id: string; full_name: string; nickname: string | null }[] | null) ?? []
  ).map((r) => ({
    id: r.id,
    label: receiverDisplayName(r),
    sublabel: hasDisplayNickname(r.nickname) ? r.full_name : undefined,
  }));
  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));

  const defaultRecovery = recovery === "true";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {defaultRecovery ? t.projectForm.newRecoveryProjectTitle : t.projectForm.newProjectTitle}
        </h1>
        <p className="mt-1 text-sm text-white/45">
          {defaultRecovery ? t.projectForm.newRecoveryProjectSubtitle : t.projectForm.newProjectSubtitle}
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
        defaultName={opportunityDefaultName}
        defaultProductOptions={opportunityDefaultProducts}
        projectIntermediaries={opportunityIntermediary ? [opportunityIntermediary] : []}
        fromOpportunityId={fromOpportunity}
        showRecovery={appSettings.show_recovery}
        lang={lang}
      />
    </div>
  );
}
