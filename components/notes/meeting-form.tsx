"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { NoteLinkPicker, type LinkOption } from "@/components/notes/note-link-picker";
import { ParticipantsPicker, type ParticipantEntry, type ParticipantOption } from "@/components/notes/participants-picker";
import { ActionItemsEditor, type ActionItemEntry } from "@/components/notes/action-items-editor";
import { StagedDocumentPicker, type StagedNoteDocument } from "@/components/notes/staged-document-picker";
import {
  addNoteDocument,
  addNoteDocumentLink,
  attachInboxItemToMeeting,
  createMeetingWithId,
  updateMeeting,
  type MeetingFormState,
} from "@/lib/actions/meetings";
import { quickCreatePerson } from "@/lib/actions/people";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import { dateKeyInTimeZone } from "@/lib/format";
import type { DocumentTypeRecord, Note } from "@/lib/types";

interface MeetingFormProps {
  mode: "create" | "edit";
  note?: Note;
  participants?: ParticipantEntry[];
  people: ParticipantOption[];
  projects: LinkOption[];
  contacts: LinkOption[];
  opportunities: LinkOption[];
  // Create mode only.
  documentTypes?: DocumentTypeRecord[];
  defaultTitle?: string;
  defaultSummary?: string;
  defaultMeetingDate?: string;
  defaultActionItems?: ActionItemEntry[];
  // Set when arriving from the Inbox's "File as meeting summary"
  // action (components/inbox/inbox-tabs.tsx) — once the meeting is
  // actually saved, the item's own file (if any) is moved in as the
  // meeting's first attachment and the item is marked filed.
  fromInboxItemId?: string;
  defaultDocumentType?: string;
  lang?: Lang;
}

