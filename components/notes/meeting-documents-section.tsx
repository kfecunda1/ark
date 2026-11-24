"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, FileText, Film, Loader2, Pencil, Trash2, X } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { createClient } from "@/lib/supabase/client";
import {
  addNoteDocument,
  addNoteDocumentLink,
  deleteNoteDocument,
  findNoteDocumentsByHash,
  renameNoteDocument,
} from "@/lib/actions/meetings";
import {
  DOCUMENT_FILE_ACCEPT,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  buildDocumentPath,
  computeFileHash,
  formatFileSizeMB,
  getDocumentKind,
  isAllowedDocumentFile,
  uploadFileWithProgress,
} from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import { catalogLabel, getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, NoteDocument, NoteDocumentType } from "@/lib/types";

export interface NoteDocumentWithUrl extends NoteDocument {
  signedUrl: string | null;
}

interface MeetingDocumentsSectionProps {
  meetingId: string;
  documents: NoteDocumentWithUrl[];
  documentTypes: DocumentTypeRecord[];
  lang?: Lang;
}

interface PendingUpload {
  file: File;
  type: NoteDocumentType;
  hash: string;
  otherMeetingMatches: { noteId: string; noteLabel: string; fileName: string }[];
}

function DocumentIcon({ doc }: { doc: NoteDocumentWithUrl }) {
  if (doc.url) return <ExternalLink className="h-4 w-4 shrink-0 text-white/35" />;
  const kind = getDocumentKind(doc.file_name);
  if (kind === "image" && doc.signedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={doc.signedUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
    );
  }
  if (kind === "video") return <Film className="h-4 w-4 shrink-0 text-white/35" />;
  return <FileText className="h-4 w-4 shrink-0 text-white/35" />;
}

const linkFieldClass =
  "rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out placeholder:text-white/30 focus:border-accent/40 disabled:opacity-50";

