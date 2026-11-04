"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ReminderBadge } from "@/components/notes/badges";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { addContactNote } from "@/lib/actions/contacts";
import { formatDateTime } from "@/lib/format";
import type { Note } from "@/lib/types";

interface ContactNotesSectionProps {
  contactId: string;
  notes: Note[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// Adds a note directly from the contact page, unlike the Projects
// detail page's LinkedNotes (which links out to the standalone New Note
// page) — addContactNote doesn't redirect, so the form just clears and
// the new note appears in the list below without leaving this page.
export function ContactNotesSection({ contactId, notes }: ContactNotesSectionProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isReminder, setIsReminder] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function resetForm() {
    setTitle("");
    setContent("");
    setIsReminder(false);
    setDueDate("");
    setAdding(false);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!content.trim()) {
      setError('"Content" is required.');
      return;
    }
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await addContactNote(contactId, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        resetForm();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

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

      {adding ? (
        <form ref={formRef} onSubmit={handleSubmit} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="flex flex-col gap-2">
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className={fieldClass}
            />
            <textarea
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Content *"
              rows={3}
              required
              className={fieldClass}
            />
            <label className="flex items-center gap-2.5 text-sm text-white/80">
              <input
                type="checkbox"
                name="is_reminder"
                checked={isReminder}
                onChange={(e) => setIsReminder(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
              />
              This is a reminder
            </label>
            {isReminder && (
              <input
                type="date"
                name="due_date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required={isReminder}
                className={fieldClass}
              />
            )}
          </div>
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save Note"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Note
        </button>
      )}
    </div>
  );
}
