import { notFound } from "next/navigation";
import { PersonForm } from "@/components/people/person-form";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Person } from "@/lib/types";

interface EditPersonPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPersonPage({ params }: EditPersonPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);

  const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  const person = data as Person | null;

  if (!person) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.people.editContactTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.people.updateDetailsFor(personLabel(person))}</p>
      </div>
      <PersonForm mode="edit" person={person} lang={lang} />
    </div>
  );
}
