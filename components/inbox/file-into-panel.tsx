"use client";

import { useEffect, useState } from "react";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { ProjectQuickCreateFields } from "@/components/inbox/project-quick-create-fields";
import { ReceiverQuickCreateFields } from "@/components/inbox/receiver-quick-create-fields";
import { OpportunityQuickCreateFields } from "@/components/inbox/opportunity-quick-create-fields";
import { fileInboxItemAsDocument, fileInboxItemAsNote, type InboxDuplicateMatch } from "@/lib/actions/inbox";
import { suggestNameFromInboxItem } from "@/lib/inbox-naming";
import { createClient } from "@/lib/supabase/client";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Currency, DocumentTypeRecord, Product, ProjectTranche } from "@/lib/types";

export interface FileIntoDestination {
  type: "project" | "contact" | "opportunity";
  id: string;
  label: string;
}

export interface FiledResult {
  destinationLabel: string;
  destinationType: "project" | "contact" | "opportunity";
  destinationId: string;
  // True when the destination was just created by this same panel,
  // rather than an already-existing record picked from the list — the
  // caller (components/inbox/inbox-tabs.tsx) phrases its confirmation
  // as "Created X and filed …" instead of "Filed to X" accordingly.
  wasCreated: boolean;
}

interface FileIntoPanelProps {
  itemId: string;
  hasFile: boolean;
  textOrCaption: string | null;
  fileName: string | null;
  projectOptions: EntityOption[];
  contactOptions: EntityOption[];
  opportunityOptions: EntityOption[];
  // The intermediary picker inside "+ New opportunity" below — the
  // same People list every other intermediary picker in the app uses.
  peopleOptions: EntityOption[];
  products: Product[];
  defaultCurrency: Currency;
  documentTypes: DocumentTypeRecord[];
  // Pre-fills the destination/document type (a clicked "Suggested: X —
  // File here" chip, components/inbox/inbox-tabs.tsx) — read only once,
  // on mount; the caller remounts this component (via a key that
  // includes the destination) if a different suggestion is picked.
  initialDestination?: FileIntoDestination | null;
  initialDocumentType?: string | null;
  onFiled: (result: FiledResult) => void;
  onCancel: () => void;
  lang?: Lang;
}

const TRANCHE_GENERAL = "general";