// Add/rename/delete, same shape as components/opportunities/
// opportunity-documents.tsx — a meeting's attachments are no longer
// create-time-only (this follow-up round), so this is now the
// full manager, used on both the meeting's detail page and its edit
// page. Deleting asks for confirmation first, unlike the Opportunity/
// Project document managers — this meeting round asked for it
// specifically.
export function MeetingDocumentsSection({ meetingId, documents, documentTypes, lang = "en" }: MeetingDocumentsSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [documentType, setDocumentType] = useState<NoteDocumentType>(documentTypes[0]?.name || "");
  const [isChecking, setIsChecking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"file" | "link">("file");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<NoteDocumentType>(documentTypes[0]?.name ?? "");
  const [isAddingLink, setIsAddingLink] = useState(false);

  async function uploadFile(file: File, type: NoteDocumentType, hash: string) {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error(t.projectDocuments.sessionExpired);
      }

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("note-documents", file, path, session.access_token, setUploadProgress);

      const result = await addNoteDocument(meetingId, type, path, file.name, hash);
      if (result.error) {
        setError(resolveError(result.error, lang));
        await supabase.storage.from("note-documents").remove([path]);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projectDocuments.uploadFailed);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setPending(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(t.projectDocuments.fileTooLarge(file.name, formatFileSizeMB(file.size), MAX_FILE_SIZE_MB));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!isAllowedDocumentFile(file)) {
      setError(t.projectDocuments.unsupportedFileType(file.name));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsChecking(true);

    try {
      const hash = await computeFileHash(file);
      const matches = await findNoteDocumentsByHash(hash);

      const sameMeeting = matches.find((m) => m.noteId === meetingId);
      if (sameMeeting) {
        setError(t.meetingDetail.duplicateInThisMeeting(sameMeeting.fileName));
        return;
      }

      const otherMatches = matches.filter((m) => m.noteId !== meetingId);
      if (otherMatches.length > 0) {
        setPending({
          file,
          type: documentType,
          hash,
          otherMeetingMatches: otherMatches.map((m) => ({ noteId: m.noteId, noteLabel: m.noteLabel, fileName: m.fileName })),
        });
        return;
      }

      await uploadFile(file, documentType, hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projectDocuments.couldNotCheckDuplicates);
    } finally {
      setIsChecking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function confirmPending() {
    if (!pending) return;
    const { file, type, hash } = pending;
    setPending(null);
    uploadFile(file, type, hash);
  }

  function cancelPending() {
    setPending(null);
  }

  async function handleAddLink() {
    setError(null);
    const name = linkName.trim();
    const url = linkUrl.trim();

    if (!name) {
      setError(t.projectDocuments.giveLinkName);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setError(t.projectDocuments.linkMustBeUrl);
      return;
    }

    setIsAddingLink(true);
    try {
      const result = await addNoteDocumentLink(meetingId, linkType, name, url);
      if (result.error) {
        setError(resolveError(result.error, lang));
      } else {
        setLinkName("");
        setLinkUrl("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsAddingLink(false);
    }
  }

  function handleDelete(documentId: string) {
    setError(null);
    setDeletingId(documentId);
    startTransition(async () => {
      try {
        const result = await deleteNoteDocument(documentId);
        if (result.error) {
          setError(resolveError(result.error, lang));
        } else {
          setConfirmingDeleteId(null);
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setDeletingId(null);
      }
    });
  }

  function startRename(doc: NoteDocumentWithUrl) {
    setError(null);
    setRenameValue(doc.file_name);
    setRenamingId(doc.id);
  }

  async function handleRenameSave(documentId: string) {
    setError(null);
    setIsRenaming(true);
    try {
      const result = await renameNoteDocument(documentId, renameValue);
      if (result.error) {
        setError(resolveError(result.error, lang));
      } else {
        setRenamingId(null);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsRenaming(false);
    }
  }

  function renderDocumentRow(doc: NoteDocumentWithUrl) {
    const kind = doc.url ? null : getDocumentKind(doc.file_name);
    const viewHref = doc.url ?? doc.signedUrl;
    const viewLabel = doc.url ? t.projectDocuments.openLink : kind === "heic" ? t.projectDocuments.download : t.projectDocuments.view;
    const docTypeRecord = documentTypes.find((dt) => dt.name === doc.document_type);
    const docTypeLabel = docTypeRecord ? catalogLabel(docTypeRecord, lang) : doc.document_type;
    const isDeleting = isPending && deletingId === doc.id;

    return (
      <div key={doc.id} className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <DocumentIcon doc={doc} />
            <div className="min-w-0">
              {renamingId === doc.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  disabled={isRenaming}
                  className="w-full min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
                />
              ) : (
                <p className="truncate text-sm text-white/85">{doc.file_name}</p>
              )}
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40">
                <ProjectDocumentTypeBadge type={doc.document_type} label={docTypeLabel} />
                {formatDateTime(doc.created_at, lang)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap shrink-0 items-center gap-2">
            {viewHref ? (
              <a
                href={viewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {viewLabel}
              </a>
            ) : (
              <span className="text-xs text-rose-300">{t.projectDocuments.noLink}</span>
            )}
            {renamingId === doc.id ? (
              <>
                <button
                  type="button"
                  onClick={() => handleRenameSave(doc.id)}
                  disabled={isRenaming}
                  aria-label={t.projectDocuments.saveName}
                  className="inline-flex items-center rounded-md bg-accent px-2 py-1.5 text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  disabled={isRenaming}
                  aria-label={t.projectDocuments.cancelRename}
                  className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : confirmingDeleteId === doc.id ? (
              <>
                <span className="text-xs text-rose-300">{t.meetingDetail.deleteDocumentConfirm}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  disabled={isDeleting}
                  className="rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? t.common.deleting : t.common.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDeleteId(null)}
                  disabled={isDeleting}
                  className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                >
                  {t.common.cancel}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startRename(doc)}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t.common.rename}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDeleteId(doc.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.common.delete}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-sm text-white/35">{t.meetingDetail.noAttachments}</p>
      ) : (
        <div className="flex flex-col gap-2">{documents.map(renderDocumentRow)}</div>
      )}

      {pending && (
        <>
          <DuplicateWarningBanner
            heading={t.projectDocuments.matchesElsewhereHeading(pending.file.name)}
            matches={pending.otherMeetingMatches.map((m) => ({
              id: m.noteId,
              href: `/notes/${m.noteId}`,
              label: m.noteLabel,
              meta: m.fileName,
            }))}
            onAddAnyway={confirmPending}
            addAnywayLabel={t.projectDocuments.attachAnyway}
            lang={lang}
          />
          <button
            type="button"
            onClick={cancelPending}
            className="w-fit text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            {t.projectDocuments.dontAttach}
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
                aria-label={t.projectDocuments.documentTypeAriaLabel}
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                disabled={isUploading || isChecking}
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
                disabled={isUploading || isChecking}
                onChange={handleFileChange}
                className="block flex-1 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
              />
              {isChecking && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />}
            </div>
            <p className="mt-2 text-xs text-white/35">{t.projectDocuments.fileSizeHint(MAX_FILE_SIZE_MB)}</p>
            {isUploading && (
              <div className="mt-2 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-150 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-xs text-white/40">{uploadProgress}%</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t.projectDocuments.documentTypeAriaLabel}
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                disabled={isAddingLink}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
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
                disabled={isAddingLink}
                className={`min-w-[140px] flex-1 ${linkFieldClass}`}
              />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                disabled={isAddingLink}
                className={`min-w-[180px] flex-[2] ${linkFieldClass}`}
              />
              <button
                type="button"
                onClick={handleAddLink}
                disabled={isAddingLink}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAddingLink ? t.projectDocuments.adding : t.projectDocuments.addLink}
              </button>
            </div>
            <p className="text-xs text-white/35">{t.projectDocuments.linkHint}</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
