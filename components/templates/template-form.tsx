"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addTemplateVersion,
  createTemplateWithId,
  deleteTemplate,
  updateTemplate,
  type TemplateFormState,
} from "@/lib/actions/templates";
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
import { disableSubmitButton } from "@/lib/forms";
import { catalogLabel, getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, Product, Template } from "@/lib/types";

interface TemplateFormProps {
  mode: "create" | "edit";
  // Only what the form itself reads — the card passing this in doesn't
  // need to fabricate created_at/updated_at/created_by just to satisfy
  // a full Template.
  template?: Pick<Template, "id" | "name" | "description" | "document_type">;
  selectedProducts?: string[];
  products: Product[];
  documentTypes: DocumentTypeRecord[];
  onDone: () => void;
  onCancel: () => void;
  lang?: Lang;
}

const initialState: TemplateFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function TemplateForm({
  mode,
  template,
  selectedProducts = [],
  products,
  documentTypes,
  onDone,
  onCancel,
  lang = "en",
}: TemplateFormProps) {
  const router = useRouter();
  const t = getDictionary(lang);

  const editAction = mode === "edit" && template ? updateTemplate.bind(null, template.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);
  const editSubmittedRef = useRef(false);

  useEffect(() => {
    if (mode !== "edit" || isEditPending || !editSubmittedRef.current) return;
    editSubmittedRef.current = false;
    if (!editState.error) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditPending, editState]);

  const [products_, setProducts] = useState<string[]>(selectedProducts);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<"idle" | "creating" | "uploading">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleProduct(name: string) {
    setProducts((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    disableSubmitButton(submitButtonRef);
    e.preventDefault();
    setCreateError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setCreateError(t.templateForm.fileRequired);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setCreateError(t.projectDocuments.fileTooLarge(file.name, formatFileSizeMB(file.size), MAX_FILE_SIZE_MB));
      return;
    }
    if (!isAllowedTemplateFile(file)) {
      setCreateError(t.projectDocuments.unsupportedFileType(file.name));
      return;
    }

    setCreateStatus("creating");
    const formData = new FormData(e.currentTarget);
    const notes = formData.get("version_notes")?.toString().trim() || null;

    const result = await createTemplateWithId(formData);
    if (result.error || !result.id) {
      setCreateError(resolveError(result.error, lang) ?? t.templateForm.failedToCreate);
      setCreateStatus("idle");
      return;
    }

    const templateId = result.id;

    try {
      const hash = await computeFileHash(file);
      setCreateStatus("uploading");

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error(t.projectDocuments.sessionExpired);

      const path = buildDocumentPath(file.name);
      await uploadFileWithProgress("templates", file, path, session.access_token, setUploadProgress);

      const versionResult = await addTemplateVersion(templateId, path, file.name, contentTypeForFile(file), file.size, hash, notes);
      if (versionResult.error) {
        await supabase.storage.from("templates").remove([path]);
        throw new Error(resolveError(versionResult.error, lang) ?? t.templateForm.failedToUploadVersion);
      }

      router.refresh();
      onDone();
    } catch (err) {
      // The template is useless with no version at all — roll it back
      // rather than leaving a fileless row behind (see lib/actions/
      // templates.ts's own createTemplateWithId comment).
      await deleteTemplate(templateId);
      setCreateError(err instanceof Error ? err.message : t.templateForm.failedToUploadVersion);
      setCreateStatus("idle");
    }
  }

  const formProps =
    mode === "edit"
      ? {
          action: editFormAction,
          onSubmit: () => {
            editSubmittedRef.current = true;
            disableSubmitButton(submitButtonRef);
          },
        }
      : { onSubmit: handleCreateSubmit };
  const error = mode === "edit" ? resolveError(editState?.error ?? null, lang) : createError;
  const isPending = mode === "edit" ? isEditPending : createStatus !== "idle";

  return (
    <form {...formProps} className="flex flex-col gap-4 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
      <div>
        <label className={labelClass} htmlFor="name">
          {t.templateForm.nameLabel}
        </label>
        <input id="name" name="name" required defaultValue={template?.name ?? ""} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="description">
          {t.templateForm.descriptionLabel}
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={template?.description ?? ""}
          placeholder={t.templateForm.descriptionPlaceholder}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="document_type">
          {t.templateForm.documentTypeLabel}
        </label>
        <select id="document_type" name="document_type" defaultValue={template?.document_type ?? ""} className={fieldClass}>
          <option value="" className="bg-[#0a0e17]">
            {t.templateForm.noDocumentType}
          </option>
          {documentTypes
            .filter((dtype) => dtype.active || dtype.name === template?.document_type)
            .map((dtype) => (
              <option key={dtype.id} value={dtype.name} className="bg-[#0a0e17]">
                {catalogLabel(dtype, lang)}
              </option>
            ))}
        </select>
      </div>

      <div>
        <p className={labelClass}>{t.templateForm.productsLabel}</p>
        <div className="flex flex-wrap gap-2">
          {products
            .filter((p) => p.active || products_.includes(p.name))
            .map((product) => {
              const checked = products_.includes(product.name);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => toggleProduct(product.name)}
                  aria-pressed={checked}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
                    checked
                      ? "border-accent/40 bg-accent/15 text-accent-soft"
                      : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
                  }`}
                >
                  {product.name}
                </button>
              );
            })}
        </div>
        {products_.map((p) => (
          <input key={p} type="hidden" name="products" value={p} />
        ))}
      </div>

      {mode === "create" && (
        <>
          <div>
            <label className={labelClass} htmlFor="file">
              {t.templateForm.fileLabel}
            </label>
            <input
              ref={fileInputRef}
              id="file"
              type="file"
              accept={TEMPLATE_FILE_ACCEPT}
              disabled={isPending}
              className="block w-full text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/[0.12] disabled:opacity-50"
            />
            <p className="mt-2 text-xs text-white/35">{t.templateForm.fileHint(MAX_FILE_SIZE_MB)}</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="version_notes">
              {t.templateForm.versionNotesLabel}
            </label>
            <input
              id="version_notes"
              name="version_notes"
              placeholder={t.templateForm.versionNotesPlaceholder}
              className={fieldClass}
            />
          </div>

          {createStatus === "uploading" && (
            <div className="flex items-center gap-2">
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
      )}

      {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          ref={submitButtonRef}
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === "edit"
            ? isEditPending
              ? t.common.saving
              : t.common.save
            : createStatus === "uploading"
              ? t.templateForm.uploadingVersion
              : createStatus === "creating"
                ? t.common.creating
                : t.templateForm.createTemplate}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
