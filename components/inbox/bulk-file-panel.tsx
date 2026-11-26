"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { ProjectQuickCreateFields } from "@/components/inbox/project-quick-create-fields";
import { ReceiverQuickCreateFields } from "@/components/inbox/receiver-quick-create-fields";
import { OpportunityQuickCreateFields } from "@/components/inbox/opportunity-quick-create-fields";
import { fileInboxItemAsDocument, fileInboxItemAsNote } from "@/lib/actions/inbox";
import { suggestNameFromInboxItem } from "@/lib/inbox-naming";
import { createClient } from "@/lib/supabase/client";
import { truncate } from "@/lib/format";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Currency, DocumentTypeRecord, InboxItem, Product, ProjectTranche } from "@/lib/types";

interface BulkFilePanelProps {
  items: InboxItem[];
  projectOptions: EntityOption[];
  contactOptions: EntityOption[];
  opportunityOptions: EntityOption[];
  peopleOptions: EntityOption[];
  products: Product[];
  defaultCurrency: Currency;
  documentTypes: DocumentTypeRecord[];
  // Lets the "small list" drop an item from this run without closing
  // the whole panel — kept in sync with the parent's checkbox
  // selection (components/inbox/inbox-tabs.tsx).
  onRemoveItem: (itemId: string) => void;
  onDone: () => void;
  onCancel: () => void;
  lang?: Lang;
}

const TRANCHE_GENERAL = "general";

function itemRowLabel(item: InboxItem, t: ReturnType<typeof getDictionary>): string {
  if (item.file_name) return item.file_name;
  if (item.text_or_caption) return truncate(item.text_or_caption, 50);
  return t.inbox.noContent;
}

interface ItemResult {
  itemId: string;
  label: string;
  status: "success" | "error";
  message?: string;
}

