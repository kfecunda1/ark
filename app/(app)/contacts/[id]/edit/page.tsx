import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contacts/contact-form";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactProduct } from "@/lib/types";

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

  const { data: productsData } = await supabase
    .from("contact_products")
    .select("*")
    .eq("contact_id", id)
    .order("created_at");
  const products = (productsData as ContactProduct[] | null) ?? [];

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Contact</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {contact.full_name}.</p>
      </div>
      <ContactForm mode="edit" contact={contact} products={products} />
    </div>
  );
}
