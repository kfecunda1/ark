"use client";

import { useRef, useState } from "react";
import { FileText, Link as LinkIcon, Loader2, X } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { findNoteDocumentsByHash } from "@/lib/actions/meetings";
import {
  DOCUMENT_FILE_ACCEPT,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  computeFileHash,
  formatFileSizeMB,
  isAllowedDocumentFile,
} from "@/lib/storage";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, NoteDocumentType } from "@/lib/types";

// Same shape as components/opportunities/staged-document-picker.tsx —
// files and links both stage client-side, uploaded/inserted only once
// the meeting note itself has been saved (lib/actions/meetings.ts's
// createMeetingWithId returns the new id first).
export type StagedNoteDocument =
  | { id: string; kind: "file"; type: NoteDocumentType; file: File; hash: string }
  | { id: string; kind: "link"; type: NoteDocumentType; name: string; url: string };

type StagedFileDocument = Extract<StagedNoteDocument, { kind: "file" }>;

function isFileDocument(doc: StagedNoteDocument): doc is StagedFileDocument {
  return doc.kind === "file";
}

// A file picked but not yet staged, waiting on the user to resolve a
// cross-meeting hash match before it's added to the list (or blocked
// outright if it matches a file already staged in this batch).
interface PendingFile {
  file: File;
  type: NoteDocumentType;
  hash: string;
  otherNoteMatches: { noteId: string; noteLabel: string; fileName: string }[];
}

interface StagedDocumentPickerProps {
  documents: StagedNoteDocument[];
  onChange: (documents: StagedNoteDocument[]) => void;
  documentTypes: DocumentTypeRecord[];
  lang?: Lang;
}

