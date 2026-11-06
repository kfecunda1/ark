"use client";

import { useState } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import type { Contact, ContactDocument, Project, ProjectDocument } from "@/lib/types";

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
  "project_documents",
  "contact_documents",
  "activity_log",
] as const;

interface FileJob {
  bucket: "project-documents" | "contact-documents";
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

export function ExportBackupButton() {
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

      // 1. One CSV per table.
      const rowsByTable: Partial<Record<(typeof TABLES)[number], Record<string, unknown>[]>> = {};
      for (const table of TABLES) {
        const { data, error: queryError } = await supabase.from(table).select("*");
        if (queryError) {
          throw new Error(`Failed to read "${table}": ${queryError.message}`);
        }
        const rows = (data as Record<string, unknown>[] | null) ?? [];
        rowsByTable[table] = rows;
        zip.file(`${table}.csv`, toCsv(rows));
      }

      // 2. Every file in both private buckets, grouped into a folder per
      // owning project/contact, under its original file name.
      const projects = (rowsByTable.projects ?? []) as unknown as Project[];
      const contacts = (rowsByTable.contacts ?? []) as unknown as Contact[];
      const projectDocs = (rowsByTable.project_documents ?? []) as unknown as ProjectDocument[];
      const contactDocs = (rowsByTable.contact_documents ?? []) as unknown as ContactDocument[];

      const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
      const contactNameById = new Map(contacts.map((c) => [c.id, c.full_name]));

      const jobs: FileJob[] = [
        ...projectDocs.map((doc): FileJob => ({
          bucket: "project-documents",
          path: doc.file_path,
          zipPath: `project-documents/${folderName(projectNameById.get(doc.project_id) ?? "Unknown project", doc.project_id)}/${doc.file_name}`,
        })),
        ...contactDocs.map((doc): FileJob => ({
          bucket: "contact-documents",
          path: doc.file_path,
          zipPath: `contact-documents/${folderName(contactNameById.get(doc.contact_id) ?? "Unknown contact", doc.contact_id)}/${doc.file_name}`,
        })),
      ];

      const signedUrlByBucketAndPath = new Map<string, string>();
      for (const bucket of ["project-documents", "contact-documents"] as const) {
        const paths = jobs.filter((j) => j.bucket === bucket).map((j) => j.path);
        if (paths.length === 0) continue;

        const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
        if (signError) {
          throw new Error(`Failed to sign download URLs for ${bucket}: ${signError.message}`);
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
          if (!url) throw new Error("No signed URL was returned for this file.");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Download failed (${response.status}).`);
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
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
              ? `Exporting ${progress.current} of ${progress.total} files…`
              : "Preparing export…"
            : "Export everything"}
        </button>
        <p className="mt-2 text-xs text-white/35">
          Downloads a ZIP with one CSV per table plus every file in Documents, as a backup you keep yourself.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {skipped.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
          <p className="text-sm font-medium text-red-300">
            {skipped.length === 1
              ? "1 file was skipped (the rest of the export still downloaded):"
              : `${skipped.length} files were skipped (the rest of the export still downloaded):`}
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
