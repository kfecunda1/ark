"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { ContactPicker, type ContactOption } from "@/components/contacts/contact-picker";
import { StagedDocumentPicker, type StagedDocument } from "@/components/projects/staged-document-picker";
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
import { STAGES, STAGE_LABELS, STATUSES, STATUS_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/lib/projects";
import { PRODUCT_TYPES } from "@/lib/products";
import type { Project, ProjectStage, ProductType } from "@/lib/types";

interface ProjectFormProps {
  mode: "create" | "edit";
  project?: Project;
  contacts: ContactOption[];
}

const initialState: ProjectFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

type CreateStatus = "idle" | "creating" | "uploading";

export function ProjectForm({ mode, project, contacts }: ProjectFormProps) {
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

  // Stage is only tracked locally so the Status field can show/hide
  // itself live as the user picks a different stage, before anything is
  // saved.
  const [stage, setStage] = useState<ProjectStage>(project?.stage ?? "new");

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
      const clientContactId = formData.get("client_contact_id")?.toString().trim();
      const productType = formData.get("product_type")?.toString().trim();
      if (clientContactId && productType) {
        const matches = await findDuplicateProjects({
          clientContactId,
          productType: productType as ProductType,
        });
        if (matches.length > 0) {
          setDuplicateMatches(matches);
          setCreateStatus("idle");
          return;
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
          await uploadFileWithProgress("project-documents", doc.file, path, session.access_token, () => {});
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
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="name">
            Name *
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={project?.name ?? ""}
            className={fieldClass}
          />
        </div>

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
          <select
            id="stage"
            name="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as ProjectStage)}
            className={fieldClass}
          >
            {STAGES.map((s) => (
              <option key={s} value={s} className="bg-[#0a0e17]">
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {stage === "status" && (
          <div>
            <label className={labelClass} htmlFor="status">
              Status *
            </label>
            <select
              id="status"
              name="status"
              required
              defaultValue={project?.status ?? "open"}
              className={fieldClass}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s} className="bg-[#0a0e17]">
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <ContactPicker
            name="client_contact_id"
            label="Client Contact"
            contacts={contacts}
            defaultContactId={project?.client_contact_id}
          />
        </div>

        <div>
          <ContactPicker
            name="assigned_contact_id"
            label="Assigned Contact"
            contacts={contacts}
            defaultContactId={project?.assigned_contact_id}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="ratio_presented">
            Ratio Presented
          </label>
          <input
            id="ratio_presented"
            name="ratio_presented"
            placeholder="e.g. 70/30"
            defaultValue={project?.ratio_presented ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="ratio_real">
            Ratio Real
          </label>
          <input
            id="ratio_real"
            name="ratio_real"
            placeholder="e.g. 70/30"
            defaultValue={project?.ratio_real ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="total_face_value">
            Total Face Value
          </label>
          <input
            id="total_face_value"
            name="total_face_value"
            type="number"
            step="0.01"
            defaultValue={project?.total_face_value ?? ""}
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
            defaultValue={project?.currency ?? "USD"}
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
          heading="A project with this same client contact and product type already exists:"
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