export function BulkFilePanel({
  items,
  projectOptions,
  contactOptions,
  opportunityOptions,
  peopleOptions,
  products,
  defaultCurrency,
  documentTypes,
  onRemoveItem,
  onDone,
  onCancel,
  lang = "en",
}: BulkFilePanelProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const suggestedName = suggestNameFromInboxItem(items[0] ?? {});
  const [destinationType, setDestinationType] = useState<"project" | "contact" | "opportunity">("project");
  const [selectedProject, setSelectedProject] = useState<EntityOption | null>(null);
  const [selectedContact, setSelectedContact] = useState<EntityOption | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<EntityOption | null>(null);
  // Same "matches target by id at submit time" approach as components/
  // inbox/file-into-panel.tsx — see that file's own comment.
  const [createdDestination, setCreatedDestination] = useState<{ type: "project" | "contact" | "opportunity"; id: string } | null>(
    null
  );
  const [tranches, setTranches] = useState<ProjectTranche[]>([]);
  const [trancheValue, setTrancheValue] = useState(TRANCHE_GENERAL);
  const [documentType, setDocumentType] = useState(documentTypes[0]?.name ?? "");
  const [perItemDocType, setPerItemDocType] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [filedInto, setFiledInto] = useState<{
    label: string;
    type: "project" | "contact" | "opportunity";
    id: string;
    wasCreated: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function selectDestinationType(type: "project" | "contact" | "opportunity") {
    setDestinationType(type);
    setSelectedProject(null);
    setSelectedContact(null);
    setSelectedOpportunity(null);
    setCreatedDestination(null);
    setTranches([]);
    setTrancheValue(TRANCHE_GENERAL);
  }

  function selectProject(option: EntityOption | null) {
    setSelectedProject(option);
    setTranches([]);
    setTrancheValue(TRANCHE_GENERAL);
  }

  async function handleSubmit() {
    setError(null);

    const target =
      destinationType === "project"
        ? selectedProject
          ? {
              type: "project" as const,
              id: selectedProject.id,
              trancheId: tranches.find((t) => String(t.tranche_number) === trancheValue)?.id ?? null,
            }
          : null
        : destinationType === "contact"
          ? selectedContact
            ? { type: "contact" as const, id: selectedContact.id }
            : null
          : selectedOpportunity
            ? { type: "opportunity" as const, id: selectedOpportunity.id }
            : null;

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

    const targetLabel =
      (target.type === "project" ? selectedProject?.label : target.type === "contact" ? selectedContact?.label : selectedOpportunity?.label) ??
      "destination";
    setFiledInto({
      label: targetLabel,
      type: target.type,
      id: target.id,
      wasCreated: createdDestination?.type === target.type && createdDestination.id === target.id,
    });

    setIsSubmitting(true);
    setResults(null);
    setProgress({ done: 0, total: items.length });

    const runResults: ItemResult[] = [];
    for (const item of items) {
      const label = itemRowLabel(item, t);
      const docType = perItemDocType[item.id] ?? documentType;
      try {
        if (item.storage_path) {
          // confirmDuplicate=true always — a cross-record hash match is
          // a warning everywhere else in this app (never blocking); a
          // *same-target* duplicate still comes back as a hard error
          // below, surfacing as this item's own failure.
          const result = await fileInboxItemAsDocument(
            item.id,
            target.type === "project" ? { type: "project", id: target.id, trancheId: target.trancheId } : { type: target.type, id: target.id },
            docType,
            true
          );
          if (result.error) {
            const message =
              result.error === "duplicateSameTarget"
                ? t.inboxFile.duplicateSameTarget(result.duplicateFileName ?? "")
                : (resolveError(result.error, lang) ?? result.error);
            runResults.push({ itemId: item.id, label, status: "error", message });
          } else {
            runResults.push({ itemId: item.id, label, status: "success" });
          }
        } else {
          const result = await fileInboxItemAsNote(item.id, { type: target.type, id: target.id });
          if (result.error) {
            runResults.push({ itemId: item.id, label, status: "error", message: resolveError(result.error, lang) ?? result.error });
          } else {
            runResults.push({ itemId: item.id, label, status: "success" });
          }
        }
      } catch (err) {
        runResults.push({
          itemId: item.id,
          label,
          status: "error",
          message: err instanceof Error ? err.message : t.common.somethingWentWrong,
        });
      }
      setProgress({ done: runResults.length, total: items.length });
    }

    setResults(runResults);
    setIsSubmitting(false);
    router.refresh();
  }

  const destinationLabel =
    destinationType === "project" ? selectedProject?.label : destinationType === "contact" ? selectedContact?.label : selectedOpportunity?.label;
  const successCount = results?.filter((r) => r.status === "success").length ?? 0;
  const failureCount = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3.5">
      <p className="mb-3 text-sm font-medium text-white">{t.inboxBulk.fileItemsIntoHeading(items.length)}</p>

      {!results && (
        <>
          <div className="mb-2 flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
            <button
              type="button"
              onClick={() => selectDestinationType("project")}
              disabled={isSubmitting}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                destinationType === "project" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.inboxFile.tabProject}
            </button>
            <button
              type="button"
              onClick={() => selectDestinationType("contact")}
              disabled={isSubmitting}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                destinationType === "contact" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.inboxFile.tabReceiver}
            </button>
            <button
              type="button"
              onClick={() => selectDestinationType("opportunity")}
              disabled={isSubmitting}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                destinationType === "opportunity" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.inboxFile.tabOpportunity}
            </button>
          </div>

          {destinationType === "project" ? (
            <EntityPicker
              key="bulk-project"
              name="bulk_target_project"
              label={t.inboxFile.projectLabel}
              options={projectOptions}
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
          ) : destinationType === "opportunity" ? (
            <EntityPicker
              key="bulk-opportunity"
              name="bulk_target_opportunity"
              label={t.opportunities.opportunityLabel}
              options={opportunityOptions}
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
          ) : (
            <EntityPicker
              key="bulk-contact"
              name="bulk_target_contact"
              label={t.inboxFile.receiverLabel}
              options={contactOptions}
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
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/55">
                {t.inboxBulk.documentTypeForItemsWithFile}
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                disabled={isSubmitting}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
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
                  disabled={isSubmitting}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
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

          <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            {items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 rounded px-1.5 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-white/75">{itemRowLabel(item, t)}</span>
                {item.storage_path && (
                  <select
                    aria-label={t.inboxBulk.documentTypeForItemAria(itemRowLabel(item, t))}
                    value={perItemDocType[item.id] ?? documentType}
                    onChange={(e) => setPerItemDocType((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    disabled={isSubmitting}
                    className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 text-[11px] text-white outline-none disabled:opacity-50"
                  >
                    {documentTypes.map((type) => (
                      <option key={type.id} value={type.name} className="bg-[#0a0e17]">
                        {type.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={isSubmitting}
                  aria-label={t.inboxBulk.removeFromBatchAria(itemRowLabel(item, t))}
                  className="shrink-0 text-white/35 transition-colors duration-150 ease-out hover:text-rose-300 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

          {isSubmitting && progress && (
            <div className="mt-3 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/50" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-150 ease-out"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-white/40">
                {progress.done}/{progress.total}
              </span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || items.length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? t.inboxFile.filing : t.inboxBulk.fileItemsButton(items.length, destinationLabel)}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
          </div>
        </>
      )}

      {results && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-white/80">
            {filedInto?.wasCreated ? (
              <>
                {t.inbox.createdAndFiled(filedInto.label, successCount)}{" "}
                <Link
                  href={
                    filedInto.type === "project"
                      ? `/projects/${filedInto.id}`
                      : filedInto.type === "contact"
                        ? `/receivers/${filedInto.id}`
                        : `/opportunities/${filedInto.id}`
                  }
                  className="underline decoration-white/30 underline-offset-2 hover:text-white"
                >
                  {filedInto.type === "project" ? t.inbox.openProject : filedInto.type === "contact" ? t.inbox.openReceiver : t.inbox.openOpportunity}
                </Link>
                {failureCount > 0 && ` · ${t.inboxBulk.filedSummary(successCount, failureCount)}`}
              </>
            ) : (
              t.inboxBulk.filedSummary(successCount, failureCount)
            )}
          </p>
          <div className="flex flex-col gap-1">
            {results.map((r) => (
              <div key={r.itemId} className="flex items-start gap-2 text-xs">
                {r.status === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                )}
                <span className={r.status === "success" ? "text-white/70" : "text-rose-300"}>
                  {r.label}
                  {r.message ? ` — ${r.message}` : ""}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-1 w-fit rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            {t.inbox.close}
          </button>
        </div>
      )}
    </div>
  );
}
