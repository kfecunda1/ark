"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { MoneyInput } from "@/components/money-input";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { ProductOptionsPicker } from "@/components/projects/product-options-picker";
import { StagedDocumentPicker, type StagedDocument } from "@/components/projects/staged-document-picker";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import {
  IntermediaryChainEditor,
  type IntermediaryChainEntry,
  type IntermediaryPickerOption,
} from "@/components/projects/intermediary-chain-editor";
import {
  addProjectDocument,
  createProjectWithId,
  findDuplicateProjects,
  updateProject,
  type DuplicateProjectMatch,
  type ProjectFormState,
} from "@/lib/actions/projects";
import { getContactProductRatio, getContactProductRatios, quickCreateContact } from "@/lib/actions/contacts";
import { quickCreatePerson } from "@/lib/actions/people";
import { getReceiverIntermediaryPersonIds } from "@/lib/actions/intermediaries";
import { createClient } from "@/lib/supabase/client";
import { buildDocumentPath, uploadFileWithProgress } from "@/lib/storage";
import { disableSubmitButton } from "@/lib/forms";
import { CURRENCIES, STAGES, STAGE_LABELS, STATUSES, STATUS_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/lib/projects";
import { amountInWords } from "@/lib/money";
import type { Currency, DocumentTypeRecord, Product, Project, ProjectProduct, ProjectStage } from "@/lib/types";

interface ProjectFormProps {
  mode: "create" | "edit";
  project?: Project;
  // Edit mode only — the project's current product options.
  projectProducts?: ProjectProduct[];
  // Edit mode only — the project's current intermediary chain, in
  // order, including archived people already in it (see AGENTS.md's
  // Archived note) — lib/intermediaries.ts's getProjectIntermediaryChain.
  projectIntermediaries?: IntermediaryChainEntry[];
  // UI: Receivers (see AGENTS.md's UI-naming-vs-database-naming note)
  // — the "Matched With" field's options.
  receivers: EntityOption[];
  // The "Contact person" field's options — the real, simple People
  // ("Contacts" tab) list, wholly separate from receivers above.
  people: EntityOption[];
  products: Product[];
  documentTypes: DocumentTypeRecord[];
  // Create mode only: the Settings → Defaults value, used as the
  // Currency field's initial selection for a brand-new project.
  defaultCurrency?: Currency;
  // Create mode only: pre-ticks Recovery when arriving from the
  // Recovery Projects tab's "New Project" link (app/(app)/projects/
  // new/page.tsx reads ?recovery=true) — unticked otherwise.
  defaultRecovery?: boolean;
}

const initialState: ProjectFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

type CreateStatus = "idle" | "creating" | "uploading";

export function ProjectForm({
  mode,
  project,
  projectProducts = [],
  projectIntermediaries = [],
  receivers,
  people,
  products,
  documentTypes,
  defaultCurrency,
  defaultRecovery,
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

  // Stage is only tracked locally so the Status field can show/hide
  // itself live as the user picks a different stage, before anything is
  // saved.
  const [stage, setStage] = useState<ProjectStage>(project?.stage ?? "new");

  // ---- Product options + ratio auto-fill (snapshot, not live) -------
  const [productOptions, setProductOptions] = useState<string[]>(
    projectProducts.length > 0 ? projectProducts.map((p) => p.product) : [""]
  );
  const [matchedContactId, setMatchedContactId] = useState<string | null>(project?.matched_contact_id ?? null);
  const [ratioReal, setRatioReal] = useState(project?.ratio_real ?? "");
  const [isRecovery, setIsRecovery] = useState(project?.is_recovery ?? defaultRecovery ?? false);
  // Tracked only to drive the live spelled-out amount below the field —
  // the field itself still reads out of FormData on submit like every
  // other field on this form, same as before MoneyInput existed.
  const [totalFaceValueText, setTotalFaceValueText] = useState(
    project?.total_face_value != null ? String(project.total_face_value) : ""
  );
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(project?.currency ?? defaultCurrency ?? "USD");
  const totalFaceValueWords = totalFaceValueText.trim()
    ? amountInWords(Number(totalFaceValueText), selectedCurrency)
    : "";

  // ---- Intermediary chain (staged locally, submitted on save) -------
  const [intermediaries, setIntermediaries] = useState<IntermediaryChainEntry[]>(projectIntermediaries);
  // The matched receiver's own intermediaries, refetched live as
  // matchedContactId changes — reordered to the front of the "add"
  // picker below, same idea as the ratio auto-fill effect above.
  const [receiverIntermediaryIds, setReceiverIntermediaryIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!matchedContactId) {
        if (!cancelled) setReceiverIntermediaryIds(new Set());
        return;
      }
      const ids = await getReceiverIntermediaryPersonIds(matchedContactId);
      if (!cancelled) setReceiverIntermediaryIds(new Set(ids));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [matchedContactId]);

  const intermediaryPickerOptions: IntermediaryPickerOption[] = [
    ...people.filter((p) => receiverIntermediaryIds.has(p.id)),
    ...people.filter((p) => !receiverIntermediaryIds.has(p.id)),
  ];
  const matchedReceiverLabel = receivers.find((r) => r.id === matchedContactId)?.label ?? null;

  function addIntermediary(option: IntermediaryPickerOption) {
    setIntermediaries((prev) => [...prev, { key: option.id, personId: option.id, label: option.label }]);
  }
  function removeIntermediary(personId: string) {
    setIntermediaries((prev) => prev.filter((e) => e.personId !== personId));
  }
  function moveIntermediary(personId: string, direction: "up" | "down") {
    setIntermediaries((prev) => {
      const index = prev.findIndex((e) => e.personId === personId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  type AutoFillMessage =
    | { tone: "filled"; text: string }
    | { tone: "differs"; contactName: string; productType: string; theirRatio: string; currentRatio: string }
    | { tone: "missing"; contactName: string; productType: string; isRecovery: boolean };
  const [autoFillMessage, setAutoFillMessage] = useState<AutoFillMessage | null>(null);
  // Shown only while 2-3 products are chosen and undecided — the
  // matched contact's ratio per option, as information only. Cleared
  // the moment there's a single chosen product instead, which gets the
  // real fill/differs treatment above.
  const [infoRatios, setInfoRatios] = useState<Record<string, string | null> | null>(null);
  // Read inside the effect without making it a reactive dependency —
  // this should only re-run when the match or the chosen products
  // change, not every time the user types into Ratio Real themselves.
  const ratioRealRef = useRef(ratioReal);
  useEffect(() => {
    ratioRealRef.current = ratioReal;
  }, [ratioReal]);

  const chosenProductsKey = productOptions.filter(Boolean).join(",");

  useEffect(() => {
    let cancelled = false;

    // Everything that adjusts state lives inside this async callback
    // (including the "nothing to check" exit) rather than directly in
    // the effect body, so a quick matched/product change can't set
    // state out of order with an in-flight lookup from the previous one.
    async function run() {
      const chosen = chosenProductsKey ? chosenProductsKey.split(",") : [];

      if (!matchedContactId || chosen.length === 0) {
        if (!cancelled) {
          setAutoFillMessage(null);
          setInfoRatios(null);
        }
        return;
      }

      if (chosen.length > 1) {
        // 2-3 undecided options: show the matched contact's ratio per
        // option as information only — never fills or flags a
        // difference, since there's no single final product yet to
        // check ratio_real against.
        if (!cancelled) setAutoFillMessage(null);
        const ratios = await getContactProductRatios(matchedContactId, chosen, isRecovery);
        if (!cancelled) setInfoRatios(ratios);
        return;
      }

      // Exactly one product chosen — the same "snapshot" fill/differs
      // check as before, treating it as the would-be final product.
      if (!cancelled) setInfoRatios(null);
      const product = chosen[0];
      const { ratio, contactName } = await getContactProductRatio(matchedContactId, product, isRecovery);
      if (cancelled) return;
      if (!contactName) {
        setAutoFillMessage(null);
        return;
      }
      if (!ratio) {
        setAutoFillMessage({ tone: "missing", contactName, productType: product, isRecovery });
        return;
      }
      const current = ratioRealRef.current.trim();
      if (!current) {
        setRatioReal(ratio);
        setAutoFillMessage({ tone: "filled", text: `Real ratio filled from ${contactName} (${product}).` });
      } else if (current !== ratio) {
        // Never overwritten automatically — only the "Use <theirRatio>"
        // button below ever changes ratioReal from here.
        setAutoFillMessage({ tone: "differs", contactName, productType: product, theirRatio: ratio, currentRatio: current });
      } else {
        setAutoFillMessage(null);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [matchedContactId, chosenProductsKey, isRecovery]);

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
      const matchedContact = formData.get("matched_contact_id")?.toString().trim();
      const chosenProducts = formData
        .getAll("product_options")
        .map((v) => v.toString().trim())
        .filter(Boolean);
      if (matchedContact && chosenProducts.length > 0) {
        const matches = await findDuplicateProjects({
          matchedContactId: matchedContact,
          productOptions: chosenProducts,
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

        <div className="sm:col-span-2">
          <label className={labelClass}>Products *</label>
          <ProductOptionsPicker products={products} value={productOptions} onChange={setProductOptions} />
        </div>

        <div className="sm:col-span-2">
          <label className="flex items-center gap-2.5 text-sm text-white/80">
            <input
              type="checkbox"
              name="is_recovery"
              checked={isRecovery}
              onChange={(e) => setIsRecovery(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
            />
            Recovery
          </label>
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

        <div className="sm:col-span-2">
          <EntityPicker
            name="matched_contact_id"
            label="Matched With"
            options={receivers}
            defaultId={project?.matched_contact_id}
            entityNoun="receiver"
            onSelect={(receiver) => setMatchedContactId(receiver?.id ?? null)}
            onQuickCreate={async (name) => {
              const result = await quickCreateContact({ full_name: name });
              return {
                option: result.contact ? { id: result.contact.id, label: result.contact.full_name } : null,
                error: result.error,
              };
            }}
          />
          <div className="mt-3">
            <IntermediaryChainEditor
              entries={intermediaries}
              receiverLabel={matchedReceiverLabel}
              pickerOptions={intermediaryPickerOptions}
              onAdd={addIntermediary}
              onRemove={removeIntermediary}
              onMoveUp={(personId) => moveIntermediary(personId, "up")}
              onMoveDown={(personId) => moveIntermediary(personId, "down")}
              submitAsHiddenFields
              onQuickCreate={async (name) => {
                const result = await quickCreatePerson({ name });
                return {
                  option: result.person
                    ? { id: result.person.id, label: [result.person.first_name, result.person.last_name].filter(Boolean).join(" ") }
                    : null,
                  error: result.error,
                };
              }}
            />
          </div>
        </div>

        <div>
          <EntityPicker
            name="contact_person_id"
            label="Contact Person Project"
            options={people}
            defaultId={project?.contact_person_id}
            entityNoun="contact"
            onQuickCreate={async (name) => {
              const result = await quickCreatePerson({ name });
              return {
                option: result.person
                  ? { id: result.person.id, label: [result.person.first_name, result.person.last_name].filter(Boolean).join(" ") }
                  : null,
                error: result.error,
              };
            }}
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
            value={ratioReal}
            onChange={(e) => setRatioReal(e.target.value)}
            className={fieldClass}
          />
          {autoFillMessage?.tone === "filled" && (
            <p className="mt-1.5 text-xs text-emerald-300">{autoFillMessage.text}</p>
          )}
          {autoFillMessage?.tone === "differs" && (
            <div className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
              <p className="text-xs text-amber-200">
                {autoFillMessage.contactName}&apos;s ratio for {autoFillMessage.productType} is{" "}
                {autoFillMessage.theirRatio}. Current real ratio is {autoFillMessage.currentRatio}.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRatioReal(autoFillMessage.theirRatio);
                    setAutoFillMessage(null);
                  }}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
                >
                  Use {autoFillMessage.theirRatio}
                </button>
                <button
                  type="button"
                  onClick={() => setAutoFillMessage(null)}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08]"
                >
                  Keep {autoFillMessage.currentRatio}
                </button>
              </div>
            </div>
          )}
          {autoFillMessage?.tone === "missing" && (
            <p className="mt-1.5 text-xs text-amber-300">
              {autoFillMessage.contactName} has no {autoFillMessage.isRecovery ? "recovery ratio" : "ratio"} set for{" "}
              {autoFillMessage.productType}.
            </p>
          )}
          {infoRatios && (
            <div className="mt-1.5 rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
              <p className="text-xs text-white/50">
                Matched contact&apos;s {isRecovery ? "recovery ratio" : "ratio"} on record, per option (not filled yet):
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {Object.entries(infoRatios).map(([product, ratio]) => (
                  <li key={product} className="text-xs text-white/70">
                    {product}: {ratio ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="total_face_value">
            Total Face Value
          </label>
          <MoneyInput
            id="total_face_value"
            name="total_face_value"
            defaultValue={project?.total_face_value ?? ""}
            onChange={setTotalFaceValueText}
            className={fieldClass}
          />
          {totalFaceValueWords && <p className="mt-1.5 text-xs text-white/40">{totalFaceValueWords}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="currency">
            Currency
          </label>
          <select
            id="currency"
            name="currency"
            defaultValue={project?.currency ?? defaultCurrency ?? "USD"}
            onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
            className={fieldClass}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency} className="bg-[#0a0e17]">
                {currency}
              </option>
            ))}
          </select>
        </div>
      </GlassCard>

      {mode === "create" && (
        <GlassCard interactive={false} className="p-6">
          <p className={labelClass}>Documents</p>
          <StagedDocumentPicker
            documents={stagedDocuments}
            onChange={setStagedDocuments}
            documentTypes={documentTypes}
          />
        </GlassCard>
      )}

      {duplicateMatches && duplicateMatches.length > 0 && (
        <DuplicateWarningBanner
          heading="A project with this same matched receiver and an overlapping product already exists:"
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
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