export function StagedDocumentPicker({ documents, onChange, documentTypes, lang = "en" }: StagedDocumentPickerProps) {
  const t = getDictionary(lang);
  const [mode, setMode] = useState<"file" | "link">("file");
  const [documentType, setDocumentType] = useState<NoteDocumentType>(documentTypes[0]?.name ?? "");
  const [checking, setChecking] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<NoteDocumentType>(documentTypes[0]?.name ?? "");

  function addFileDocument(file: File, type: NoteDocumentType, hash: string) {
    onChange([...documents, { id: crypto.randomUUID(), kind: "file", type, file, hash }]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setBlockedMessage(null);
    setPending(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setBlockedMessage(t.stagedDocuments.fileTooLarge(file.name, formatFileSizeMB(file.size), MAX_FILE_SIZE_MB));
      return;
    }

    if (!isAllowedDocumentFile(file)) {
      setBlockedMessage(t.stagedDocuments.unsupportedFileType(file.name));
      return;
    }

    setChecking(true);

    try {
      const hash = await computeFileHash(file);

      // The new meeting doesn't exist yet, so "the same record" means
      // a file already staged in this same picker — hard block, no DB
      // round trip needed.
      const sameBatch = documents.filter(isFileDocument).find((d) => d.hash === hash);
      if (sameBatch) {
        setBlockedMessage(t.stagedDocuments.alreadyAttachedAs(sameBatch.file.name));
        return;
      }

      // Nothing staged for this meeting exists in the DB yet, so any
      // hash match found is necessarily on a different note.
      const matches = await findNoteDocumentsByHash(hash);
      if (matches.length === 0) {
        addFileDocument(file, documentType, hash);
        return;
      }

      setPending({
        file,
        type: documentType,
        hash,
        otherNoteMatches: matches.map((m) => ({
          noteId: m.noteId,
          noteLabel: m.noteLabel,
          fileName: m.fileName,
        })),
      });
    } catch (err) {
      setBlockedMessage(err instanceof Error ? err.message : t.stagedDocuments.couldNotCheckDuplicates);
    } finally {
      setChecking(false);
    }
  }

  function confirmPending() {
    if (!pending) return;
    addFileDocument(pending.file, pending.type, pending.hash);
    setPending(null);
  }

  function cancelPending() {
    setPending(null);
  }

  function handleAddLink() {
    setBlockedMessage(null);
    const name = linkName.trim();
    const url = linkUrl.trim();

    if (!name) {
      setBlockedMessage(t.projectDocuments.giveLinkName);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setBlockedMessage(t.projectDocuments.linkMustBeUrl);
      return;
    }

    onChange([...documents, { id: crypto.randomUUID(), kind: "link", type: linkType, name, url }]);
    setLinkName("");
    setLinkUrl("");
  }

  function removeDocument(id: string) {
    onChange(documents.filter((doc) => doc.id !== id));
  }

  function typeLabel(type: NoteDocumentType): string {
    const record = documentTypes.find((dt) => dt.name === type);
    return record ? catalogLabel(record, lang) : type;
  }

  return (
    <div className="flex flex-col gap-3">
      {documents.length > 0 && (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {doc.kind === "link" ? (
                  <LinkIcon className="h-4 w-4 shrink-0 text-white/35" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-white/35" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/85">{doc.kind === "file" ? doc.file.name : doc.name}</p>
                  <div className="mt-0.5">
                    <ProjectDocumentTypeBadge type={doc.type} label={typeLabel(doc.type)} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeDocument(doc.id)}
                aria-label={t.stagedDocuments.removeFile(doc.kind === "file" ? doc.file.name : doc.name)}
                className="shrink-0 rounded-md p-1 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <>
          <DuplicateWarningBanner
            heading={t.stagedDocuments.matchesElsewhere(pending.file.name)}
            matches={pending.otherNoteMatches.map((m) => ({
              id: m.noteId,
              href: `/notes/${m.noteId}`,
              label: m.noteLabel,
              meta: m.fileName,
            }))}
            onAddAnyway={confirmPending}
            addAnywayLabel={t.stagedDocuments.attachAnyway}
            lang={lang}
          />
          <button
            type="button"
            onClick={cancelPending}
            className="w-fit text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            {t.stagedDocuments.dontAttachFile}
          </button>
        </>
      )}

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-white/55">{t.projectDocuments.addDocument}</p>
          <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
            <button
              type="button"
              onClick={() => setMode("file")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                mode === "file" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.projectDocuments.uploadFile}
            </button>
            <button
              type="button"
              onClick={() => setMode("link")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                mode === "link" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.projectDocuments.addLink}
            </button>
          </div>
        </div>

        {mode === "file" ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label={t.stagedDocuments.documentTypeAriaLabel}
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                disabled={checking}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
              >
                {documentTypes.map((type) => (
                  <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                    {catalogLabel(type, lang)}
                  </option>
                ))}
              </select>
              <input
                ref={fileInputRef}
                type="file"
                accept={DOCUMENT_FILE_ACCEPT}
                disabled={checking}
                onChange={handleFileChange}
                className="block flex-1 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
              />
              {checking && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />}
            </div>
            <p className="mt-2 text-xs text-white/35">{t.stagedDocuments.fileTypesHintNote(MAX_FILE_SIZE_MB)}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t.projectDocuments.documentTypeAriaLabel}
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
              >
                {documentTypes.map((type) => (
                  <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                    {catalogLabel(type, lang)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder={t.projectDocuments.linkNamePlaceholder}
                className="min-w-[140px] flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out placeholder:text-white/30 focus:border-accent/40"
              />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                className="min-w-[180px] flex-[2] rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out placeholder:text-white/30 focus:border-accent/40"
              />
              <button
                type="button"
                onClick={handleAddLink}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
              >
                {t.projectDocuments.addLink}
              </button>
            </div>
            <p className="text-xs text-white/35">{t.projectDocuments.linkHint}</p>
          </div>
        )}
      </div>

      {blockedMessage && <p className="text-xs text-rose-300">{blockedMessage}</p>}
    </div>
  );
}
