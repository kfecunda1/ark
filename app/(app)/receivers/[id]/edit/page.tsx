import { notFound } from "next/navigation";
import { ReceiverForm } from "@/components/receivers/receiver-form";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { personLabel } from "@/lib/people";
import type { Contact, ContactProduct, Person } from "@/lib/types";

interface EditReceiverPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditReceiverPage({ params }: EditReceiverPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  const contact = data as Contact | null;

  if (!contact) {
    notFound();
  }

  const [{ data: productsData }, allProducts, documentTypes, { data: peopleData }] = await Promise.all([
    supabase.from("contact_products").select("*").eq("contact_id", id).order("created_at"),
    getAllProducts(),
    getActiveDocumentTypes(),
    supabase.from("people").select("id, first_name, last_name, archived_at").order("first_name"),
  ]);
  const products = (productsData as ContactProduct[] | null) ?? [];
  // Same "an existing link keeps showing even if it's since been
  // archived" rule as the project edit form — only the contact's own
  // current contact_person_id is exempt from the archived filter.
  const allPeople = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const people = allPeople
    .filter((p) => !p.archived_at || p.id === contact.contact_person_id)
    .map((p) => ({ id: p.id, label: personLabel(p) + (p.archived_at ? " (Archived)" : "") }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Receiver</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {contact.full_name}.</p>
      </div>
      <ReceiverForm
        mode="edit"
        contact={contact}
        products={products}
        allProducts={allProducts}
        documentTypes={documentTypes}
        people={people}
      />
    </div>
  );
}
