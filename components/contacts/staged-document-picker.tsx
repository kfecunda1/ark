"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { findContactDocumentsByHash } from "@/lib/actions/contacts";
import { computeFileHash } from "@/lib/storage";
import type { ContactDocumentType } from "@/lib/types";

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

export interface StagedDocument {
  id: string;
  type: ContactDocumentType;
  file: File;
  hash: string;
}

// A file picked but not yet staged, waiting on the user to resolve a
// cross-contact hash match before it's added to the list (or blocked
// outright if it matches a file already staged for this same contact).
interface PendingFile {
  file: File;
  type: ContactDocumentType;
  hash: string;
  otherContactMatches: { contactId: string; contactLabel: string; fileName: string }[];
}

interface StagedDocumentPickerProps {
  documents: StagedDocument[];
  onChange: (documents: StagedDocument[]) => void;
}

export function StagedDocumentPicker({ documents, onChange }: StagedDocumentPickerProps) {
  const [documentType, setDocumentType] = useState<ContactDocumentType>("CIS");
  const [checking, setChecking] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addDocument(file: File, type: ContactDocumentType, hash: string) {
    onChange([...documents, { id: crypto.randomUUID(), type, file, hash }]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setBlockedMessage(null);
    setPending(null);
    setChecking(true);

    try {
      const hash = await computeFileHash(file);

      // The new contact doesn't exist yet, so "the same record" means a
      // file already staged in this same picker — hard block, no DB
      // round trip needed.
      const sameBatch = documents.find((d) => d.hash === hash);
      if (sameBatch) {
        setBlockedMessage(`This file is already attached as "${sameBatch.file.name}".`);
        return;
      }

      // Nothing staged for this contact exists in the DB yet, so any
      // hash match found is necessarily on a different contact.
      const matches = await findContactDocumentsByHash(hash);
      if (matches.length === 0) {
        addDocument(file, documentType, hash);
        return;
      }

      setPending({
        file,
        type: documentType,
        hash,
        otherContactMatches: matches.map((m) => ({
          contactId: m.contactId,
          contactLabel: m.contactLabel,
          fileName: m.fileName,
        })),
      });
    } catch (err) {
      setBlockedMessage(err instanceof Error ? err.message : "Could not check this file for duplicates.");
    } finally {
      setChecking(false);
    }
  }

  function confirmPending() {
    if (!pending) return;
    addDocument(pending.file, pending.type, pending.hash);
    setPending(null);
  }

  function cancelPending() {
    setPending(null);
  }

  function removeDocument(id: string) {
    onChange(documents.filter((doc) => doc.id !== id));
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
                <FileText className="h-4 w-4 shrink-0 text-white/35" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/85">{doc.file.name}</p>
                  <div className="mt-0.5">
                    <ProjectDocumentTypeBadge type={doc.type} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeDocument(doc.id)}
                aria-label={`Remove ${doc.file.name}`}
                className="shrink-0 rounded-md p-1 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pending && (
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
      )}
      {pending && (
        <button
          type="button"
          onClick={cancelPending}
          className="w-fit text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Don&apos;t attach this file
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Document type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as ContactDocumentType)}
          disabled={checking}
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
          disabled={checking}
          onChange={handleFileChange}
          className="block flex-1 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
        />
        {checking && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />}
      </div>
      {blockedMessage && <p className="text-xs text-rose-300">{blockedMessage}</p>}
      <p className="text-xs text-white/35">
        Files are uploaded after the contact is created — pick as many as you need before saving.
      </p>
    </div>
  );
}
