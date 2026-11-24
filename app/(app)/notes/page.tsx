import Link from "next/link";
import { Suspense } from "react";
import { Briefcase, Contact as ContactIcon, FolderKanban, Plus, StickyNote } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { NoteFilters } from "@/components/notes/note-filters";
import { ReminderBadge, MeetingBadge } from "@/components/notes/badges";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/projects";
import { projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, Project } from "@/lib/types";

interface NotesPageProps {
  searchParams: Promise<{ reminders?: string; type?: string; meetings?: string }>;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const params = await searchParams;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  let query = supabase.from("notes").select("*").order("created_at", { ascending: false });
  if (params.reminders === "true") {
    query = query.eq("is_reminder", true);
  }
  if (params.meetings === "true") {
    query = query.eq("kind", "meeting");
  }
  if (params.type === "project") {
    query = query.not("project_id", "is", null);
  } else if (params.type === "contact") {
    query = query.not("contact_id", "is", null);
  } else if (params.type === "opportunity") {
    query = query.not("opportunity_id", "is", null);
  }

  const { data, error } = await query;
  const notes = (data as Note[] | null) ?? [];

  const contactIds = notes.map((n) => n.contact_id).filter((id): id is string => Boolean(id));
  const projectIds = notes.map((n) => n.project_id).filter((id): id is string => Boolean(id));
  const opportunityIds = notes.map((n) => n.opportunity_id).filter((id): id is string => Boolean(id));

  const [{ data: contactsData }, { data: projectsData }, { data: opportunitiesData }] = await Promise.all([
    contactIds.length > 0
      ? supabase.from("contacts").select("id, full_name, nickname").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? supabase.from("projects").select("id, name, nickname").in("id", projectIds)
      : Promise.resolve({ data: [] }),
    opportunityIds.length > 0
      ? supabase.from("opportunities").select("id, title").in("id", opportunityIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactsById = new Map(
    ((contactsData as Pick<Contact, "id" | "full_name" | "nickname">[] | null) ?? []).map((c) => [c.id, c])
  );
  const projectsById = new Map(
    ((projectsData as Pick<Project, "id" | "name" | "nickname">[] | null) ?? []).map((p) => [p.id, p])
  );
  const opportunitiesById = new Map(
    ((opportunitiesData as { id: string; title: string }[] | null) ?? []).map((o) => [o.id, o])
  );

  function linkFor(note: Note): { href: string; label: string; icon: typeof ContactIcon } | null {
    if (note.project_id) {
      const project = projectsById.get(note.project_id);
      return {
        href: `/projects/${note.project_id}`,
        label: project ? projectDisplayName(project) : t.noteForm.project,
        icon: FolderKanban,
      };
    }
    if (note.contact_id) {
      const contact = contactsById.get(note.contact_id);
      return {
        href: `/receivers/${note.contact_id}`,
        label: contact ? receiverDisplayName(contact) : t.noteForm.receiver,
        icon: ContactIcon,
      };
    }
    if (note.opportunity_id) {
      const opportunity = opportunitiesById.get(note.opportunity_id);
      return {
        href: `/opportunities/${note.opportunity_id}`,
        label: opportunity?.title ?? t.noteForm.opportunity,
        icon: Briefcase,
      };
    }
    return null;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.notes.title}</h1>
          <p className="mt-1 text-sm text-white/45">{t.notes.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/notes/new-meeting"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Plus className="h-4 w-4" />
            {t.notes.newMeeting}
          </Link>
          <Link
            href="/notes/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            {t.notes.newNote}
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <Suspense>
          <NoteFilters lang={lang} />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          {t.notes.failedToLoad(error.message)}
        </GlassCard>
      )}

      {!error && notes.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <StickyNote className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">
            {params.reminders === "true" || params.meetings === "true" || params.type
              ? t.notes.noMatchingNotes
              : t.notes.noNotesYet}
          </p>
          <p className="max-w-xs text-xs text-white/35">
            {params.reminders === "true" || params.meetings === "true" || params.type
              ? t.notes.noMatchFilters
              : t.notes.emptyHint}
          </p>
        </GlassCard>
      )}

      {!error && notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((note) => {
            const link = linkFor(note);
            const isMeeting = note.kind === "meeting";
            return (
              <GlassCard key={note.id} interactive={false} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={isMeeting ? `/notes/${note.id}` : `/notes/${note.id}/edit`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {note.title && <p className="font-medium text-white/85 hover:text-white">{note.title}</p>}
                      {isMeeting ? (
                        <MeetingBadge date={note.meeting_date ? formatDateOnly(note.meeting_date, lang) : undefined} lang={lang} />
                      ) : (
                        note.is_reminder && note.due_date && <ReminderBadge dueDate={note.due_date} lang={lang} />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-white/60">{note.content}</p>
                    {link && (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-white/40">
                        <link.icon className="h-3 w-3" />
                        {link.label}
                      </p>
                    )}
                  </Link>
                  <DeleteNoteButton noteId={note.id} lang={lang} />
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
