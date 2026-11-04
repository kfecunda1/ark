"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { ProductFields } from "@/components/contacts/product-fields";
import { StagedDocumentPicker, type StagedDocument } from "@/components/contacts/staged-document-picker";
import {
  addContactDocument,
  createContactWithId,
  updateContact,
  type ContactFormState,
} from "@/lib/actions/contacts";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import type { Contact, ContactProduct } from "@/lib/types";

interface ContactFormProps {
  mode: "create" | "edit";
  contact?: Contact;
  products?: ContactProduct[];
}

const initialState: ContactFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

type CreateStatus = "idle" | "creating" | "uploading";

export function ContactForm({ mode, contact, products = [] }: ContactFormProps) {
  const router = useRouter();

  // Edit mode keeps the existing server-action/useActionState flow — it
  // redirects to the contact on success, same as before.
  const editAction = mode === "edit" && contact ? updateContact.bind(null, contact.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  // Create mode needs to know the new contact's id before it can upload
  // any staged documents, so it can't rely on a redirecting action —
  // same pattern as components/projects/project-form.tsx: create the
  // contact, upload documents client-side, then navigate itself. A
  // document that fails to upload doesn't undo the contact — it's
  // already created by that point — it's just listed so it can be
  // retried from the contact page.
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  // Visible per-file upload progress, e.g. "2 of 3 (45%)" — the user
  // explicitly asked to see progress during the automatic post-create
  // upload, so this can't be a no-op progress callback.
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
    const result = await createContactWithId(formData);

    if (result.error || !result.id) {
      setCreateError(result.error ?? "Failed to create contact.");
      setCreateStatus("idle");
      return;
    }

    const contactId = result.id;
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
          if (!session) throw new Error("Session expired");
          const path = buildDocumentPath(doc.file.name);
          await uploadFileWithProgress("contact-documents", doc.file, path, session.access_token, (percent) =>
            setUploadProgress({ index: i + 1, total, percent })
          );
          const addResult = await addContactDocument(contactId, doc.type, path, doc.file.name, doc.hash);
          if (addResult.error) throw new Error(addResult.error);
        } catch {
          failedNames.push(doc.file.name);
        }
      }
      setUploadProgress(null);
    }

    const params = new URLSearchParams();
    if (failedNames.length > 0) params.set("failedDocs", failedNames.join(","));
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`/contacts/${contactId}${query}`);
  }

  const formProps =
    mode === "edit"
      ? { action: editFormAction, onSubmit: () => disableSubmitButton(submitButtonRef) }
      : { onSubmit: handleCreateSubmit };
  const error = mode === "edit" ? editState?.error : createError;
  const isPending = mode === "edit" ? isEditPending : createStatus !== "idle";

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <GlassCard interactive={false} className="flex flex-col gap-5 p-6">
        <div>
          <label className={labelClass} htmlFor="full_name">
            Full Name *
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            defaultValue={contact?.full_name ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="notes">
            About
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={contact?.notes ?? ""}
            placeholder='Free-text detail, e.g. "Prefers 30-day settlement, EU banks only"'
            className={fieldClass}
          />
        </div>
      </GlassCard>

      <GlassCard interactive={false} className="p-6">
        <p className={labelClass}>Products & Ratios</p>
        <ProductFields initialProducts={products} />
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>Documents</p>
          <StagedDocumentPicker documents={stagedDocuments} onChange={setStagedDocuments} />
        </GlassCard>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
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
                ? "Saving…"
                : "Save changes"
              : createStatus === "uploading"
                ? uploadProgress
                  ? `Uploading ${uploadProgress.index} of ${uploadProgress.total} (${uploadProgress.percent}%)…`
                  : "Uploading documents…"
                : createStatus === "creating"
                  ? "Creating…"
                  : "Create contact"}
          </button>
          <Link
            href={mode === "edit" && contact ? `/contacts/${contact.id}` : "/contacts"}
            className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Cancel
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
