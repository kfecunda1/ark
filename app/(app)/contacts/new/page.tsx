import { ContactForm } from "@/components/contacts/contact-form";

export default function NewContactPage() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Contact</h1>
        <p className="mt-1 text-sm text-white/45">Add a person who can be linked to projects.</p>
      </div>
      <ContactForm mode="create" />
    </div>
  );
}
