import { notFound } from "next/navigation";
import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import type { Contact, Note, Project } from "@/lib/types";

interface EditNotePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNotePage({ params }: EditNotePageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("notes").select("*").eq("id", id).maybeSingle();
  const note = data as Note | null;

  if (!note) {
    notFound();
  }

  const [{ data: projectsData }, { data: contactsData }] = await Promise.all([
    supabase.from("projects").select("id, name").is("archived_at", null),
    supabase.from("contacts").select("id, full_name"),
  ]);

  const contacts = (contactsData as Contact[] | null) ?? [];

  const projects = ((projectsData as Pick<Project, "id" | "name">[] | null) ?? []).map((project) => ({
    id: project.id,
    label: project.name,
  }));

  const contactOptions = contacts.map((contact) => ({ id: contact.id, label: contactLabel(contact) }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Note</h1>
        <p className="mt-1 text-sm text-white/45">Update this note.</p>
      </div>
      <NoteForm mode="edit" note={note} projects={projects} contacts={contactOptions} />
    </div>
  );
}
