import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Person } from "@/lib/types";

export default async function NewOpportunityPage() {
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const [{ data: peopleData }, products, documentTypes] = await Promise.all([
    supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
    getAllProducts(),
    getActiveDocumentTypes(),
  ]);

  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.opportunityForm.newOpportunityTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.opportunityForm.newOpportunitySubtitle}</p>
      </div>
      <OpportunityForm mode="create" people={people} products={products} documentTypes={documentTypes} lang={lang} />
    </div>
  );
}
