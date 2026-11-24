"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, X, Pencil } from "lucide-react";
import { setProjectStepDone } from "@/lib/actions/project-steps";
import { setNoteReminderDone } from "@/lib/actions/notes";
import { addMeetingActionItem, deleteMeetingActionItem, updateMeetingActionItem } from "@/lib/actions/meetings";
import { DueDateBadge } from "@/components/projects/due-date-badge";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { MeetingActionItem } from "@/lib/actions/meetings";

interface MeetingActionItemsSectionProps {
  meetingId: string;
  items: MeetingActionItem[];
  // Needed for project_step-kind items — setProjectStepDone and the
  // add/edit/delete actions all take the owning project id alongside
  // the item's own id (and it's also how a new item knows whether to
  // become a next_step or a reminder note — lib/actions/meetings.ts's
  // addMeetingActionItem).
  projectId: string | null;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// "The detail shows ... action items with their done/open state
// (ticking one marks the underlying next step or reminder done)" plus
// (this follow-up round) add/edit/delete, each dispatching to whichever
// table that item's own `kind` lives in (lib/actions/meetings.ts's
// getMeetingActionItems already resolved which one) — used on both the
// meeting's detail page and its edit page.
export function MeetingActionItemsSection({ meetingId, items, projectId, lang = "en" }: MeetingActionItemsSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [newText, setNewText] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  function handleToggle(item: MeetingActionItem, done: boolean) {
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result =
          item.kind === "project_step"
            ? await setProjectStepDone(item.id, projectId!, done)
            : await setNoteReminderDone(item.id, done);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingId(null);
      }
    });
  }

  function startEdit(item: MeetingActionItem) {
    setError(null);
    setConfirmingDeleteId(null);
    setEditingId(item.id);
    setEditText(item.text);
    setEditDueDate(item.dueDate ?? "");
  }

  function handleEditSave(item: MeetingActionItem) {
    if (!editText.trim()) return;
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await updateMeetingActionItem(
          meetingId,
          item.id,
          item.kind,
          projectId,
          editText,
          editDueDate || null
        );
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setEditingId(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleDelete(item: MeetingActionItem) {
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await deleteMeetingActionItem(meetingId, item.id, item.kind, projectId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setConfirmingDeleteId(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleAdd() {
    if (!newText.trim()) return;
    setError(null);
    setIsAdding(true);
    startTransition(async () => {
      try {
        const result = await addMeetingActionItem(meetingId, projectId, newText, newDueDate || null);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setNewText("");
        setNewDueDate("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setIsAdding(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-white/35">{t.meetingDetail.noActionItems}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const itemIsPending = isPending && pendingId === item.id;

            if (editingId === item.id) {
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5"
                >
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    disabled={itemIsPending}
                    className={`${fieldClass} min-w-[160px] flex-1`}
                  />
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    disabled={itemIsPending}
                    aria-label={t.meetingForm.actionItemDueDateAria}
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleEditSave(item)}
                    disabled={itemIsPending || !editText.trim()}
                    aria-label={t.common.save}
                    className="inline-flex items-center rounded-md bg-accent px-2 py-1.5 text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={itemIsPending}
                    aria-label={t.common.cancel}
                    className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => handleToggle(item, e.target.checked)}
                  disabled={itemIsPending}
                  aria-label={item.done ? t.meetingDetail.markNotDone : t.meetingDetail.markDone}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.done ? "text-white/40 line-through" : "text-white/85"}`}>{item.text}</p>
                  {item.dueDate && !item.done && (
                    <div className="mt-1">
                      <DueDateBadge dueDate={item.dueDate} lang={lang} />
                    </div>
                  )}
                  {confirmingDeleteId === item.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-rose-300">
                        {t.meetingDetail.deleteActionItemConfirm}
                        {item.done ? ` ${t.meetingDetail.deleteActionItemDoneWarning}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        disabled={itemIsPending}
                        className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {itemIsPending ? t.common.deleting : t.common.confirm}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={itemIsPending}
                        className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  )}
                </div>
                {confirmingDeleteId !== item.id && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      aria-label={t.meetingDetail.editActionItemAria(item.text)}
                      className="rounded-md p-1.5 text-white/30 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/70"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(item.id)}
                      aria-label={t.meetingForm.removeActionItem(item.text)}
                      className="rounded-md p-1.5 text-white/30 transition-colors duration-150 ease-out hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          disabled={isAdding}
          placeholder={t.meetingForm.actionItemPlaceholder}
          className={`${fieldClass} min-w-[160px] flex-1`}
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          disabled={isAdding}
          aria-label={t.meetingForm.actionItemDueDateAria}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isAdding || !newText.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.meetingForm.addActionItem}
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
