import { notFound } from "next/navigation";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getOpportunityProductsByOpportunityIds } from "@/lib/opportunity-products";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Opportunity, Person } from "@/lib/types";

interface EditOpportunityPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditOpportunityPage({ params }: EditOpportunityPageProps) {
  const { id } = await params;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const [{ data: opportunity }, { data: peopleData }, products] = await Promise.all([
    supabase.from("opportunities").select("*").eq("id", id).maybeSingle(),
    supabase.from("people").select("id, first_name, last_name, archived_at").order("first_name"),
    getAllProducts(),
  ]);

  if (!opportunity) {
    notFound();
  }

  const opportunityProductsById = await getOpportunityProductsByOpportunityIds([id]);
  const opportunityProducts = opportunityProductsById.get(id) ?? [];

  const allPeople = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const people = allPeople
    .filter((p) => !p.archived_at || p.id === (opportunity as Opportunity).intermediary_person_id)
    .map((p) => ({
      id: p.id,
      label: personLabel(p) + (p.archived_at ? ` (${t.common.archived})` : ""),
    }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.opportunityForm.editOpportunityTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.opportunityForm.updateDetailsFor((opportunity as Opportunity).title)}</p>
      </div>
      <OpportunityForm
        mode="edit"
        opportunity={opportunity as Opportunity}
        opportunityProducts={opportunityProducts}
        people={people}
        products={products}
        lang={lang}
      />
    </div>
  );
}
