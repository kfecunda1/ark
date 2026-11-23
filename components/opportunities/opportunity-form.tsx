"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { OpportunityProductsPicker } from "@/components/opportunities/opportunity-products-picker";
import { StagedDocumentPicker, type StagedOpportunityDocument } from "@/components/opportunities/staged-document-picker";
import {
  addOpportunityDocument,
  addOpportunityDocumentLink,
  createOpportunityWithId,
  updateOpportunity,
  type OpportunityFormState,
} from "@/lib/actions/opportunities";
import { quickCreatePerson } from "@/lib/actions/people";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, Opportunity, OpportunityProduct, Product } from "@/lib/types";

interface OpportunityFormProps {
  mode: "create" | "edit";
  opportunity?: Opportunity;
  opportunityProducts?: OpportunityProduct[];
  people: EntityOption[];
  products: Product[];
  // Create mode only — the staged Documents section below; edit mode
  // never renders it (an existing opportunity already has its own
  // Documents section on its detail page), so this is fine left
  // unfetched by that caller.
  documentTypes?: DocumentTypeRecord[];
  // Create mode only — prefilled when arriving from the Inbox's "+ New
  // opportunity" quick-create carry-over is handled there directly;
  // this is for any other future entry point that wants to seed a
  // title (none yet, but keeps the prop symmetric with defaultProducts
  // below rather than a special case just for one caller).
  defaultTitle?: string;
  lang?: Lang;
}

const initialState: OpportunityFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function OpportunityForm({
  mode,
  opportunity,
  opportunityProducts = [],
  people,
  products,
  documentTypes = [],
  defaultTitle,
  lang = "en",
}: OpportunityFormProps) {
  const router = useRouter();
  const t = getDictionary(lang);

  const editAction =
    mode === "edit" && opportunity ? updateOpportunity.bind(null, opportunity.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  const [productOptions, setProductOptions] = useState<string[]>(
    opportunityProducts.length > 0 ? opportunityProducts.map((p) => p.product) : []
  );
  const [stagedDocuments, setStagedDocuments] = useState<StagedOpportunityDocument[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<"idle" | "creating" | "uploading">("idle");
  // Visible per-file upload progress, e.g. "2 of 3 (45%)" — same
  // pattern as components/receivers/receiver-form.tsx's own create
  // flow, which this mirrors.
  const [uploadProgress, setUploadProgress] = useState<{ index: number; total: number; percent: number } | null>(
    null
  );
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    disableSubmitButton(submitButtonRef);
    e.preventDefault();
    setCreateError(null);
    setCreateStatus("creating");

    const formData = new FormData(e.currentTarget);
    const result = await createOpportunityWithId(formData);

    if (result.error || !result.id) {
      setCreateError(resolveError(result.error, lang) ?? t.opportunityForm.failedToCreate);
      setCreateStatus("idle");
      return;
    }

    const opportunityId = result.id;
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
            const addResult = await addOpportunityDocumentLink(opportunityId, doc.type, doc.name, doc.url);
            if (addResult.error) throw new Error(addResult.error);
          } else {
            if (!session) throw new Error("Session expired");
            const path = buildDocumentPath(doc.file.name);
            await uploadFileWithProgress("opportunity-documents", doc.file, path, session.access_token, (percent) =>
              setUploadProgress({ index: i + 1, total, percent })
            );
            const addResult = await addOpportunityDocument(opportunityId, doc.type, path, doc.file.name, doc.hash);
            if (addResult.error) throw new Error(addResult.error);
          }
        } catch {
          failedNames.push(doc.kind === "file" ? doc.file.name : doc.name);
        }
      }
      setUploadProgress(null);
    }

    const params = new URLSearchParams();
    if (failedNames.length > 0) params.set("failedDocs", failedNames.join(","));
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`/opportunities/${opportunityId}${query}`);
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
            {t.opportunityForm.titleLabel}
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={opportunity?.title ?? defaultTitle ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <EntityPicker
            name="intermediary_person_id"
            label={t.opportunityForm.intermediaryLabel}
            options={people}
            defaultId={opportunity?.intermediary_person_id}
            entityNoun={lang === "es" ? "contacto" : "contact"}
            entityNounPlural={lang === "es" ? "contactos" : "contacts"}
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

        <div>
          <label className={labelClass}>{t.opportunityForm.productsLabel}</label>
          <OpportunityProductsPicker products={products} value={productOptions} onChange={setProductOptions} lang={lang} />
          <p className="mt-1.5 text-xs text-white/35">{t.opportunityForm.productsHint}</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="notes_summary">
            {t.opportunityForm.summaryLabel}
          </label>
          <textarea
            id="notes_summary"
            name="notes_summary"
            rows={3}
            defaultValue={opportunity?.notes_summary ?? ""}
            placeholder={t.opportunityForm.summaryPlaceholder}
            className={fieldClass}
          />
        </div>
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>{t.opportunityForm.documentsLabel}</p>
          <StagedDocumentPicker documents={stagedDocuments} onChange={setStagedDocuments} documentTypes={documentTypes} lang={lang} />
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
                : t.opportunityForm.saveChanges
              : createStatus === "uploading"
                ? uploadProgress
                  ? t.opportunityForm.uploadingProgress(uploadProgress.index, uploadProgress.total, uploadProgress.percent)
                  : t.opportunityForm.uploadingDocuments
                : createStatus === "creating"
                  ? t.common.creating
                  : t.opportunityForm.createOpportunity}
          </button>
          <Link
            href={mode === "edit" && opportunity ? `/opportunities/${opportunity.id}` : "/opportunities"}
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
