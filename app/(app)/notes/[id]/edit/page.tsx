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

  const [{ data: contactsData }, { data: projectsData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, archived_at"),
    supabase.from("projects").select("id, name"),
  ]);
  const contacts = (contactsData as Contact[] | null) ?? [];
  // Archived receivers are excluded, except the one this note is
  // already linked to — same "an existing link keeps showing" rule
  // used everywhere else archiving touches a picker.
  const contactOptions = contacts
    .filter((contact) => !contact.archived_at || contact.id === note.contact_id)
    .map((contact) => ({
      id: contact.id,
      label: contactLabel(contact) + (contact.archived_at ? " (Archived)" : ""),
    }));
  const projects = (projectsData as Pick<Project, "id" | "name">[] | null) ?? [];
  const projectOptions = projects.map((project) => ({ id: project.id, label: project.name }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Note</h1>
        <p className="mt-1 text-sm text-white/45">Update this note.</p>
      </div>
      <NoteForm mode="edit" note={note} projects={projectOptions} contacts={contactOptions} />
    </div>
  );
}
