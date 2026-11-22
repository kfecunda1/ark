import { notFound } from "next/navigation";
import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { hasDisplayNickname, projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, Project } from "@/lib/types";

interface EditNotePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNotePage({ params }: EditNotePageProps) {
  const { id } = await params;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const { data } = await supabase.from("notes").select("*").eq("id", id).maybeSingle();
  const note = data as Note | null;

  if (!note) {
    notFound();
  }

  const [{ data: contactsData }, { data: projectsData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, nickname, archived_at"),
    supabase.from("projects").select("id, name, nickname"),
  ]);
  const contacts = (contactsData as Contact[] | null) ?? [];
  // Archived receivers are excluded, except the one this note is
  // already linked to — same "an existing link keeps showing" rule
  // used everywhere else archiving touches a picker.
  const contactOptions = contacts
    .filter((contact) => !contact.archived_at || contact.id === note.contact_id)
    .map((contact) => ({
      id: contact.id,
      label: receiverDisplayName(contact) + (contact.archived_at ? ` (${t.common.archived})` : ""),
      sublabel: hasDisplayNickname(contact.nickname)
        ? contactLabel(contact) + (contact.archived_at ? ` (${t.common.archived})` : "")
        : undefined,
    }));
  const projects = (projectsData as Pick<Project, "id" | "name" | "nickname">[] | null) ?? [];
  const projectOptions = projects.map((project) => ({
    id: project.id,
    label: projectDisplayName(project),
    sublabel: hasDisplayNickname(project.nickname) ? project.name : undefined,
  }));

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.notes.editNoteTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.notes.editNoteSubtitle}</p>
      </div>
      <NoteForm mode="edit" note={note} projects={projectOptions} contacts={contactOptions} lang={lang} />
    </div>
  );
}
