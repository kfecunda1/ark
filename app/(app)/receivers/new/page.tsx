import { ReceiverForm } from "@/components/receivers/receiver-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Person } from "@/lib/types";

export default async function NewReceiverPage() {
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();
  const [allProducts, documentTypes, { data: peopleData }] = await Promise.all([
    getAllProducts(),
    getActiveDocumentTypes(),
    supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
  ]);
  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.receivers.newReceiver}</h1>
        <p className="mt-1 text-sm text-white/45">{t.receivers.newReceiverSubtitle}</p>
      </div>
      <ReceiverForm mode="create" allProducts={allProducts} documentTypes={documentTypes} people={people} lang={lang} />
    </div>
  );
}
