import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { MeetingBadge } from "@/components/notes/badges";
import { MeetingActionItemsSection } from "@/components/notes/meeting-action-items-section";
import { MeetingDocumentsSection, type NoteDocumentWithUrl } from "@/components/notes/meeting-documents-section";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { getMeetingActionItems } from "@/lib/actions/meetings";
import { createClient } from "@/lib/supabase/server";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { formatDateOnly } from "@/lib/projects";
import { personLabel } from "@/lib/people";
import { projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, NoteDocument, Person, Project } from "@/lib/types";

interface MeetingDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MeetingDetailPage({ params }: MeetingDetailPageProps) {
  const { id } = await params;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const { data } = await supabase.from("notes").select("*").eq("id", id).maybeSingle();
  const note = data as Note | null;

  if (!note) {
    notFound();
  }

  // This route is only a real "detail page" for a meeting — a plain
  // note has no view of its own, just /notes/[id]/edit. Redirecting
  // rather than 404ing keeps /notes/[id] safe to use as a generic link
  // target for any note's own activity-log rows (lib/activity.ts's
  // activityTarget).
  if (note.kind !== "meeting") {
    redirect(`/notes/${id}/edit`);
  }

  const [{ data: participantsData }, { data: documentsData }, documentTypes, actionItems] = await Promise.all([
    supabase.from("note_participants").select("person_id").eq("note_id", id),
    supabase.from("note_documents").select("*").eq("note_id", id).order("created_at", { ascending: false }),
    getActiveDocumentTypes(),
    getMeetingActionItems(id, note.project_id),
  ]);

  const participantIds = ((participantsData as { person_id: string }[] | null) ?? []).map((r) => r.person_id);
  const { data: peopleData } =
    participantIds.length > 0
      ? await supabase.from("people").select("id, first_name, last_name, archived_at").in("id", participantIds)
      : { data: [] as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] };
  const participants = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];

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

  // The link chip — same "whichever one is set" dispatch as the
  // Opportunity detail page's own converted-to display.
  let linkLabel: string | null = null;
  let linkHref: string | null = null;
  if (note.project_id) {
    const { data: projectRow } = await supabase
      .from("projects")
      .select("name, nickname")
      .eq("id", note.project_id)
      .maybeSingle();
    if (projectRow) {
      linkLabel = projectDisplayName(projectRow as Pick<Project, "name" | "nickname">);
      linkHref = `/projects/${note.project_id}`;
    }
  } else if (note.contact_id) {
    const { data: contactRow } = await supabase
      .from("contacts")
      .select("full_name, nickname")
      .eq("id", note.contact_id)
      .maybeSingle();
    if (contactRow) {
      linkLabel = receiverDisplayName(contactRow as Pick<Contact, "full_name" | "nickname">);
      linkHref = `/receivers/${note.contact_id}`;
    }
  } else if (note.opportunity_id) {
    const { data: opportunityRow } = await supabase
      .from("opportunities")
      .select("title")
      .eq("id", note.opportunity_id)
      .maybeSingle();
    if (opportunityRow) {
      linkLabel = (opportunityRow as { title: string }).title;
      linkHref = `/opportunities/${note.opportunity_id}`;
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/notes" className="text-xs font-medium text-white/40 hover:text-white/70">
            {t.meetingDetail.backToNotes}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{note.title}</h1>
            <MeetingBadge date={note.meeting_date ? formatDateOnly(note.meeting_date, lang) : undefined} lang={lang} />
          </div>
          {linkLabel && linkHref && (
            <Link href={linkHref} className="mt-1.5 inline-block text-xs text-accent-soft hover:underline">
              {linkLabel}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/notes/${note.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Pencil className="h-4 w-4" />
            {t.common.edit}
          </Link>
          <DeleteNoteButton noteId={note.id} lang={lang} />
        </div>
      </div>

      {participants.length > 0 && (
        <GlassCard interactive={false} className="mb-6 p-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.meetingForm.participantsLabel}</h2>
          <div className="flex flex-wrap gap-1.5">
            {participants.map((person) => (
              <span
                key={person.id}
                className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm text-white/80"
              >
                {personLabel(person)}
                {person.archived_at && <span className="ml-1 text-[11px] text-white/40">({t.common.archived})</span>}
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard interactive={false} className="mb-6 p-6">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-white/35 uppercase">{t.meetingForm.summaryLabel}</h2>
        <p className="text-sm whitespace-pre-wrap text-white/85">{note.content}</p>
      </GlassCard>

      <div className="mb-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.common.documents}</h2>
        <GlassCard interactive={false} className="p-6">
          <MeetingDocumentsSection documents={documentsWithUrls} documentTypes={documentTypes} lang={lang} />
        </GlassCard>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.meetingForm.actionItemsLabel}</h2>
        <GlassCard interactive={false} className="p-6">
          <MeetingActionItemsSection items={actionItems} projectId={note.project_id} lang={lang} />
        </GlassCard>
      </div>
    </div>
  );
}
