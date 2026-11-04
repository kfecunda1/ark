"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { NoteLinkPicker, type LinkOption } from "@/components/notes/note-link-picker";
import { createNote, updateNote, type NoteFormState } from "@/lib/actions/notes";
import type { Note } from "@/lib/types";

interface NoteFormProps {
  mode: "create" | "edit";
  note?: Note;
  contacts: LinkOption[];
  defaultContactId?: string | null;
}

const initialState: NoteFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function NoteForm({ mode, note, contacts, defaultContactId }: NoteFormProps) {
  const action = mode === "edit" && note ? updateNote.bind(null, note.id) : createNote;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [isReminder, setIsReminder] = useState(note?.is_reminder ?? false);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <GlassCard interactive={false} className="flex flex-col gap-5 p-6">
        <div>
          <label className={labelClass} htmlFor="title">
            Title
          </label>
          <input id="title" name="title" defaultValue={note?.title ?? ""} className={fieldClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="content">
            Content *
          </label>
          <textarea
            id="content"
            name="content"
            required
            rows={5}
            defaultValue={note?.content ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
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
        </div>

        {isReminder && (
          <div>
            <label className={labelClass} htmlFor="due_date">
              Due date *
            </label>
            <input
              id="due_date"
              name="due_date"
              type="date"
              required={isReminder}
              defaultValue={note?.due_date ?? ""}
              className={fieldClass}
            />
          </div>
        )}

        <NoteLinkPicker contacts={contacts} defaultContactId={defaultContactId ?? note?.contact_id ?? null} />
      </GlassCard>

      {state?.error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Create note"}
        </button>
        <Link
          href="/notes"
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
