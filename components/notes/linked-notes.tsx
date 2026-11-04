import Link from "next/link";
import { Plus } from "lucide-react";
import { ReminderBadge } from "@/components/notes/badges";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { formatDateTime } from "@/lib/format";
import type { Note } from "@/lib/types";

interface LinkedNotesProps {
  notes: Note[];
  addHref: string;
}

export function LinkedNotes({ notes, addHref }: LinkedNotesProps) {
  return (
    <div className="flex flex-col gap-2">
      {notes.length === 0 ? (
        <p className="text-sm text-white/35">No notes yet.</p>
      ) : (
        notes.map((note) => (
          <div
            key={note.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
          >
            <Link href={`/notes/${note.id}/edit`} className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {note.title && <p className="truncate text-sm font-medium text-white/85">{note.title}</p>}
                {note.is_reminder && note.due_date && <ReminderBadge dueDate={note.due_date} />}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-white/60">{note.content}</p>
              <p className="mt-1 text-xs text-white/35">{formatDateTime(note.created_at)}</p>
            </Link>
            <DeleteNoteButton noteId={note.id} />
          </div>
        ))
      )}
      <Link
        href={addHref}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Note
      </Link>
    </div>
  );
}
