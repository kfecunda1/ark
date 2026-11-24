"use client";

import { useState } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import { getDictionary, type Lang } from "@/lib/i18n";
import { versionedFileName } from "@/lib/storage";
import type {
  Contact,
  ContactDocument,
  Note,
  NoteDocument,
  Opportunity,
  OpportunityDocument,
  Project,
  ProjectDocument,
  ProjectTranche,
  Template,
  TemplateVersion,
} from "@/lib/types";

// One CSV per table — every table in the schema except profiles (an
// auth-linked table, not part of the business data) and the two
// tables below, which also feed the file-download pass further down.
const TABLES = [
  "projects",
  "project_tranches",
  "project_steps",
  "project_intermediaries",
  "contacts",
  "contact_products",
  "receiver_intermediaries",
  "people",
  "notes",
  "note_participants",
  "project_documents",
  "contact_documents",
  "activity_log",
  "payout_groups",
  "tranche_payouts",
  "tranche_payout_shares",
  "opportunities",
  "opportunity_products",
  "opportunity_documents",
  "note_documents",
  "templates",
  "template_products",
  "template_versions",
] as const;

interface FileJob {
  bucket: "project-documents" | "contact-documents" | "opportunity-documents" | "note-documents" | "templates";
  path: string;
  zipPath: string;
}

// Keeps a folder readable (the record's name) while still unique (its
// id) — two projects or contacts can share a name, but never an id.
function folderName(name: string, id: string): string {
  const sanitized = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
  return `${sanitized} (${id.slice(0, 8)})`;
}

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

