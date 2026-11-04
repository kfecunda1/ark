"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { ContactPicker, type ContactOption } from "@/components/contacts/contact-picker";
import { StagedDocumentPicker, type StagedDocument } from "@/components/projects/staged-document-picker";
import { AutocompleteInput } from "@/components/projects/autocomplete-input";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import {
  addProjectDocument,
  createProjectWithId,
  findDuplicateProjects,
  updateProject,
  type DuplicateProjectMatch,
  type ProjectFormState,
} from "@/lib/actions/projects";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import { STAGES, STAGE_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/lib/projects";
import { PRODUCT_TYPES } from "@/lib/products";
import type { Project } from "@/lib/types";

interface ProfileOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ProjectFormProps {
  mode: "create" | "edit";
  project?: Project;
  profiles: ProfileOption[];
  contacts: ContactOption[];
  // Existing distinct values across all projects, for the autocomplete
  // suggestions on these free-text fields.
  existingProcedureTypes?: string[];
  existingSources?: string[];
}

const initialState: ProjectFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

type CreateStatus = "idle" | "creating" | "uploading";

export function ProjectForm({
  mode,
  project,
  profiles,
  contacts,
  existingProcedureTypes = [],
  existingSources = [],
}: ProjectFormProps) {
  const router = useRouter();

  // Edit mode keeps the existing server-action/useActionState flow — it
  // redirects to the project on success, same as before.
  const editAction = mode === "edit" && project ? updateProject.bind(null, project.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  // Create mode needs to know the new project's id before it can upload
  // any staged documents, so it can't rely on the action's own redirect()
  // — it creates the project, uploads documents client-side, then
  // navigates itself.
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateProjectMatch[] | null>(null);
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
      // straight to the normal required-field error from createProjectWithId.
      if (primaryContactId) {
        const productType = formData.get("product_type")?.toString().trim();
        const procedureType = formData.get("procedure_type")?.toString().trim();
        if (productType && procedureType) {
          const matches = await findDuplicateProjects({
            primaryContactId,
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

    const result = await createProjectWithId(formData);

    if (result.error || !result.id) {
      setCreateError(result.error ?? "Failed to create project.");
      setCreateStatus("idle");
      return;
    }

    const projectId = result.id;
    const failedNames: string[] = [];

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
          const addResult = await addProjectDocument(projectId, doc.type, path, doc.file.name, doc.hash);
          if (addResult.error) throw new Error(addResult.error);
        } catch {
          failedNames.push(doc.file.name);
        }
      }
    }

    const params = new URLSearchParams();
    if (failedNames.length > 0) params.set("failedDocs", failedNames.join(","));
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`/projects/${projectId}${query}`);
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
          <label className={labelClass} htmlFor="product_type">
            Product Type *
          </label>
          <select
            id="product_type"
            name="product_type"
            required
            defaultValue={project?.product_type ?? ""}
            className={fieldClass}
          >
            <option value="" disabled className="bg-[#0a0e17]">
              Select…
            </option>
            {PRODUCT_TYPES.map((product) => (
              <option key={product} value={product} className="bg-[#0a0e17]">
                {product}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="procedure_type">
            Procedure Type *
          </label>
          <AutocompleteInput
            id="procedure_type"
            name="procedure_type"
            required
            defaultValue={project?.procedure_type ?? ""}
            suggestions={existingProcedureTypes}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="priority">
            Priority
          </label>
          <select id="priority" name="priority" defaultValue={project?.priority ?? "medium"} className={fieldClass}>
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
          <select id="stage" name="stage" defaultValue={project?.stage ?? "new"} className={fieldClass}>
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
            defaultContactId={project?.primary_contact_id}
          />
        </div>

        <div>
          <ContactPicker
            name="counterparty_contact_id"
            label="Counterparty Contact"
            contacts={contacts}
            defaultContactId={project?.counterparty_contact_id}
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
            defaultValue={project?.deal_value ?? ""}
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
            placeholder="USD, EUR, GBP…"
            defaultValue={project?.currency ?? ""}
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
            defaultValue={project?.source ?? ""}
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
            defaultValue={project?.follow_up_date ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="assigned_to">
            Assigned To
          </label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={project?.assigned_to ?? ""}
            className={fieldClass}
          >
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
            defaultValue={project?.notes ?? ""}
            className={fieldClass}
          />
        </div>
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>Documents</p>
          <StagedDocumentPicker documents={stagedDocuments} onChange={setStagedDocuments} />
        </GlassCard>
      )}

      {duplicateMatches && duplicateMatches.length > 0 && (
        <DuplicateWarningBanner
          heading="A project with this same contact, product type and procedure type already exists:"
          matches={duplicateMatches.map((m) => ({ id: m.id, href: `/projects/${m.id}`, label: m.label, meta: m.meta }))}
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
                : "Create project"}
        </button>
        <Link
          href={mode === "edit" && project ? `/projects/${project.id}` : "/projects"}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
