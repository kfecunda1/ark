"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { ContactPicker, type ContactOption } from "@/components/contacts/contact-picker";
import { StagedDocumentPicker, type StagedDocument } from "@/components/leads/staged-document-picker";
import { WalletFields } from "@/components/leads/wallet-fields";
import { AutocompleteInput } from "@/components/leads/autocomplete-input";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import {
  addLeadDocument,
  createLeadWithId,
  findDuplicateLeads,
  updateLead,
  type DuplicateLeadMatch,
  type LeadFormState,
} from "@/lib/actions/leads";
import { convertProcedureToLead } from "@/lib/actions/procedures";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import {
  BUSINESS_LINES,
  BUSINESS_LINE_LABELS,
  STAGES,
  STAGE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/leads";
import type { BusinessLine, Lead, LeadWallet } from "@/lib/types";

interface ProfileOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface LeadPrefill {
  businessLine?: BusinessLine;
  notes?: string;
  contactId?: string;
}

interface LeadFormProps {
  mode: "create" | "edit";
  lead?: Lead;
  profiles: ProfileOption[];
  contacts: ContactOption[];
  wallets?: LeadWallet[];
  // Existing distinct values across all leads, for the autocomplete
  // suggestions on these free-text fields.
  existingProductTypes?: string[];
  existingProcedureTypes?: string[];
  existingSources?: string[];
  walletLabelSuggestions?: string[];
  // Create mode only: default field values carried over from a procedure
  // being converted into a lead, and that procedure's id so the new lead
  // can be linked back to it on save.
  prefill?: LeadPrefill;
  fromProcedureId?: string;
}

const initialState: LeadFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

type CreateStatus = "idle" | "creating" | "uploading";

export function LeadForm({
  mode,
  lead,
  profiles,
  contacts,
  wallets = [],
  existingProductTypes = [],
  existingProcedureTypes = [],
  existingSources = [],
  walletLabelSuggestions = [],
  prefill,
  fromProcedureId,
}: LeadFormProps) {
  const router = useRouter();

  // Edit mode keeps the existing server-action/useActionState flow — it
  // redirects to the lead on success, same as before.
  const editAction = mode === "edit" && lead ? updateLead.bind(null, lead.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  // Create mode needs to know the new lead's id before it can upload any
  // staged documents, so it can't rely on the action's own redirect() —
  // it creates the lead, uploads documents client-side, then navigates
  // itself.
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateLeadMatch[] | null>(null);
  // Snapshotted so "Add anyway" can resubmit the exact same data the
  // duplicate check ran against, without the user having to click
  // Create again.
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
      const primaryContactId = formData.get("primary_contact_id")?.toString().trim();
      // No primary contact yet (the field is required, but this check
      // runs before that validation) — nothing to match on, so skip
      // straight to the normal required-field error from createLeadWithId.
      if (primaryContactId) {
        const businessLine = formData.get("business_line")?.toString().trim();
        const productType = formData.get("product_type")?.toString().trim();
        const procedureType = formData.get("procedure_type")?.toString().trim();
        if (businessLine && productType && procedureType) {
          const matches = await findDuplicateLeads({
            primaryContactId,
            businessLine: businessLine as BusinessLine,
            productType,
            procedureType,
          });
          if (matches.length > 0) {
            setDuplicateMatches(matches);
            setCreateStatus("idle");
            return;
          }
        }
      }
    }

    const result = await createLeadWithId(formData);

    if (result.error || !result.id) {
      setCreateError(result.error ?? "Failed to create lead.");
      setCreateStatus("idle");
      return;
    }

    const leadId = result.id;
    const failedNames: string[] = [];
    let conversionIssue: string | null = null;

    if (fromProcedureId) {
      const convertResult = await convertProcedureToLead(fromProcedureId, leadId);
      if (convertResult.error) {
        conversionIssue = `Converting the procedure failed: ${convertResult.error}. The original procedure was left unchanged.`;
        console.error("[LeadForm] failed to convert procedure to lead:", convertResult.error);
      } else if (convertResult.failedDocuments.length > 0) {
        conversionIssue =
          convertResult.failedDocuments.length === 1
            ? `1 document could not be moved from the procedure ("${convertResult.failedDocuments[0]}"). The procedure was kept so you can retry.`
            : `${convertResult.failedDocuments.length} documents could not be moved from the procedure (${convertResult.failedDocuments.join(", ")}). The procedure was kept so you can retry.`;
      }
    }

    if (stagedDocuments.length > 0) {
      setCreateStatus("uploading");

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      for (const doc of stagedDocuments) {
        try {
          if (!session) throw new Error("Session expired");
          const path = buildDocumentPath(doc.file.name);
          await uploadFileWithProgress("lead-documents", doc.file, path, session.access_token, () => {});
          const addResult = await addLeadDocument(leadId, doc.type, path, doc.file.name, doc.hash);
          if (addResult.error) throw new Error(addResult.error);
        } catch {
          failedNames.push(doc.file.name);
        }
      }
    }

    const params = new URLSearchParams();
    if (failedNames.length > 0) params.set("failedDocs", failedNames.join(","));
    if (conversionIssue) params.set("conversionIssue", conversionIssue);
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`/leads/${leadId}${query}`);
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
          <label className={labelClass} htmlFor="business_line">
            Business Line *
          </label>
          <select
            id="business_line"
            name="business_line"
            required
            defaultValue={lead?.business_line ?? prefill?.businessLine ?? ""}
            className={fieldClass}
          >
            <option value="" disabled className="bg-[#0a0e17]">
              Select…
            </option>
            {BUSINESS_LINES.map((line) => (
              <option key={line} value={line} className="bg-[#0a0e17]">
                {BUSINESS_LINE_LABELS[line]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="product_type">
            Product Type *
          </label>
          <AutocompleteInput
            id="product_type"
            name="product_type"
            required
            defaultValue={lead?.product_type ?? ""}
            suggestions={existingProductTypes}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="procedure_type">
            Procedure Type *
          </label>
          <AutocompleteInput
            id="procedure_type"
            name="procedure_type"
            required
            defaultValue={lead?.procedure_type ?? ""}
            suggestions={existingProcedureTypes}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="priority">
            Priority
          </label>
          <select id="priority" name="priority" defaultValue={lead?.priority ?? "medium"} className={fieldClass}>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority} className="bg-[#0a0e17]">
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="stage">
            Stage
          </label>
          <select id="stage" name="stage" defaultValue={lead?.stage ?? "new"} className={fieldClass}>
            {STAGES.map((stage) => (
              <option key={stage} value={stage} className="bg-[#0a0e17]">
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <ContactPicker
            name="primary_contact_id"
            label="Primary Contact *"
            contacts={contacts}
            defaultContactId={lead?.primary_contact_id ?? prefill?.contactId}
          />
        </div>

        <div>
          <ContactPicker
            name="counterparty_contact_id"
            label="Counterparty Contact"
            contacts={contacts}
            defaultContactId={lead?.counterparty_contact_id}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="deal_value">
            Deal Value
          </label>
          <input
            id="deal_value"
            name="deal_value"
            type="number"
            step="0.01"
            defaultValue={lead?.deal_value ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            name="currency"
            placeholder="USD, USDT, XAU…"
            defaultValue={lead?.currency ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="source">
            Source
          </label>
          <AutocompleteInput
            id="source"
            name="source"
            defaultValue={lead?.source ?? ""}
            suggestions={existingSources}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="follow_up_date">
            Follow-up Date
          </label>
          <input
            id="follow_up_date"
            name="follow_up_date"
            type="date"
            defaultValue={lead?.follow_up_date ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="assigned_to">
            Assigned To
          </label>
          <select id="assigned_to" name="assigned_to" defaultValue={lead?.assigned_to ?? ""} className={fieldClass}>
            <option value="" className="bg-[#0a0e17]">
              Unassigned
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id} className="bg-[#0a0e17]">
                {profile.full_name || profile.email || profile.id}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={lead?.notes ?? prefill?.notes ?? ""}
            className={fieldClass}
          />
        </div>
      </GlassCard>

      <GlassCard interactive={false} className="p-6">
        <p className={labelClass}>Wallet(s)</p>
        <WalletFields initialWallets={wallets} labelSuggestions={walletLabelSuggestions} />
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>Documents</p>
          <StagedDocumentPicker documents={stagedDocuments} onChange={setStagedDocuments} />
        </GlassCard>
      )}

      {duplicateMatches && duplicateMatches.length > 0 && (
        <DuplicateWarningBanner
          heading="A lead with this same contact, business line, product type and procedure type already exists:"
          matches={duplicateMatches.map((m) => ({ id: m.id, href: `/leads/${m.id}`, label: m.label, meta: m.meta }))}
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
          disabled={isPending}
          className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === "edit"
            ? isEditPending
              ? "Saving…"
              : "Save changes"
            : createStatus === "uploading"
              ? "Uploading documents…"
              : createStatus === "creating"
                ? "Creating…"
                : "Create lead"}
        </button>
        <Link
          href={mode === "edit" && lead ? `/leads/${lead.id}` : "/leads"}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
