"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Download, Eye, EyeOff, Pencil, Trash2, Upload } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { TemplateForm } from "@/components/templates/template-form";
import { addTemplateVersion, deleteTemplate, setTemplateActive } from "@/lib/actions/templates";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  TEMPLATE_FILE_ACCEPT,
  buildDocumentPath,
  computeFileHash,
  contentTypeForFile,
  formatFileSizeMB,
  isAllowedTemplateFile,
  uploadFileWithProgress,
} from "@/lib/storage";
import { formatDateOnlyFromTimestamp } from "@/lib/format";
import { catalogLabel, getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, Product } from "@/lib/types";
import type { TemplateCardData } from "@/components/templates/templates-browser";

interface TemplateCardProps {
  template: TemplateCardData;
  products: Product[];
  documentTypes: DocumentTypeRecord[];
  isAdmin: boolean;
  highlighted: boolean;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

function DownloadLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <span className="text-xs text-rose-300">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
    >
      <Download className="h-3.5 w-3.5" />
      {children}
    </a>
  );
}

export function TemplateCard({ template, products, documentTypes, isAdmin, highlighted, lang = "en" }: TemplateCardProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLInputElement>(null);

  const current = template.versions[0] ?? null;
  const documentTypeRecord = documentTypes.find((dtype) => dtype.name === template.documentType);
  const documentTypeLabel = documentTypeRecord ? catalogLabel(documentTypeRecord, lang) : template.documentType;

  function handleHideShow() {
    setError(null);
    startTransition(async () => {
      const result = await setTemplateActive(template.id, !template.active);
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTemplate(template.id);
      if (result.error) {
        setError(resolveError(result.error, lang));
        setConfirmingDelete(false);
        return;
      }
      router.refresh();
    });
  }

  async function handleUploadVersion() {
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError(t.templateForm.fileRequired);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(t.projectDocuments.fileTooLarge(file.name, formatFileSizeMB(file.size), MAX_FILE_SIZE_MB));
      return;
    }
    if (!isAllowedTemplateFile(file)) {
      setError(t.projectDocuments.unsupportedFileType(file.name));
      return;
    }

    setIsUploadingFile(true);
    setUploadProgress(0);
    try {
      const hash = await computeFileHash(file);
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error(t.projectDocuments.sessionExpired);

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("templates", file, path, session.access_token, setUploadProgress);

      const notes = notesInputRef.current?.value.trim() || null;
      const result = await addTemplateVersion(template.id, path, file.name, contentTypeForFile(file), file.size, hash, notes);
      if (result.error) {
        await supabase.storage.from("templates").remove([path]);
        setError(resolveError(result.error, lang));
        return;
      }

      setUploadingVersion(false);
      setVersionsOpen(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.templateForm.failedToUploadVersion);
    } finally {
      setIsUploadingFile(false);
      setUploadProgress(0);
    }
  }

  if (editing) {
    return (
      <TemplateForm
        mode="edit"
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          document_type: template.documentType,
        }}
        selectedProducts={template.products}
        products={products}
        documentTypes={documentTypes}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
        lang={lang}
      />
    );
  }

  return (
    <GlassCard
      interactive={false}
      className={`p-5 transition-shadow duration-300 ${highlighted ? "ring-2 ring-accent/50" : ""} ${!template.active ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white/90">{template.name}</h3>
            {documentTypeRecord && <ProjectDocumentTypeBadge type={template.documentType ?? ""} label={documentTypeLabel ?? undefined} />}
            {!template.active && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-white/50">
                {t.common.hidden}
              </span>
            )}
          </div>
          {template.description && <p className="mt-1.5 text-sm text-white/55">{template.description}</p>}
          {template.products.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {template.products.map((p) => (
                <span key={p} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/60">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        {current && (
          <DownloadLink href={current.signedUrl}>{t.templates.downloadButton}</DownloadLink>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/40">
        {current ? (
          <span>
            {t.templates.versionSummary(current.versionNumber, formatDateOnlyFromTimestamp(current.uploadedAt, lang), current.uploadedByName)}
          </span>
        ) : (
          <span className="text-rose-300">{t.templates.noVersionYet}</span>
        )}
        {template.versions.length > 0 && (
          <button
            type="button"
            onClick={() => setVersionsOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-white/50 hover:text-white/80"
          >
            {versionsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t.templates.versionsCount(template.versions.length)}
          </button>
        )}
      </div>

      {versionsOpen && (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          {template.versions.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-white/70">
                  {t.templates.versionLabel(v.versionNumber)} · {formatDateOnlyFromTimestamp(v.uploadedAt, lang)} ·{" "}
                  {v.uploadedByName}
                </p>
                {v.notes && <p className="mt-0.5 text-xs text-white/40">{v.notes}</p>}
              </div>
              <DownloadLink href={v.signedUrl}>{t.projectDocuments.download}</DownloadLink>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          {uploadingVersion ? (
            <div className="flex w-full flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={TEMPLATE_FILE_ACCEPT}
                  disabled={isUploadingFile}
                  className="block flex-1 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
                />
              </div>
              <input
                ref={notesInputRef}
                placeholder={t.templateForm.versionNotesPlaceholder}
                disabled={isUploadingFile}
                className={fieldClass}
              />
              {isUploadingFile && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full bg-accent transition-all duration-150 ease-out" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <span className="text-xs text-white/40">{uploadProgress}%</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleUploadVersion}
                  disabled={isUploadingFile}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isUploadingFile ? t.templateForm.uploadingVersion : t.common.save}
                </button>
                <button
                  type="button"
                  onClick={() => setUploadingVersion(false)}
                  disabled={isUploadingFile}
                  className="text-xs font-medium text-white/50 hover:text-white/80"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-rose-300">{t.templates.deleteConfirm}</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? t.common.deleting : t.common.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={isPending}
                className="text-xs font-medium text-white/50 hover:text-white/80"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setUploadingVersion(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
              >
                <Upload className="h-3.5 w-3.5" />
                {t.templates.uploadNewVersion}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t.common.edit}
              </button>
              <button
                type="button"
                onClick={handleHideShow}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {template.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {template.active ? t.common.hide : t.common.show}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.common.delete}
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </GlassCard>
  );
}
