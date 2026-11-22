import { PersonForm } from "@/components/people/person-form";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";

export default async function NewPersonPage() {
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.people.newContactTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.people.newContactSubtitle}</p>
      </div>
      <PersonForm mode="create" lang={lang} />
    </div>
  );
}