export function ExportBackupButton({ lang = "en" }: { lang?: Lang } = {}) {
  const t = getDictionary(lang);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  async function handleExport() {
    setError(null);
    setSkipped([]);
    setProgress(null);
    setIsExporting(true);

    try {
      const supabase = createClient();
      const zip = new JSZip();

      // 1. Fetch every table's rows first (written as CSV further down,
      // once project_documents has its derived tranche_number column —
      // see step 2).
      const rowsByTable: Partial<Record<(typeof TABLES)[number], Record<string, unknown>[]>> = {};
      for (const table of TABLES) {
        const { data, error: queryError } = await supabase.from(table).select("*");
        if (queryError) {
          throw new Error(t.settingsBackup.failedToRead(table, queryError.message));
        }
        rowsByTable[table] = (data as Record<string, unknown>[] | null) ?? [];
      }

      // 2. Every file in both private buckets, grouped into a folder per
      // owning project/contact (project documents further grouped into a
      // "Tranche N" subfolder, or none for General), under its original
      // file name.
      const projects = (rowsByTable.projects ?? []) as unknown as Project[];
      const contacts = (rowsByTable.contacts ?? []) as unknown as Contact[];
      const opportunities = (rowsByTable.opportunities ?? []) as unknown as Opportunity[];
      const projectDocs = (rowsByTable.project_documents ?? []) as unknown as ProjectDocument[];
      const contactDocs = (rowsByTable.contact_documents ?? []) as unknown as ContactDocument[];
      const opportunityDocs = (rowsByTable.opportunity_documents ?? []) as unknown as OpportunityDocument[];
      const notes = (rowsByTable.notes ?? []) as unknown as Note[];
      const noteDocs = (rowsByTable.note_documents ?? []) as unknown as NoteDocument[];
      const templates = (rowsByTable.templates ?? []) as unknown as Template[];
      const templateVersions = (rowsByTable.template_versions ?? []) as unknown as TemplateVersion[];
      const projectTranches = (rowsByTable.project_tranches ?? []) as unknown as ProjectTranche[];

      const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
      const contactNameById = new Map(contacts.map((c) => [c.id, c.full_name]));
      const opportunityTitleById = new Map(opportunities.map((o) => [o.id, o.title]));
      const noteTitleById = new Map(notes.map((n) => [n.id, n.title?.trim() || n.content.slice(0, 60)]));
      const templateNameById = new Map(templates.map((tpl) => [tpl.id, tpl.name]));
      const trancheNumberById = new Map(projectTranches.map((t) => [t.id, t.tranche_number]));

      function trancheSubfolder(trancheId: string | null): string {
        if (!trancheId) return "";
        const number = trancheNumberById.get(trancheId);
        return number != null ? `/Tranche ${number}` : "";
      }

      // The documents CSV gets a derived tranche_number column (the raw
      // tranche_id FK alone isn't useful to someone reading the backup by
      // hand) — written here, now that projectTranches is on hand, rather
      // than in the generic per-table loop above.
      const projectDocsWithTrancheNumber = projectDocs.map((doc) => ({
        ...doc,
        tranche_number: doc.tranche_id ? (trancheNumberById.get(doc.tranche_id) ?? null) : null,
      }));
      for (const table of TABLES) {
        zip.file(`${table}.csv`, toCsv(table === "project_documents" ? projectDocsWithTrancheNumber : rowsByTable[table]!));
      }

      // Link documents (file_path null, url set) have nothing to download —
      // they're already captured in project_documents.csv/contact_documents.csv
      // via the url column.
      const jobs: FileJob[] = [
        ...projectDocs
          .filter((doc) => doc.file_path)
          .map((doc): FileJob => ({
            bucket: "project-documents",
            path: doc.file_path as string,
            zipPath: `project-documents/${folderName(projectNameById.get(doc.project_id) ?? "Unknown project", doc.project_id)}${trancheSubfolder(doc.tranche_id)}/${doc.file_name}`,
          })),
        ...contactDocs
          .filter((doc) => doc.file_path)
          .map((doc): FileJob => ({
            bucket: "contact-documents",
            path: doc.file_path as string,
            zipPath: `contact-documents/${folderName(contactNameById.get(doc.contact_id) ?? "Unknown contact", doc.contact_id)}/${doc.file_name}`,
          })),
        ...opportunityDocs
          .filter((doc) => doc.file_path)
          .map((doc): FileJob => ({
            bucket: "opportunity-documents",
            path: doc.file_path as string,
            zipPath: `opportunity-documents/${folderName(opportunityTitleById.get(doc.opportunity_id) ?? "Unknown opportunity", doc.opportunity_id)}/${doc.file_name}`,
          })),
        ...noteDocs
          .filter((doc) => doc.file_path)
          .map((doc): FileJob => ({
            bucket: "note-documents",
            path: doc.file_path as string,
            zipPath: `note-documents/${folderName(noteTitleById.get(doc.note_id) ?? "Unknown note", doc.note_id)}/${doc.file_name}`,
          })),
        // Every version of every template, named with its own version
        // number (versionedFileName) since several versions can share
        // the same original file name within one template's folder.
        ...templateVersions.map(
          (v): FileJob => ({
            bucket: "templates",
            path: v.file_path,
            zipPath: `templates/${folderName(templateNameById.get(v.template_id) ?? "Unknown template", v.template_id)}/${versionedFileName(v.file_name, v.version_number)}`,
          })
        ),
      ];

      const signedUrlByBucketAndPath = new Map<string, string>();
      for (const bucket of [
        "project-documents",
        "contact-documents",
        "opportunity-documents",
        "note-documents",
        "templates",
      ] as const) {
        const paths = jobs.filter((j) => j.bucket === bucket).map((j) => j.path);
        if (paths.length === 0) continue;

        const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
        if (signError) {
          throw new Error(t.settingsBackup.failedToSign(bucket, signError.message));
        }
        for (const entry of signed ?? []) {
          if (entry.path && entry.signedUrl) {
            signedUrlByBucketAndPath.set(`${bucket}/${entry.path}`, entry.signedUrl);
          }
        }
      }

      const failed: string[] = [];
      setProgress({ current: 0, total: jobs.length });

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        try {
          const url = signedUrlByBucketAndPath.get(`${job.bucket}/${job.path}`);
          if (!url) throw new Error(t.settingsBackup.noSignedUrl);
          const response = await fetch(url);
          if (!response.ok) throw new Error(t.settingsBackup.downloadFailed(response.status));
          zip.file(job.zipPath, await response.blob());
        } catch {
          failed.push(job.zipPath);
        }
        setProgress({ current: i + 1, total: jobs.length });
      }
      setSkipped(failed);

      const zipBlob = await zip.generateAsync({ type: "blob" });

      const { error: logError } = await supabase.rpc("log_backup_export");
      if (logError) {
        // The zip itself is already built — a logging failure shouldn't
        // block the download, just get noted for whoever reads the
        // console (or the Dashboard's "Last backup" indicator, which
        // will simply not move).
        console.error("[ExportBackupButton] failed to log backup export:", logError.message);
      }

      const filename = `ARK-backup-${dateKeyInTimeZone(new Date().toISOString())}.zip`;
      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" onClick={handleExport} disabled={isExporting} className={buttonClass}>
          {isExporting
            ? progress
              ? t.settingsBackup.exportingProgress(progress.current, progress.total)
              : t.settingsBackup.preparing
            : t.settingsBackup.exportButton}
        </button>
        <p className="mt-2 text-xs text-white/35">{t.settingsBackup.hint}</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {skipped.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
          <p className="text-sm font-medium text-red-300">
            {skipped.length === 1 ? t.settingsBackup.skippedOne : t.settingsBackup.skippedMany(skipped.length)}
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-red-300/80">
            {skipped.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
