import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contacts/contact-form";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactCapability } from "@/lib/types";

interface EditContactPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditContactPage({ params }: EditContactPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  const contact = data as Contact | null;

  if (!contact) {
    notFound();
  }

  const [{ data: capabilitiesData }, { data: tagsData }] = await Promise.all([
    supabase.from("contact_capabilities").select("*").eq("contact_id", id).order("created_at"),
    supabase.from("contact_capabilities").select("tag"),
  ]);
  const capabilities = (capabilitiesData as ContactCapability[] | null) ?? [];
  const existingTags = [...new Set(((tagsData as { tag: string }[] | null) ?? []).map((t) => t.tag))].sort();

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Contact</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {contact.full_name}.</p>
      </div>
      <ContactForm mode="edit" contact={contact} capabilities={capabilities} existingTags={existingTags} />
    </div>
  );
}