export function FileIntoPanel({
  itemId,
  hasFile,
  textOrCaption,
  fileName,
  projectOptions,
  contactOptions,
  opportunityOptions,
  peopleOptions,
  products,
  defaultCurrency,
  documentTypes,
  initialDestination,
  initialDocumentType,
  onFiled,
  onCancel,
  lang = "en",
}: FileIntoPanelProps) {
  const t = getDictionary(lang);
  const suggestedName = suggestNameFromInboxItem({ text_or_caption: textOrCaption, file_name: fileName });
  const [destinationType, setDestinationType] = useState<"project" | "contact" | "opportunity">(
    initialDestination?.type ?? "project"
  );
  const [selectedProject, setSelectedProject] = useState<EntityOption | null>(
    initialDestination?.type === "project" ? { id: initialDestination.id, label: initialDestination.label } : null
  );
  const [selectedContact, setSelectedContact] = useState<EntityOption | null>(
    initialDestination?.type === "contact" ? { id: initialDestination.id, label: initialDestination.label } : null
  );
  const [selectedOpportunity, setSelectedOpportunity] = useState<EntityOption | null>(
    initialDestination?.type === "opportunity" ? { id: initialDestination.id, label: initialDestination.label } : null
  );
  // Which of the three selections above (if any) was just created —
  // compared against the actual filing target by id, at file time, so
  // a later manual pick of something else is never mistaken for a
  // freshly-created record (see handleFile below).
  const [createdDestination, setCreatedDestination] = useState<{ type: "project" | "contact" | "opportunity"; id: string } | null>(
    null
  );
  const [tranches, setTranches] = useState<ProjectTranche[]>([]);
  const [trancheValue, setTrancheValue] = useState(TRANCHE_GENERAL);
  const [documentType, setDocumentType] = useState(initialDocumentType || documentTypes[0]?.name || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMatches, setPendingMatches] = useState<InboxDuplicateMatch[] | null>(null);

  useEffect(() => {
    if (destinationType !== "project" || !selectedProject) return;
    const supabase = createClient();
    supabase
      .from("project_tranches")
      .select("*")
      .eq("project_id", selectedProject.id)
      .order("tranche_number")
      .then(({ data }) => setTranches((data as ProjectTranche[] | null) ?? []));
  }, [destinationType, selectedProject]);

  function selectProject(option: EntityOption | null) {
    setSelectedProject(option);
    setTranches([]);
    setTrancheValue(TRANCHE_GENERAL);
  }

  function selectDestinationType(type: "project" | "contact" | "opportunity") {
    setDestinationType(type);
    setSelectedProject(null);
    setSelectedContact(null);
    setSelectedOpportunity(null);
    setCreatedDestination(null);
    setTranches([]);
    setTrancheValue(TRANCHE_GENERAL);
  }

  function currentTarget(): { type: "project" | "contact" | "opportunity"; id: string; trancheId: string | null } | null {
    if (destinationType === "project") {
      if (!selectedProject) return null;
      const tranche = tranches.find((t) => String(t.tranche_number) === trancheValue);
      return { type: "project", id: selectedProject.id, trancheId: tranche?.id ?? null };
    }
    if (destinationType === "contact") {
      if (!selectedContact) return null;
      return { type: "contact", id: selectedContact.id, trancheId: null };
    }
    if (!selectedOpportunity) return null;
    return { type: "opportunity", id: selectedOpportunity.id, trancheId: null };
  }

  async function handleFile(confirmDuplicate: boolean) {
    const target = currentTarget();
    if (!target) {
      setError(
        destinationType === "project"
          ? t.inboxFile.pickProjectFirst
          : destinationType === "contact"
            ? t.inboxFile.pickReceiverFirst
            : t.opportunities.pickOpportunityFirst
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      if (hasFile) {
        const result = await fileInboxItemAsDocument(
          itemId,
          target.type === "project" ? { type: "project", id: target.id, trancheId: target.trancheId } : { type: target.type, id: target.id },
          documentType,
          confirmDuplicate
        );
        if (result.error) {
          setError(
            result.error === "duplicateSameTarget"
              ? t.inboxFile.duplicateSameTarget(result.duplicateFileName ?? "")
              : resolveError(result.error, lang)
          );
          return;
        }
        if (result.needsConfirm) {
          setPendingMatches(result.matches ?? []);
          return;
        }
      } else {
        const result = await fileInboxItemAsNote(itemId, { type: target.type, id: target.id });
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
      }
      setPendingMatches(null);
      const destinationLabel =
        (target.type === "project"
          ? selectedProject?.label
          : target.type === "contact"
            ? selectedContact?.label
            : selectedOpportunity?.label) ?? "destination";
      onFiled({
        destinationLabel,
        destinationType: target.type,
        destinationId: target.id,
        wasCreated: createdDestination?.type === target.type && createdDestination.id === target.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
        <button
          type="button"
          onClick={() => selectDestinationType("project")}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
            destinationType === "project" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          {t.inboxFile.tabProject}
        </button>
        <button
          type="button"
          onClick={() => selectDestinationType("contact")}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
            destinationType === "contact" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          {t.inboxFile.tabReceiver}
        </button>
        <button
          type="button"
          onClick={() => selectDestinationType("opportunity")}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
            destinationType === "opportunity" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          {t.inboxFile.tabOpportunity}
        </button>
      </div>

      {destinationType === "project" ? (
        <EntityPicker
          // Forces a remount on tab switch — EntityPicker seeds its own
          // internal allOptions/selected/query state from props only
          // once, on mount (components/entity-picker.tsx's
          // `useState(options)`), so without a key that changes here,
          // switching tabs reused the same instance and kept showing
          // whichever list loaded first instead of picking up the new
          // options/placeholder for the newly selected tab.
          key="project"
          name="inbox_target_project"
          label={t.inboxFile.projectLabel}
          options={projectOptions}
          defaultId={initialDestination?.type === "project" ? initialDestination.id : undefined}
          defaultQuickCreateName={suggestedName}
          entityNoun={lang === "es" ? "proyecto" : "project"}
          entityNounPlural={lang === "es" ? "proyectos" : "projects"}
          lang={lang}
          onSelect={selectProject}
          renderQuickCreate={({ initialName, onCreated, onCancel }) => (
            <ProjectQuickCreateFields
              initialName={initialName}
              contacts={contactOptions}
              products={products}
              defaultCurrency={defaultCurrency}
              onCreated={(option) => {
                setCreatedDestination({ type: "project", id: option.id });
                onCreated(option);
              }}
              onUseExisting={(match) => onCreated({ id: match.id, label: match.label })}
              onCancel={onCancel}
              lang={lang}
            />
          )}
        />
      ) : destinationType === "contact" ? (
        <EntityPicker
          key="contact"
          name="inbox_target_contact"
          label={t.inboxFile.receiverLabel}
          options={contactOptions}
          defaultId={initialDestination?.type === "contact" ? initialDestination.id : undefined}
          defaultQuickCreateName={suggestedName}
          entityNoun={lang === "es" ? "receptor" : "receiver"}
          entityNounPlural={lang === "es" ? "receptores" : "receivers"}
          lang={lang}
          onSelect={setSelectedContact}
          renderQuickCreate={({ initialName, onCreated, onCancel }) => (
            <ReceiverQuickCreateFields
              initialName={initialName}
              products={products}
              onCreated={(option) => {
                setCreatedDestination({ type: "contact", id: option.id });
                onCreated(option);
              }}
              onUseExisting={(match) => onCreated({ id: match.id, label: match.label })}
              onCancel={onCancel}
              lang={lang}
            />
          )}
        />
      ) : (
        <EntityPicker
          key="opportunity"
          name="inbox_target_opportunity"
          label={t.opportunities.opportunityLabel}
          options={opportunityOptions}
          defaultId={initialDestination?.type === "opportunity" ? initialDestination.id : undefined}
          defaultQuickCreateName={suggestedName}
          entityNoun={lang === "es" ? "oportunidad" : "opportunity"}
          entityNounPlural={lang === "es" ? "oportunidades" : "opportunities"}
          lang={lang}
          onSelect={setSelectedOpportunity}
          renderQuickCreate={({ initialName, onCreated, onCancel }) => (
            <OpportunityQuickCreateFields
              initialName={initialName}
              people={peopleOptions}
              onCreated={(option) => {
                setCreatedDestination({ type: "opportunity", id: option.id });
                onCreated(option);
              }}
              onUseExisting={(match) => onCreated({ id: match.id, label: match.label })}
              onCancel={onCancel}
              lang={lang}
            />
          )}
        />
      )}

      {hasFile && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/55">{t.inboxFile.documentTypeLabel}</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
            >
              {documentTypes.map((type) => (
                <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          {destinationType === "project" && selectedProject && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/55">{t.inboxFile.trancheFieldLabel}</label>
              <select
                value={trancheValue}
                onChange={(e) => setTrancheValue(e.target.value)}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
              >
                <option value={TRANCHE_GENERAL} className="bg-[#0a0e17]">
                  {t.inboxFile.generalTrancheOption}
                </option>
                {[1, 2, ...tranches.map((tr) => tr.tranche_number).filter((n) => n > 2)]
                  .filter((n, i, arr) => arr.indexOf(n) === i)
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n} className="bg-[#0a0e17]">
                      {t.inboxFile.trancheOption(n)}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      )}

      {pendingMatches && (
        <div className="mt-3">
          <DuplicateWarningBanner
            heading={t.inboxFile.duplicateHeading}
            matches={pendingMatches.map((m, i) => ({ id: String(i), href: m.href, label: m.label, meta: m.fileName }))}
            onAddAnyway={() => handleFile(true)}
            addAnywayLabel={t.inboxFile.fileAnyway}
            disabled={isSubmitting}
            lang={lang}
          />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleFile(false)}
          disabled={isSubmitting}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? t.inboxFile.filing : hasFile ? t.inboxFile.fileAsDocument : t.inboxFile.fileAsNote}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
