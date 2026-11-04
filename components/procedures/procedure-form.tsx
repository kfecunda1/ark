"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { ContactPicker, type ContactOption } from "@/components/contacts/contact-picker";
import { WalletFields } from "@/components/procedures/wallet-fields";
import { DocumentFields } from "@/components/procedures/document-fields";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import {
  createProcedure,
  findDuplicateProcedures,
  updateProcedure,
  type DuplicateProcedureMatch,
  type ProcedureFormState,
} from "@/lib/actions/procedures";
import { disableSubmitButton } from "@/lib/forms";
import { SOURCES, SOURCE_LABELS, STATUSES, STATUS_LABELS } from "@/lib/procedures";
import { BUSINESS_LINES, BUSINESS_LINE_LABELS } from "@/lib/leads";
import type { Procedure, ProcedureDocument, ProcedureWallet } from "@/lib/types";

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

const initialState: ProcedureFormState = { error: null };

interface ProcedureFormProps {
  mode: "create" | "edit";
  procedure?: Procedure;
  contacts: ContactOption[];
  wallets?: ProcedureWallet[];
  documents?: ProcedureDocument[];
  walletLabelSuggestions?: string[];
}

type CreateStatus = "idle" | "creating";

export function ProcedureForm({
  mode,
  procedure,
  contacts,
  wallets = [],
  documents = [],
  walletLabelSuggestions = [],
}: ProcedureFormProps) {
  const router = useRouter();

  // Edit mode keeps the existing server-action/useActionState flow — it
  // redirects to the procedure on success, same as before.
  const editAction = mode === "edit" && procedure ? updateProcedure.bind(null, procedure.id) : async () => initialState;
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  // Create mode needs to run the duplicate check (and let the user
  // confirm "Add anyway") before actually saving, so it can't submit
  // straight through useActionState the way edit mode does — same
  // reason LeadForm's create path uses a custom onSubmit.
  const [documentsUploading, setDocumentsUploading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateProcedureMatch[] | null>(null);
  const lastFormDataRef = useRef<FormData | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    disableSubmitButton(submitButtonRef);
    e.preventDefault();
    setCreateError(null);
    setDuplicateMatches(null);
    const formData = new FormData(e.currentTarget);
    lastFormDataRef.current = formData;
    await proceedWithCreate(formData, false);
  }

  async function proceedWithCreate(formData: FormData, skipDuplicateCheck: boolean) {
    setCreateStatus("creating");

    if (!skipDuplicateCheck) {
      const title = formData.get("title")?.toString().trim();
      const rawContent = formData.get("raw_content")?.toString().trim();
      if (title && rawContent) {
        const matches = await findDuplicateProcedures({ title, rawContent });
        if (matches.length > 0) {
          setDuplicateMatches(matches);
          setCreateStatus("idle");
          return;
        }
      }
    }

    const result = await createProcedure(formData);
    if (result.error || !result.id) {
      setCreateError(result.error ?? "Failed to create procedure.");
      setCreateStatus("idle");
      return;
    }

    router.push("/procedures");
  }

  function handleAddAnyway() {
    setDuplicateMatches(null);
    if (lastFormDataRef.current) {
      proceedWithCreate(lastFormDataRef.current, true);
    }
  }

  const formProps =
    mode === "edit"
      ? { action: editFormAction, onSubmit: () => disableSubmitButton(submitButtonRef) }
      : { onSubmit: handleCreateSubmit };
  const error = mode === "edit" ? editState?.error : createError;
  const isPending = mode === "edit" ? isEditPending : createStatus !== "idle";

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <GlassCard interactive={false} className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="source">
            Source
          </label>
          <select
            id="source"
            name="source"
            defaultValue={procedure?.source ?? ""}
            className={fieldClass}
          >
            <option value="" className="bg-[#0a0e17]">
              Unspecified
            </option>
            {SOURCES.map((source) => (
              <option key={source} value={source} className="bg-[#0a0e17]">
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="area">
            Area
          </label>
          <select id="area" name="area" defaultValue={procedure?.area ?? ""} className={fieldClass}>
            <option value="" className="bg-[#0a0e17]">
              Unassigned
            </option>
            {BUSINESS_LINES.map((line) => (
              <option key={line} value={line} className="bg-[#0a0e17]">
                {BUSINESS_LINE_LABELS[line]}
              </option>
            ))}
          </select>
        </div>

        {mode === "edit" && (
          <div>
            <label className={labelClass} htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={procedure?.status ?? "unmatched"} className={fieldClass}>
              {STATUSES.map((status) => (
                <option key={status} value={status} className="bg-[#0a0e17]">
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <ContactPicker
            name="contact_id"
            label="Contact"
            contacts={contacts}
            defaultContactId={procedure?.contact_id}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="title">
            Title *
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={procedure?.title ?? ""}
            placeholder="Short title for this procedure"
            className={fieldClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="raw_content">
            Raw Content *
          </label>
          <textarea
            id="raw_content"
            name="raw_content"
            required
            rows={8}
            defaultValue={procedure?.raw_content ?? ""}
            placeholder="Paste the WhatsApp/Telegram message, or describe the offer/request…"
            className={fieldClass}
          />
        </div>
      </GlassCard>

      <GlassCard interactive={false} className="p-6">
        <p className={labelClass}>Documents</p>
        <DocumentFields procedureId={procedure?.id} initialDocuments={documents} onUploadingChange={setDocumentsUploading} />
      </GlassCard>

      <GlassCard interactive={false} className="p-6">
        <p className={labelClass}>Seller Wallet(s)</p>
        <WalletFields initialWallets={wallets} labelSuggestions={walletLabelSuggestions} />
      </GlassCard>

      {mode === "create" && duplicateMatches && duplicateMatches.length > 0 && (
        <DuplicateWarningBanner
          heading="A procedure with this same title or content already exists:"
          matches={duplicateMatches.map((m) => ({
            id: m.id,
            href: `/procedures/${m.id}`,
            label: m.label,
            meta: m.meta,
          }))}
          onAddAnyway={handleAddAnyway}
        />
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          ref={submitButtonRef}
          type="submit"
          disabled={isPending || documentsUploading}
          className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? mode === "edit"
              ? "Saving…"
              : "Creating…"
            : documentsUploading
              ? "Uploading…"
              : mode === "edit"
                ? "Save changes"
                : "Create procedure"}
        </button>
        <Link
          href={mode === "edit" && procedure ? `/procedures/${procedure.id}` : "/procedures"}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
