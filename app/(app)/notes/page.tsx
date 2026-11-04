import Link from "next/link";
import { Suspense } from "react";
import { Contact as ContactIcon, Plus, StickyNote } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { NoteFilters } from "@/components/notes/note-filters";
import { ReminderBadge } from "@/components/notes/badges";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { createClient } from "@/lib/supabase/server";
import type { Contact, Note } from "@/lib/types";

interface NotesPageProps {
  searchParams: Promise<{ reminders?: string }>;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("notes").select("*").order("created_at", { ascending: false });
  if (params.reminders === "true") {
    query = query.eq("is_reminder", true);
  }

  const { data, error } = await query;
  const notes = (data as Note[] | null) ?? [];

  const contactIds = notes.map((n) => n.contact_id).filter((id): id is string => Boolean(id));

  const { data: contactsData } =
    contactIds.length > 0
      ? await supabase.from("contacts").select("id, full_name").in("id", contactIds)
      : { data: [] };

  const contactsById = new Map(
    ((contactsData as Pick<Contact, "id" | "full_name">[] | null) ?? []).map((c) => [c.id, c])
  );

  function linkFor(note: Note): { href: string; label: string } | null {
    if (!note.contact_id) return null;
    const contact = contactsById.get(note.contact_id);
    return { href: `/contacts/${note.contact_id}`, label: contact?.full_name ?? "Contact" };
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Notes</h1>
          <p className="mt-1 text-sm text-white/45">Free-form notes and reminders, optionally linked to a contact.</p>
        </div>
        <Link
          href="/notes/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          New Note
        </Link>
      </div>

      <div className="mb-4">
        <Suspense>
          <NoteFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load notes: {error.message}
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
            {params.reminders === "true" ? "No matching notes" : "No notes yet"}
          </p>
          <p className="max-w-xs text-xs text-white/35">
            {params.reminders === "true"
              ? "No notes match the current filters."
              : "Notes and reminders you create will show up here."}
          </p>
        </GlassCard>
      )}

      {!error && notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((note) => {
            const link = linkFor(note);
            return (
              <GlassCard key={note.id} interactive={false} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/notes/${note.id}/edit`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {note.title && <p className="font-medium text-white/85 hover:text-white">{note.title}</p>}
                      {note.is_reminder && note.due_date && <ReminderBadge dueDate={note.due_date} />}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-white/60">{note.content}</p>
                    {link && (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-white/40">
                        <ContactIcon className="h-3 w-3" />
                        {link.label}
                      </p>
                    )}
                  </Link>
                  <DeleteNoteButton noteId={note.id} />
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
