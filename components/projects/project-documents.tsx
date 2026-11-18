"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Film, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { createClient } from "@/lib/supabase/client";
import {
  addProjectDocument,
  addProjectDocumentLink,
  deleteProjectDocument,
  ensureProjectTranche,
  findProjectDocumentsByHash,
  moveProjectDocument,
} from "@/lib/actions/projects";
import { virtualTrancheNumbers } from "@/lib/projects";
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
import type { DocumentTypeRecord, ProjectDocument, ProjectDocumentType, ProjectTranche } from "@/lib/types";

export interface ProjectDocumentWithUrl extends ProjectDocument {
  signedUrl: string | null;
}

// "all" renders every document, grouped into "General" / "Tranche 1" /
// "Tranche 2" / … sections with a "Move to…" picker per row, and its
// upload form offers a "For tranche" picker (default General). "tranche"
// is the compact panel embedded in one tranche row (components/projects/
// tranches-section.tsx): it only ever shows/adds documents for that one
// slot, so there's no grouping and no tranche picker — uploads go there
// automatically, creating the tranche's own row on the fly (via
// ensureProjectTranche) if it doesn't exist yet.
export type DocumentsScope = { kind: "all" } | { kind: "tranche"; number: number };

interface ProjectDocumentsProps {
  projectId: string;
  documents: ProjectDocumentWithUrl[];
  documentTypes: DocumentTypeRecord[];
  tranches: ProjectTranche[];
  scope: DocumentsScope;
}

interface PendingUpload {
  file: File;
  type: ProjectDocumentType;
  hash: string;
  trancheNumber: number | null;
  otherProjectMatches: { projectId: string; projectLabel: string; fileName: string }[];
}

const TRANCHE_SELECT_GENERAL = "general";

function trancheSelectValue(number: number | null): string {
  return number === null ? TRANCHE_SELECT_GENERAL : String(number);
}

function parseTrancheSelectValue(value: string): number | null {
  return value === TRANCHE_SELECT_GENERAL ? null : Number(value);
}

