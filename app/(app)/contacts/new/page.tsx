import { ContactForm } from "@/components/contacts/contact-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewContactPage() {
  const supabase = await createClient();
  const { data: tagsData } = await supabase.from("contact_capabilities").select("tag");
  const existingTags = [...new Set(((tagsData as { tag: string }[] | null) ?? []).map((t) => t.tag))].sort();

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Contact</h1>
        <p className="mt-1 text-sm text-white/45">Add a person who can be linked to leads and procedures.</p>
      </div>
      <ContactForm mode="create" existingTags={existingTags} />
    </div>
  );
}
