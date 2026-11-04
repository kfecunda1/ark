"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Plus, X } from "lucide-react";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { createClient } from "@/lib/supabase/client";
import { findProcedureDocumentsByHash } from "@/lib/actions/procedures";
import { buildDocumentPath, computeFileHash, uploadFileWithProgress } from "@/lib/storage";
import type { ProcedureDocument } from "@/lib/types";

const ACCEPTED_TYPES =
  ".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

interface DocumentRow {
  key: string;
  id: string | null;
  path: string;
  fileName: string;
  hash: string;
  status: "uploading" | "uploaded" | "error";
  progress: number;
  error?: string;
}

interface PendingFile {
  file: File;
  hash: string;
  otherProcedureMatches: { procedureId: string; procedureLabel: string; fileName: string }[];
}

interface DocumentFieldsProps {
  // Undefined in create mode, where nothing exists in the DB yet to be
  // "the same record" — every cross-record hash match found is
  // necessarily on a different procedure.
  procedureId?: string;
  initialDocuments?: ProcedureDocument[];
  onUploadingChange?: (uploading: boolean) => void;
}

export function DocumentFields({ procedureId, initialDocuments = [], onUploadingChange }: DocumentFieldsProps) {
  const [rows, setRows] = useState<DocumentRow[]>(
    initialDocuments.map((d) => ({
      key: d.id,
      id: d.id,
      path: d.file_path,
      fileName: d.file_name,
      hash: d.file_hash ?? "",
      status: "uploaded" as const,
      progress: 100,
    }))
  );
  const [isChecking, setIsChecking] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);

  // Removing a row that's still uploading can't be undone mid-flight (the
  // XHR in uploadFileWithProgress isn't cancellable here) — this tracks
  // those keys so startUpload can delete the file it just finished
  // uploading instead of silently leaving it behind in storage.
  const abandonedKeysRef = useRef<Set<string>>(new Set());

  // Notify the parent form as a proper effect (not from inside a setRows
  // updater) — calling another component's setState synchronously during
  // this component's state update is a React error, not just a warning.
  useEffect(() => {
    onUploadingChange?.(rows.some((r) => r.status === "uploading"));
  }, [rows, onUploadingChange]);

  async function startUpload(file: File, hash: string) {
    const key = crypto.randomUUID();
    setRows((prev) => [
      ...prev,
      { key, id: null, path: "", fileName: file.name, hash, status: "uploading", progress: 0 },
    ]);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("procedure-documents", file, path, session.access_token, (percent) => {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, progress: percent } : r)));
      });

      if (abandonedKeysRef.current.has(key)) {
        // Removed while the upload was still in flight — the row's already
        // gone from state, so just clean up the file that just landed.
        abandonedKeysRef.current.delete(key);
        await supabase.storage.from("procedure-documents").remove([path]);
        return;
      }

      setRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, path, status: "uploaded", progress: 100 } : r))
      );
    } catch (err) {
      abandonedKeysRef.current.delete(key);
      setRows((prev) =>
        prev.map((r) =>
          r.key === key
            ? { ...r, status: "error", error: err instanceof Error ? err.message : "Upload failed." }
            : r
        )
      );
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setBlockedMessage(null);
    setPending(null);
    setIsChecking(true);

    try {
      const hash = await computeFileHash(file);

      // "The same record" also covers a row already in this form — an
      // already-uploaded document from editing this procedure, or one
      // just added earlier in this same session — not only what's saved
      // under procedureId in the DB (which doesn't exist yet in create
      // mode).
      const sameFormRow = rows.find((r) => r.status === "uploaded" && r.hash === hash);
      if (sameFormRow) {
        setBlockedMessage(`This file is already attached as "${sameFormRow.fileName}".`);
        return;
      }

      const matches = await findProcedureDocumentsByHash(hash);
      const sameProcedureMatch = procedureId ? matches.find((m) => m.procedureId === procedureId) : undefined;
      if (sameProcedureMatch) {
        setBlockedMessage(`This exact file is already attached as "${sameProcedureMatch.fileName}".`);
        return;
      }

      const otherMatches = matches.filter((m) => m.procedureId !== procedureId);
      if (otherMatches.length > 0) {
        setPending({
          file,
          hash,
          otherProcedureMatches: otherMatches.map((m) => ({
            procedureId: m.procedureId,
            procedureLabel: m.procedureLabel,
            fileName: m.fileName,
          })),
        });
        return;
      }

      await startUpload(file, hash);
    } catch (err) {
      setBlockedMessage(err instanceof Error ? err.message : "Could not check this file for duplicates.");
    } finally {
      setIsChecking(false);
    }
  }

  function confirmPending() {
    if (!pending) return;
    const { file, hash } = pending;
    setPending(null);
    startUpload(file, hash);
  }

  function cancelPending() {
    setPending(null);
  }

  function removeRow(key: string) {
    const row = rows.find((r) => r.key === key);
    setRows((prev) => prev.filter((r) => r.key !== key));

    // A row with an id is an already-saved document — leave its storage
    // object alone here. Removing it from the form is provisional until
    // the form is actually submitted, at which point syncProcedureDocuments
    // (server-side) deletes both the row and the file together. Only a
    // brand-new upload (no id yet) has no such save step to fall back on,
    // so it needs cleaning up right away or it's orphaned for good.
    if (row?.id) return;

    if (row?.status === "uploading") {
      // Can't cancel the upload itself — flag it so startUpload deletes
      // the file once it lands instead of leaving it orphaned.
      abandonedKeysRef.current.add(key);
    } else if (row?.status === "uploaded" && row.path) {
      const supabase = createClient();
      supabase.storage
        .from("procedure-documents")
        .remove([row.path])
        .then(({ error }) => {
          if (error) console.error("[DocumentFields] failed to remove abandoned upload:", error.message);
        });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
            >
              <input type="hidden" name="document_id" value={row.id ?? ""} />
              <input type="hidden" name="document_path" value={row.status === "uploaded" ? row.path : ""} />
              <input type="hidden" name="document_name" value={row.fileName} />
              <input type="hidden" name="document_hash" value={row.status === "uploaded" ? row.hash : ""} />

              {row.status === "uploading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" />}
              {row.status === "uploaded" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
              {row.status === "error" && <FileText className="h-4 w-4 shrink-0 text-rose-400" />}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white/80">{row.fileName}</p>
                {row.status === "uploading" && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-150 ease-out"
                      style={{ width: `${row.progress}%` }}
                    />
                  </div>
                )}
                {row.status === "error" && <p className="text-xs text-rose-300">{row.error}</p>}
              </div>

              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove ${row.fileName}`}
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
            heading={`"${pending.file.name}" matches a file already attached elsewhere:`}
            matches={pending.otherProcedureMatches.map((m) => ({
              id: m.procedureId,
              href: `/procedures/${m.procedureId}`,
              label: m.procedureLabel,
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

      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white">
        {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add Document
        <input
          type="file"
          accept={ACCEPTED_TYPES}
          disabled={isChecking}
          onChange={handleFileChange}
          className="hidden"
        />
      </label>
      {blockedMessage && <p className="text-xs text-rose-300">{blockedMessage}</p>}
    </div>
  );
}
