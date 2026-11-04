"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Loader2, Trash2 } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { createClient } from "@/lib/supabase/client";
import { addContactDocument, deleteContactDocument, findContactDocumentsByHash } from "@/lib/actions/contacts";
import { buildDocumentPath, computeFileHash, uploadFileWithProgress } from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import type { ContactDocument, ContactDocumentType } from "@/lib/types";

const DOCUMENT_TYPES: ContactDocumentType[] = [
  "CIS",
  "POF",
  "DOA",
  "PGL",
  "JSON",
  "Proof of Fulfillment",
  "Supporting Documents",
  "Additional Documents",
];
const ACCEPTED_TYPES =
  ".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

interface ContactDocumentWithUrl extends ContactDocument {
  signedUrl: string | null;
}

interface ContactDocumentsProps {
  contactId: string;
  documents: ContactDocumentWithUrl[];
}

interface PendingUpload {
  file: File;
  type: ContactDocumentType;
  hash: string;
  otherContactMatches: { contactId: string; contactLabel: string; fileName: string }[];
}

export function ContactDocuments({ contactId, documents }: ContactDocumentsProps) {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<ContactDocumentType>("CIS");
  const [isChecking, setIsChecking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File, type: ContactDocumentType, hash: string) {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("contact-documents", file, path, session.access_token, setUploadProgress);

      const result = await addContactDocument(contactId, type, path, file.name, hash);
      if (result.error) {
        setError(result.error);
        // The file made it to storage but never got a DB row — don't leave
        // it behind as an orphan.
        await supabase.storage.from("contact-documents").remove([path]);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
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
    setIsChecking(true);

    try {
      const hash = await computeFileHash(file);
      const matches = await findContactDocumentsByHash(hash);

      const sameContact = matches.find((m) => m.contactId === contactId);
      if (sameContact) {
        setError(`This exact file is already attached as "${sameContact.fileName}".`);
        return;
      }

      const otherMatches = matches.filter((m) => m.contactId !== contactId);
      if (otherMatches.length > 0) {
        setPending({
          file,
          type: documentType,
          hash,
          otherContactMatches: otherMatches.map((m) => ({
            contactId: m.contactId,
            contactLabel: m.contactLabel,
            fileName: m.fileName,
          })),
        });
        return;
      }

      await uploadFile(file, documentType, hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this file for duplicates.");
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

  function handleDelete(documentId: string) {
    setError(null);
    setDeletingId(documentId);
    startTransition(async () => {
      try {
        const result = await deleteContactDocument(documentId);
        if (result.error) {
          setError(result.error);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setDeletingId(null);
        setConfirmingId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-sm text-white/35">No documents attached yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-white/35" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/85">{doc.file_name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40">
                    <ProjectDocumentTypeBadge type={doc.document_type} />
                    {formatDateTime(doc.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {doc.signedUrl ? (
                  <a
                    href={doc.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View
                  </a>
                ) : (
                  <span className="text-xs text-rose-300">No link</span>
                )}
                {confirmingId === doc.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      disabled={isPending && deletingId === doc.id}
                      className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {isPending && deletingId === doc.id ? "Deleting…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={isPending}
                      className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(doc.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <>
          <DuplicateWarningBanner
            heading={`"${pending.file.name}" matches a file already attached elsewhere:`}
            matches={pending.otherContactMatches.map((m) => ({
              id: m.contactId,
              href: `/contacts/${m.contactId}`,
              label: m.contactLabel,
              meta: m.fileName,
            }))}
            onAddAnyway={confirmPending}
            addAnywayLabel="Attach anyway"
          />
          <button
            type="button"
            onClick={cancelPending}
            className="w-fit text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Don&apos;t attach this file
          </button>
        </>
      )}

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-medium text-white/55">Add Document</p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Document type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as ContactDocumentType)}
            disabled={isUploading || isChecking}
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
          >
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type} className="bg-[#0a0e17]">
                {type}
              </option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            disabled={isUploading || isChecking}
            onChange={handleFileChange}
            className="block flex-1 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
          />
          {isChecking && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />}
        </div>
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
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
