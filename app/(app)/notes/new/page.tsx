import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import type { Contact } from "@/lib/types";

interface NewNotePageProps {
  searchParams: Promise<{ contact_id?: string }>;
}

export default async function NewNotePage({ searchParams }: NewNotePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contacts = (contactsData as Contact[] | null) ?? [];
  const contactOptions = contacts.map((contact) => ({ id: contact.id, label: contactLabel(contact) }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Note</h1>
        <p className="mt-1 text-sm text-white/45">Jot something down, optionally as a reminder.</p>
      </div>
      <NoteForm mode="create" contacts={contactOptions} defaultContactId={params.contact_id ?? null} />
    </div>
  );
}