const initialState: MeetingFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function MeetingForm({
  mode,
  note,
  participants = [],
  people,
  projects,
  contacts,
  opportunities,
  documentTypes = [],
  defaultTitle,
  defaultSummary,
  defaultMeetingDate,
  defaultActionItems = [],
  fromInboxItemId,
  defaultDocumentType,
  lang = "en",
}: MeetingFormProps) {
  const router = useRouter();
  const t = getDictionary(lang);

  const editAction = mode === "edit" && note ? updateMeeting.bind(null, note.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  const [participantEntries, setParticipantEntries] = useState<ParticipantEntry[]>(participants);
  const [actionItems, setActionItems] = useState<ActionItemEntry[]>(defaultActionItems);
  const [stagedDocuments, setStagedDocuments] = useState<StagedNoteDocument[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<"idle" | "creating" | "uploading">("idle");
  const [uploadProgress, setUploadProgress] = useState<{ index: number; total: number; percent: number } | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  function addParticipant(option: ParticipantOption) {
    setParticipantEntries((prev) => [...prev, { key: option.id, personId: option.id, label: option.label }]);
  }
  function removeParticipant(personId: string) {
    setParticipantEntries((prev) => prev.filter((e) => e.personId !== personId));
  }

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    disableSubmitButton(submitButtonRef);
    e.preventDefault();
    setCreateError(null);
    setCreateStatus("creating");

    const formData = new FormData(e.currentTarget);
    const result = await createMeetingWithId(formData);

    if (result.error || !result.id) {
      setCreateError(resolveError(result.error, lang) ?? t.meetingForm.failedToCreate);
      setCreateStatus("idle");
      return;
    }

    const meetingId = result.id;
    const failedNames: string[] = [];

    if (stagedDocuments.length > 0) {
      setCreateStatus("uploading");

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const total = stagedDocuments.length;
      for (let i = 0; i < total; i++) {
        const doc = stagedDocuments[i];
        setUploadProgress({ index: i + 1, total, percent: 0 });
        try {
          if (doc.kind === "link") {
            const addResult = await addNoteDocumentLink(meetingId, doc.type, doc.name, doc.url);
            if (addResult.error) throw new Error(addResult.error);
          } else {
            if (!session) throw new Error("Session expired");
            const path = buildDocumentPath(doc.file.name);
            await uploadFileWithProgress("note-documents", doc.file, path, session.access_token, (percent) =>
              setUploadProgress({ index: i + 1, total, percent })
            );
            const addResult = await addNoteDocument(meetingId, doc.type, path, doc.file.name, doc.hash);
            if (addResult.error) throw new Error(addResult.error);
          }
        } catch {
          failedNames.push(doc.kind === "file" ? doc.file.name : doc.name);
        }
      }
      setUploadProgress(null);
    }

    if (fromInboxItemId) {
      try {
        const attachResult = await attachInboxItemToMeeting(
          fromInboxItemId,
          meetingId,
          defaultDocumentType || documentTypes[0]?.name || ""
        );
        if (attachResult.error) failedNames.push(t.meetingForm.inboxAttachmentFallbackName);
      } catch {
        failedNames.push(t.meetingForm.inboxAttachmentFallbackName);
      }
    }

    const params = new URLSearchParams();
    if (failedNames.length > 0) params.set("failedDocs", failedNames.join(","));
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`/notes/${meetingId}${query}`);
  }

  const formProps =
    mode === "edit"
      ? { action: editFormAction, onSubmit: () => disableSubmitButton(submitButtonRef) }
      : { onSubmit: handleCreateSubmit };
  const error = mode === "edit" ? resolveError(editState?.error ?? null, lang) : createError;
  const isPending = mode === "edit" ? isEditPending : createStatus !== "idle";

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <GlassCard interactive={false} className="flex flex-col gap-5 p-6">
        <div>
          <label className={labelClass} htmlFor="title">
            {t.meetingForm.titleLabel}
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={note?.title ?? defaultTitle ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="meeting_date">
            {t.meetingForm.meetingDateLabel}
          </label>
          <input
            id="meeting_date"
            name="meeting_date"
            type="date"
            required
            defaultValue={note?.meeting_date ?? defaultMeetingDate ?? dateKeyInTimeZone(new Date().toISOString())}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>{t.meetingForm.participantsLabel}</label>
          <ParticipantsPicker
            entries={participantEntries}
            options={people}
            onAdd={addParticipant}
            onRemove={removeParticipant}
            lang={lang}
            onQuickCreate={async (name) => {
              const result = await quickCreatePerson({ name });
              return {
                option: result.person
                  ? { id: result.person.id, label: [result.person.first_name, result.person.last_name].filter(Boolean).join(" ") }
                  : null,
                error: resolveError(result.error, lang),
              };
            }}
          />
        </div>

        <NoteLinkPicker
          projects={projects}
          contacts={contacts}
          opportunities={opportunities}
          defaultLinkType={note?.project_id ? "project" : note?.contact_id ? "contact" : note?.opportunity_id ? "opportunity" : "none"}
          defaultLinkId={note?.project_id ?? note?.contact_id ?? note?.opportunity_id ?? null}
          lang={lang}
        />

        <div>
          <label className={labelClass} htmlFor="content">
            {t.meetingForm.summaryLabel}
          </label>
          <textarea
            id="content"
            name="content"
            rows={6}
            defaultValue={note?.content ?? defaultSummary ?? ""}
            placeholder={t.meetingForm.summaryPlaceholder}
            className={fieldClass}
          />
        </div>
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>{t.meetingForm.attachmentsLabel}</p>
          <StagedDocumentPicker documents={stagedDocuments} onChange={setStagedDocuments} documentTypes={documentTypes} lang={lang} />
        </GlassCard>
      )}

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>{t.meetingForm.actionItemsLabel}</p>
          <p className="mb-2 text-xs text-white/35">{t.meetingForm.actionItemsHint}</p>
          <ActionItemsEditor items={actionItems} onChange={setActionItems} lang={lang} />
        </GlassCard>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            ref={submitButtonRef}
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === "edit"
              ? isEditPending
                ? t.common.saving
                : t.meetingForm.saveChanges
              : createStatus === "uploading"
                ? uploadProgress
                  ? t.meetingForm.uploadingProgress(uploadProgress.index, uploadProgress.total, uploadProgress.percent)
                  : t.meetingForm.uploadingDocuments
                : createStatus === "creating"
                  ? t.common.creating
                  : t.meetingForm.createMeeting}
          </button>
          <Link
            href={mode === "edit" && note ? `/notes/${note.id}` : "/notes"}
            className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            {t.common.cancel}
          </Link>
        </div>
        {uploadProgress && (
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150 ease-out"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        )}
      </div>
    </form>
  );
}
