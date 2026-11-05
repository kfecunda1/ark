import { ContactForm } from "@/components/contacts/contact-form";
import { getAllProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";

export default async function NewContactPage() {
  const [allProducts, documentTypes] = await Promise.all([getAllProducts(), getActiveDocumentTypes()]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Contact</h1>
        <p className="mt-1 text-sm text-white/45">Add a person who can be linked to projects.</p>
      </div>
      <ContactForm mode="create" allProducts={allProducts} documentTypes={documentTypes} />
    </div>
  );
}