function DocumentIcon({ doc }: { doc: ProjectDocumentWithUrl }) {
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

export function ProjectDocuments({ projectId, documents, documentTypes, tranches, scope }: ProjectDocumentsProps) {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<ProjectDocumentType>(documentTypes[0]?.name ?? "");
  const [isChecking, setIsChecking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"file" | "link">("file");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<ProjectDocumentType>(documentTypes[0]?.name ?? "");
  const [isAddingLink, setIsAddingLink] = useState(false);

  const [uploadTranche, setUploadTranche] = useState(TRANCHE_SELECT_GENERAL);
  const [linkTranche, setLinkTranche] = useState(TRANCHE_SELECT_GENERAL);

  const trancheNumbers = useMemo(() => virtualTrancheNumbers(tranches), [tranches]);
  const trancheNumberById = useMemo(() => new Map(tranches.map((t) => [t.id, t.tranche_number])), [tranches]);

  const scopedDocuments = useMemo(() => {
    if (scope.kind === "all") return documents;
    const tranche = tranches.find((t) => t.tranche_number === scope.number);
    return tranche ? documents.filter((d) => d.tranche_id === tranche.id) : [];
  }, [documents, tranches, scope]);

  const groups = useMemo(() => {
    if (scope.kind === "tranche") {
      return [{ key: "scoped", label: null as string | null, documents: scopedDocuments }];
    }
    const byTranche = new Map<number, ProjectDocumentWithUrl[]>();
    const general: ProjectDocumentWithUrl[] = [];
    for (const doc of scopedDocuments) {
      const number = doc.tranche_id ? trancheNumberById.get(doc.tranche_id) : undefined;
      if (number == null) {
        general.push(doc);
      } else {
        byTranche.set(number, [...(byTranche.get(number) ?? []), doc]);
      }
    }
    const result: { key: string; label: string | null; documents: ProjectDocumentWithUrl[] }[] = [];
    if (general.length > 0) result.push({ key: "general", label: "General", documents: general });
    for (const number of [...byTranche.keys()].sort((a, b) => a - b)) {
      result.push({ key: `tranche-${number}`, label: `Tranche ${number}`, documents: byTranche.get(number)! });
    }
    return result;
  }, [scope, scopedDocuments, trancheNumberById]);

  async function resolveTrancheId(trancheNumber: number | null): Promise<{ id: string | null; error: string | null }> {
    if (trancheNumber === null) return { id: null, error: null };
    const existing = tranches.find((t) => t.tranche_number === trancheNumber);
    if (existing) return { id: existing.id, error: null };
    return ensureProjectTranche(projectId, trancheNumber);
  }

  async function uploadFile(file: File, type: ProjectDocumentType, hash: string, trancheNumber: number | null) {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const { id: trancheId, error: trancheError } = await resolveTrancheId(trancheNumber);
      if (trancheError) {
        setError(trancheError);
        return;
      }

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("project-documents", file, path, session.access_token, setUploadProgress);

      const result = await addProjectDocument(projectId, type, path, file.name, hash, trancheId);
      if (result.error) {
        setError(result.error);
        // The file made it to storage but never got a DB row — don't leave
        // it behind as an orphan.
        await supabase.storage.from("project-documents").remove([path]);
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

    const trancheNumber = scope.kind === "tranche" ? scope.number : parseTrancheSelectValue(uploadTranche);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`${file.name} is ${formatFileSizeMB(file.size)} — maximum is ${MAX_FILE_SIZE_MB} MB. Compress it, or save a link instead.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!isAllowedDocumentFile(file)) {
      setError(`${file.name} isn't a supported file type. Allowed: PDF, JPG, PNG, HEIC, MP4, MOV, DOC, DOCX.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsChecking(true);

    try {
      const hash = await computeFileHash(file);
      const matches = await findProjectDocumentsByHash(hash);

      const sameProject = matches.find((m) => m.projectId === projectId);
      if (sameProject) {
        setError(`This exact file is already attached as "${sameProject.fileName}".`);
        return;
      }

      const otherMatches = matches.filter((m) => m.projectId !== projectId);
      if (otherMatches.length > 0) {
        setPending({
          file,
          type: documentType,
          hash,
          trancheNumber,
          otherProjectMatches: otherMatches.map((m) => ({
            projectId: m.projectId,
            projectLabel: m.projectLabel,
            fileName: m.fileName,
          })),
        });
        return;
      }

      await uploadFile(file, documentType, hash, trancheNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this file for duplicates.");
    } finally {
      setIsChecking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function confirmPending() {
    if (!pending) return;
    const { file, type, hash, trancheNumber } = pending;
    setPending(null);
    uploadFile(file, type, hash, trancheNumber);
  }

  function cancelPending() {
    setPending(null);
  }

  async function handleAddLink() {
    setError(null);
    const name = linkName.trim();
    const url = linkUrl.trim();

    if (!name) {
      setError("Give the link a name.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setError("Link must be a full URL starting with http:// or https://.");
      return;
    }

    const trancheNumber = scope.kind === "tranche" ? scope.number : parseTrancheSelectValue(linkTranche);

    setIsAddingLink(true);
    try {
      const { id: trancheId, error: trancheError } = await resolveTrancheId(trancheNumber);
      if (trancheError) {
        setError(trancheError);
        return;
      }

      const result = await addProjectDocumentLink(projectId, linkType, name, url, trancheId);
      if (result.error) {
        setError(result.error);
      } else {
        setLinkName("");
        setLinkUrl("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsAddingLink(false);
    }
  }

  function handleDelete(documentId: string) {
    setError(null);
    setDeletingId(documentId);
    startTransition(async () => {
      try {
        const result = await deleteProjectDocument(documentId);
        if (result.error) {
          setError(result.error);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  async function handleMove(doc: ProjectDocumentWithUrl, value: string) {
    setError(null);
    setMovingId(doc.id);
    try {
      const trancheNumber = parseTrancheSelectValue(value);
      const { id: trancheId, error: trancheError } = await resolveTrancheId(trancheNumber);
      if (trancheError) {
        setError(trancheError);
        return;
      }
      const result = await moveProjectDocument(doc.id, trancheId);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setMovingId(null);
    }
  }

  function renderDocumentRow(doc: ProjectDocumentWithUrl) {
    const kind = doc.url ? null : getDocumentKind(doc.file_name);
    const isVideo = kind === "video" && doc.signedUrl;
    const isPlaying = playingId === doc.id;
    const viewHref = doc.url ?? doc.signedUrl;
    const viewLabel = doc.url ? "Open link" : kind === "heic" ? "Download" : "View";
    const currentTrancheNumber = doc.tranche_id ? trancheNumberById.get(doc.tranche_id) ?? null : null;

    return (
      <div
        key={doc.id}
        className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {isVideo ? (
              <button
                type="button"
                onClick={() => setPlayingId(isPlaying ? null : doc.id)}
                aria-label={isPlaying ? "Hide player" : "Play video"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/[0.06] text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.1] hover:text-white/90"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <DocumentIcon doc={doc} />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm text-white/85">{doc.file_name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40">
                <ProjectDocumentTypeBadge type={doc.document_type} />
                {formatDateTime(doc.created_at)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              aria-label="Move to"
              value={trancheSelectValue(currentTrancheNumber)}
              onChange={(e) => handleMove(doc, e.target.value)}
              disabled={movingId === doc.id}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
            >
              <option value={TRANCHE_SELECT_GENERAL} className="bg-[#0a0e17]">
                General
              </option>
              {trancheNumbers.map((n) => (
                <option key={n} value={n} className="bg-[#0a0e17]">
                  Tranche {n}
                </option>
              ))}
            </select>
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
              <span className="text-xs text-rose-300">No link</span>
            )}
            <button
              type="button"
              onClick={() => handleDelete(doc.id)}
              disabled={isPending && deletingId === doc.id}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isPending && deletingId === doc.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
        {isVideo && isPlaying && (
          <video controls autoPlay src={doc.signedUrl ?? undefined} className="max-h-72 w-full rounded-lg bg-black" />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {scopedDocuments.length === 0 ? (
        <p className="text-sm text-white/35">No documents attached yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              {group.label && (
                <h3 className="text-xs font-medium tracking-wide text-white/35 uppercase">{group.label}</h3>
              )}
              <div className="flex flex-col gap-2">{group.documents.map(renderDocumentRow)}</div>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <>
          <DuplicateWarningBanner
            heading={`"${pending.file.name}" matches a file already attached elsewhere:`}
            matches={pending.otherProjectMatches.map((m) => ({
              id: m.projectId,
              href: `/projects/${m.projectId}`,
              label: m.projectLabel,
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
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-white/55">Add Document</p>
          <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
            <button
              type="button"
              onClick={() => setMode("file")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                mode === "file" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setMode("link")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                mode === "link" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              Add link
            </button>
          </div>
        </div>

        {mode === "file" ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label="Document type"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as ProjectDocumentType)}
                disabled={isUploading || isChecking}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
              >
                {documentTypes.map((type) => (
                  <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                    {type.name}
                  </option>
                ))}
              </select>
              {scope.kind === "all" && (
                <select
                  aria-label="For tranche"
                  value={uploadTranche}
                  onChange={(e) => setUploadTranche(e.target.value)}
                  disabled={isUploading || isChecking}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
                >
                  <option value={TRANCHE_SELECT_GENERAL} className="bg-[#0a0e17]">
                    General
                  </option>
                  {trancheNumbers.map((n) => (
                    <option key={n} value={n} className="bg-[#0a0e17]">
                      Tranche {n}
                    </option>
                  ))}
                </select>
              )}
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
            <p className="mt-2 text-xs text-white/35">PDF, JPG, PNG, HEIC, MP4, MOV, DOC, DOCX — up to {MAX_FILE_SIZE_MB} MB.</p>
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
                aria-label="Document type"
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as ProjectDocumentType)}
                disabled={isAddingLink}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
              >
                {documentTypes.map((type) => (
                  <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                    {type.name}
                  </option>
                ))}
              </select>
              {scope.kind === "all" && (
                <select
                  aria-label="For tranche"
                  value={linkTranche}
                  onChange={(e) => setLinkTranche(e.target.value)}
                  disabled={isAddingLink}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
                >
                  <option value={TRANCHE_SELECT_GENERAL} className="bg-[#0a0e17]">
                    General
                  </option>
                  {trancheNumbers.map((n) => (
                    <option key={n} value={n} className="bg-[#0a0e17]">
                      Tranche {n}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Name"
                disabled={isAddingLink}
                className="min-w-[140px] flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out placeholder:text-white/30 focus:border-accent/40 disabled:opacity-50"
              />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                disabled={isAddingLink}
                className="min-w-[180px] flex-[2] rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out placeholder:text-white/30 focus:border-accent/40 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleAddLink}
                disabled={isAddingLink}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAddingLink ? "Adding…" : "Add link"}
              </button>
            </div>
            <p className="text-xs text-white/35">For large files kept elsewhere (e.g. Google Drive). Opens in a new tab.</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
