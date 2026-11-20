"use client";

import { useEffect, useState } from "react";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { fileInboxItemAsDocument, fileInboxItemAsNote, type InboxDuplicateMatch } from "@/lib/actions/inbox";
import { createClient } from "@/lib/supabase/client";
import type { DocumentTypeRecord, ProjectTranche } from "@/lib/types";

interface FileIntoPanelProps {
  itemId: string;
  hasFile: boolean;
  projectOptions: EntityOption[];
  contactOptions: EntityOption[];
  documentTypes: DocumentTypeRecord[];
  onFiled: () => void;
  onCancel: () => void;
}

const TRANCHE_GENERAL = "general";

export function FileIntoPanel({
  itemId,
  hasFile,
  projectOptions,
  contactOptions,
  documentTypes,
  onFiled,
  onCancel,
}: FileIntoPanelProps) {
  const [destinationType, setDestinationType] = useState<"project" | "contact">("project");
  const [selectedProject, setSelectedProject] = useState<EntityOption | null>(null);
  const [selectedContact, setSelectedContact] = useState<EntityOption | null>(null);
  const [tranches, setTranches] = useState<ProjectTranche[]>([]);
  const [trancheValue, setTrancheValue] = useState(TRANCHE_GENERAL);
  const [documentType, setDocumentType] = useState(documentTypes[0]?.name ?? "");
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

  function selectDestinationType(type: "project" | "contact") {
    setDestinationType(type);
    setSelectedProject(null);
    setSelectedContact(null);
    setTranches([]);
    setTrancheValue(TRANCHE_GENERAL);
  }

  function currentTarget(): { type: "project" | "contact"; id: string; trancheId: string | null } | null {
    if (destinationType === "project") {
      if (!selectedProject) return null;
      const tranche = tranches.find((t) => String(t.tranche_number) === trancheValue);
      return { type: "project", id: selectedProject.id, trancheId: tranche?.id ?? null };
    }
    if (!selectedContact) return null;
    return { type: "contact", id: selectedContact.id, trancheId: null };
  }

  async function handleFile(confirmDuplicate: boolean) {
    const target = currentTarget();
    if (!target) {
      setError(destinationType === "project" ? "Pick a project first." : "Pick a receiver first.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      if (hasFile) {
        const result = await fileInboxItemAsDocument(
          itemId,
          target.type === "project"
            ? { type: "project", id: target.id, trancheId: target.trancheId }
            : { type: "contact", id: target.id },
          documentType,
          confirmDuplicate
        );
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.needsConfirm) {
          setPendingMatches(result.matches ?? []);
          return;
        }
      } else {
        const result = await fileInboxItemAsNote(itemId, { type: target.type, id: target.id });
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      setPendingMatches(null);
      onFiled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
          Project
        </button>
        <button
          type="button"
          onClick={() => selectDestinationType("contact")}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
            destinationType === "contact" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          Receiver
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
          label="Project"
          options={projectOptions}
          entityNoun="project"
          onSelect={selectProject}
        />
      ) : (
        <EntityPicker
          key="contact"
          name="inbox_target_contact"
          label="Receiver"
          options={contactOptions}
          entityNoun="receiver"
          onSelect={setSelectedContact}
        />
      )}

      {hasFile && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/55">Document type</label>
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
              <label className="mb-1.5 block text-xs font-medium text-white/55">Tranche</label>
              <select
                value={trancheValue}
                onChange={(e) => setTrancheValue(e.target.value)}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40"
              >
                <option value={TRANCHE_GENERAL} className="bg-[#0a0e17]">
                  General
                </option>
                {[1, 2, ...tranches.map((t) => t.tranche_number).filter((n) => n > 2)]
                  .filter((n, i, arr) => arr.indexOf(n) === i)
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n} className="bg-[#0a0e17]">
                      Tranche {n}
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
            heading="This exact file matches one already attached elsewhere:"
            matches={pendingMatches.map((m, i) => ({ id: String(i), href: m.href, label: m.label, meta: m.fileName }))}
            onAddAnyway={() => handleFile(true)}
            addAnywayLabel="File anyway"
            disabled={isSubmitting}
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
          {isSubmitting ? "Filing…" : hasFile ? "File as Document" : "File as Note"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
