"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Pencil, StickyNote, Trash2 } from "lucide-react";
import {
  createProjectStep,
  deleteProjectStep,
  setProjectStepDone,
  updateProjectStep,
} from "@/lib/actions/project-steps";
import { addProjectNote, deleteProjectNote, setNoteReminderDone, updateProjectNote } from "@/lib/actions/notes";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { formatDateTime } from "@/lib/format";
import type { Note, ProjectStep, ProjectStepKind } from "@/lib/types";

// A project's timeline is step_taken/next_step entries (project_steps)
// and the project's own notes (notes.project_id) merged into one feed
// — see supabase/migrations/014_notes_projects_reminders.sql, which
// moved "Note" off project_steps and onto the notes table everyone
// else already uses. "composer" below is the one add-kind the UI
// still offers for notes alongside the two real step kinds.
type ComposerKind = ProjectStepKind | "note";

type TimelineEntry = { kind: "step"; data: ProjectStep } | { kind: "note"; data: Note };

interface ProjectTimelineProps {
  projectId: string;
  steps: ProjectStep[];
  notes: Note[];
  authorNameById: Record<string, string>;
}

const KIND_ICON: Record<ComposerKind, typeof CalendarClock> = {
  step_taken: CheckCircle2,
  next_step: CalendarClock,
  note: StickyNote,
};

const KIND_LABEL: Record<ComposerKind, string> = {
  step_taken: "Step taken",
  next_step: "Next step",
  note: "Note",
};

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface TimelineRowProps {
  entry: TimelineEntry;
  projectId: string;
  authorName: string;
  onRefresh: () => void;
}

function TimelineRow({ entry, projectId, authorName, onRefresh }: TimelineRowProps) {
  const isNote = entry.kind === "note";
  const step = entry.kind === "step" ? entry.data : null;
  const note = entry.kind === "note" ? entry.data : null;

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [body, setBody] = useState(step ? step.body : note!.content);
  const [dueDate, setDueDate] = useState((step ? step.due_date : note!.due_date) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const composerKind: ComposerKind = step ? step.kind : "note";
  const Icon = KIND_ICON[composerKind];

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const result = step
          ? await updateProjectStep(step.id, projectId, body, step.kind === "next_step" ? dueDate || null : null)
          : await updateProjectNote(note!.id, projectId, body, dueDate || null);
        if (result.error) {
          setError(result.error);
          return;
        }
        setEditing(false);
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = step
          ? await deleteProjectStep(step.id, projectId)
          : await deleteProjectNote(note!.id, projectId);
        if (result.error) {
          setError(result.error);
          setConfirmingDelete(false);
          return;
        }
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        setConfirmingDelete(false);
      }
    });
  }

  function handleToggleDone(done: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = step
          ? await setProjectStepDone(step.id, projectId, done)
          : await setNoteReminderDone(note!.id, done);
        if (result.error) {
          setError(result.error);
          return;
        }
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  const showCheckbox = step ? step.kind === "next_step" : note!.is_reminder;
  const checked = step ? step.done : note!.reminder_done;
  const createdAt = step ? step.created_at : note!.created_at;
  const dueDateValue = step ? step.due_date : note!.due_date;
  const doneAt = step?.done_at ?? null;

  if (editing) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          className={fieldClass}
          disabled={isPending}
        />
        {(step ? step.kind === "next_step" : true) && (
          <div className="mt-2">
            {isNote && <label className="mb-1 block text-xs font-medium text-white/55">Reminder date (optional)</label>}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isPending}
              className={fieldClass}
            />
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setBody(step ? step.body : note!.content);
              setDueDate((step ? step.due_date : note!.due_date) ?? "");
              setError(null);
            }}
            disabled={isPending}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
      {showCheckbox ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => handleToggleDone(e.target.checked)}
          disabled={isPending}
          aria-label={checked ? "Mark as not done" : "Mark as done"}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
        />
      ) : (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
            {KIND_LABEL[composerKind]}
          </span>
          {dueDateValue && !checked && <DueDateBadge dueDate={dueDateValue} />}
        </div>
        <p className={`mt-1 text-sm whitespace-pre-wrap ${checked ? "text-white/40 line-through" : "text-white/85"}`}>
          {body}
        </p>
        <p className="mt-1 text-xs text-white/35">
          {authorName} · {formatDateTime(createdAt)}
          {step && step.done && doneAt && <> · Done {formatDateTime(doneAt)}</>}
          {note && note.is_reminder && note.reminder_done && <> · Reminder done</>}
        </p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isPending}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit entry"
              className="rounded-md p-1.5 text-white/30 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/70"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete entry"
              className="rounded-md p-1.5 text-white/30 transition-colors duration-150 ease-out hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const QUICK_ADD_KINDS: ComposerKind[] = ["step_taken", "next_step", "note"];

