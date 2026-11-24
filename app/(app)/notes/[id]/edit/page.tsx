import { notFound } from "next/navigation";
import { GlassCard } from "@/components/glass-card";
import { NoteForm } from "@/components/notes/note-form";
import { MeetingForm } from "@/components/notes/meeting-form";
import { MeetingActionItemsSection } from "@/components/notes/meeting-action-items-section";
import { MeetingDocumentsSection, type NoteDocumentWithUrl } from "@/components/notes/meeting-documents-section";
import { getMeetingActionItems } from "@/lib/actions/meetings";
import { createClient } from "@/lib/supabase/server";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { contactLabel } from "@/lib/contacts";
import { hasDisplayNickname, projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, NoteDocument, Person, Project } from "@/lib/types";

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

  const [{ data: contactsData }, { data: projectsData }, { data: opportunitiesData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, nickname, archived_at"),
    supabase.from("projects").select("id, name, nickname"),
    supabase.from("opportunities").select("id, title"),
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
  const opportunities = (opportunitiesData as { id: string; title: string }[] | null) ?? [];
  const opportunityOptions = opportunities.map((o) => ({ id: o.id, label: o.title }));

  if (note.kind === "meeting") {
    const [{ data: peopleData }, { data: participantsData }, { data: documentsData }, documentTypes, actionItems] =
      await Promise.all([
        supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
        supabase.from("note_participants").select("person_id").eq("note_id", id),
        supabase.from("note_documents").select("*").eq("note_id", id).order("created_at", { ascending: false }),
        getActiveDocumentTypes(),
        getMeetingActionItems(id, note.project_id),
      ]);
    const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
      id: p.id,
      label: personLabel(p),
    }));
    const participantIds = ((participantsData as { person_id: string }[] | null) ?? []).map((r) => r.person_id);
    const { data: participantPeopleData } =
      participantIds.length > 0
        ? await supabase.from("people").select("id, first_name, last_name").in("id", participantIds)
        : { data: [] as Pick<Person, "id" | "first_name" | "last_name">[] };
    const participants = ((participantPeopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map(
      (p) => ({ key: p.id, personId: p.id, label: personLabel(p) })
    );

    const documents = (documentsData as NoteDocument[] | null) ?? [];
    let documentsWithUrls: NoteDocumentWithUrl[] = documents.map((doc) => ({ ...doc, signedUrl: null }));
    const filePaths = documents.map((doc) => doc.file_path).filter((p): p is string => Boolean(p));
    if (filePaths.length > 0) {
      const { data: signedUrls } = await supabase.storage.from("note-documents").createSignedUrls(filePaths, 3600);
      const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
      documentsWithUrls = documents.map((doc) => ({
        ...doc,
        signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
      }));
    }

    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.meetingForm.editMeetingTitle}</h1>
        </div>
        <MeetingForm
          mode="edit"
          note={note}
          participants={participants}
          people={people}
          projects={projectOptions}
          contacts={contactOptions}
          opportunities={opportunityOptions}
          lang={lang}
        />

        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.common.documents}</h2>
          <GlassCard interactive={false} className="p-6">
            <MeetingDocumentsSection
              meetingId={note.id}
              documents={documentsWithUrls}
              documentTypes={documentTypes}
              lang={lang}
            />
          </GlassCard>
        </div>

        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.meetingForm.actionItemsLabel}</h2>
          <GlassCard interactive={false} className="p-6">
            <MeetingActionItemsSection meetingId={note.id} items={actionItems} projectId={note.project_id} lang={lang} />
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.notes.editNoteTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.notes.editNoteSubtitle}</p>
      </div>
      <NoteForm
        mode="edit"
        note={note}
        projects={projectOptions}
        contacts={contactOptions}
        opportunities={opportunityOptions}
        lang={lang}
      />
    </div>
  );
}
