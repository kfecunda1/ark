import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import type { Contact, Project } from "@/lib/types";

interface NewNotePageProps {
  searchParams: Promise<{ project_id?: string; contact_id?: string }>;
}

export default async function NewNotePage({ searchParams }: NewNotePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

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

  const defaultLinkType = params.project_id ? "project" : params.contact_id ? "contact" : "";
  const defaultLinkId = params.project_id ?? params.contact_id ?? null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Note</h1>
        <p className="mt-1 text-sm text-white/45">Jot something down, optionally as a reminder.</p>
      </div>
      <NoteForm
        mode="create"
        projects={projects}
        contacts={contactOptions}
        defaultLinkType={defaultLinkType}
        defaultLinkId={defaultLinkId}
      />
    </div>
  );
}