export function ProjectTimeline({ projectId, steps, notes, authorNameById }: ProjectTimelineProps) {
  const router = useRouter();
  const [composerKind, setComposerKind] = useState<ComposerKind | null>(null);
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function openComposer(kind: ComposerKind) {
    setComposerKind(kind);
    setBody("");
    setDueDate("");
    setError(null);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function handleCreate() {
    if (!composerKind) return;
    setError(null);
    startTransition(async () => {
      try {
        const result =
          composerKind === "note"
            ? await addProjectNote(projectId, body, dueDate || null)
            : await createProjectStep(projectId, composerKind, body, composerKind === "next_step" ? dueDate || null : null);
        if (result.error) {
          setError(result.error);
          return;
        }
        setComposerKind(null);
        setBody("");
        setDueDate("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function authorNameFor(entry: TimelineEntry): string {
    const authorId = entry.kind === "step" ? entry.data.author_id : entry.data.created_by;
    return (authorId && authorNameById[authorId]) || "Unknown user";
  }

  // Pinned: still-open next steps, earliest due date first. Everything
  // else — step_taken, notes, and next steps once checked off — lives
  // only in History below, newest first; a next step moves there the
  // moment it's marked done.
  const openNextSteps: TimelineEntry[] = steps
    .filter((s) => s.kind === "next_step" && !s.done)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .map((data) => ({ kind: "step" as const, data }));

  const historyEntries: TimelineEntry[] = [
    ...steps.filter((s) => !(s.kind === "next_step" && !s.done)).map((data) => ({ kind: "step" as const, data })),
    ...notes.map((data) => ({ kind: "note" as const, data })),
  ].sort((a, b) => b.data.created_at.localeCompare(a.data.created_at));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {QUICK_ADD_KINDS.map((kind) => {
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => openComposer(kind)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
            >
              <Icon className="h-3.5 w-3.5" />
              {KIND_LABEL[kind]}
            </button>
          );
        })}
      </div>

      {composerKind && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3.5">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={
              composerKind === "next_step"
                ? "What's the next step?"
                : composerKind === "step_taken"
                  ? "What step was taken?"
                  : "Note…"
            }
            className={fieldClass}
            disabled={isPending}
          />
          {composerKind === "next_step" && (
            <div className="mt-2">
              <label className="mb-1 block text-xs font-medium text-white/55">Due date *</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
                className={fieldClass}
              />
            </div>
          )}
          {composerKind === "note" && (
            <div className="mt-2">
              <label className="mb-1 block text-xs font-medium text-white/55">Reminder date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
                className={fieldClass}
              />
            </div>
          )}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setComposerKind(null)}
              disabled={isPending}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {openNextSteps.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wide text-white/35 uppercase">Open Next Steps</p>
          <div className="flex flex-col gap-2">
            {openNextSteps.map((entry) => (
              <TimelineRow
                key={entry.data.id}
                entry={entry}
                projectId={projectId}
                authorName={authorNameFor(entry)}
                onRefresh={() => router.refresh()}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-medium tracking-wide text-white/35 uppercase">History</p>
        {historyEntries.length === 0 ? (
          <p className="text-sm text-white/35">No timeline entries yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {historyEntries.map((entry) => (
              <TimelineRow
                key={entry.data.id}
                entry={entry}
                projectId={projectId}
                authorName={authorNameFor(entry)}
                onRefresh={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
