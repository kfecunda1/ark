import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import type { Contact, Project } from "@/lib/types";

interface NewNotePageProps {
  searchParams: Promise<{ contact_id?: string; project_id?: string }>;
}

export default async function NewNotePage({ searchParams }: NewNotePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: contactsData }, { data: projectsData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, archived_at"),
    supabase.from("projects").select("id, name"),
  ]);
  const contacts = (contactsData as Contact[] | null) ?? [];
  // Archived receivers are excluded, except the one this page was
  // linked to directly (e.g. "Add note" from an archived receiver's
  // own page) — same "an existing link keeps showing" rule used
  // everywhere else archiving touches a picker.
  const contactOptions = contacts
    .filter((contact) => !contact.archived_at || contact.id === params.contact_id)
    .map((contact) => ({
      id: contact.id,
      label: contactLabel(contact) + (contact.archived_at ? " (Archived)" : ""),
    }));
  const projects = (projectsData as Pick<Project, "id" | "name">[] | null) ?? [];
  const projectOptions = projects.map((project) => ({ id: project.id, label: project.name }));

  const defaultLinkType = params.project_id ? "project" : params.contact_id ? "contact" : "none";
  const defaultLinkId = params.project_id ?? params.contact_id ?? null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Note</h1>
        <p className="mt-1 text-sm text-white/45">Jot something down, optionally as a reminder.</p>
      </div>
      <NoteForm
        mode="create"
        projects={projectOptions}
        contacts={contactOptions}
        defaultLinkType={defaultLinkType}
        defaultLinkId={defaultLinkId}
      />
    </div>
  );
}
