"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";

export interface ActionItemEntry {
  key: string;
  text: string;
  dueDate: string;
}

interface ActionItemsEditorProps {
  items: ActionItemEntry[];
  onChange: (items: ActionItemEntry[]) => void;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

let nextKey = 0;
export function newActionItemKey(): string {
  nextKey += 1;
  return `action-item-${Date.now()}-${nextKey}`;
}

// A dynamic text + optional-due-date list, submitted as one JSON hidden
// field (lib/actions/meetings.ts's parseActionItems) — used both by
// the New Meeting form's own "Action items" section and, pre-seeded,
// by the Inbox's "File as meeting summary" suggested items (components/
// inbox/inbox-tabs.tsx), which this same component lets the user edit
// or remove before saving.
export function ActionItemsEditor({ items, onChange, lang = "en" }: ActionItemsEditorProps) {
  const t = getDictionary(lang);
  const [draftText, setDraftText] = useState("");
  const [draftDue, setDraftDue] = useState("");

  function addItem() {
    const text = draftText.trim();
    if (!text) return;
    onChange([...items, { key: newActionItemKey(), text, dueDate: draftDue }]);
    setDraftText("");
    setDraftDue("");
  }

  function updateItem(key: string, patch: Partial<Pick<ActionItemEntry, "text" | "dueDate">>) {
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeItem(key: string) {
    onChange(items.filter((item) => item.key !== key));
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="action_items_json" value={JSON.stringify(items.map(({ text, dueDate }) => ({ text, dueDate: dueDate || null })))} />

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
              <input
                value={item.text}
                onChange={(e) => updateItem(item.key, { text: e.target.value })}
                className={`${fieldClass} min-w-[160px] flex-1`}
              />
              <input
                type="date"
                value={item.dueDate}
                onChange={(e) => updateItem(item.key, { dueDate: e.target.value })}
                aria-label={t.meetingForm.actionItemDueDateAria}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
              />
              <button
                type="button"
                onClick={() => removeItem(item.key)}
                aria-label={t.meetingForm.removeActionItem(item.text)}
                className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-rose-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder={t.meetingForm.actionItemPlaceholder}
          className={`${fieldClass} min-w-[160px] flex-1`}
        />
        <input
          type="date"
          value={draftDue}
          onChange={(e) => setDraftDue(e.target.value)}
          aria-label={t.meetingForm.actionItemDueDateAria}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!draftText.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.meetingForm.addActionItem}
        </button>
      </div>
    </div>
  );
}
