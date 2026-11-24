// Shared helpers for the app's private Storage bucket (project-documents).
// Pure/path helpers work in both server and client code;
// uploadFileWithProgress is browser-only (XMLHttpRequest) and is only ever
// called from "use client" components. computeFileHash runs anywhere the
// standard Web Crypto API is available — browsers and plain `node`/`tsx`
// scripts — so the same function is used client-side before upload and
// in scripts/backfill-file-hashes.ts.

// Storage object keys can't contain most punctuation reliably across
// clients, so strip the file name down before prefixing it with a uuid.
export function buildDocumentPath(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return `${crypto.randomUUID()}-${safeName}`;
}

const UUID_PREFIX_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

// Strips the leading uuid- prefix added by buildDocumentPath, for display.
export function displayFileName(path: string): string {
  return path.replace(UUID_PREFIX_PATTERN, "") || path;
}

// ----------------------------------------------------------------------------
// Allowed file types (supabase/migrations/020_media_uploads.sql sets the
// matching allowed_mime_types/file_size_limit on both storage buckets —
// these constants are the client-side mirror, so a bad file is rejected
// before an upload even starts).
// ----------------------------------------------------------------------------

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = 50;

// Extension -> canonical MIME type. Used both to validate a picked file
// and to set an explicit Content-Type on upload, instead of trusting
// File.type — browsers/OSes report HEIC and MOV inconsistently (or not at
// all), and the storage bucket's allowed_mime_types check is only as good
// as the header we send it.
const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Templates only (see TEMPLATE_FILE_ACCEPT/isAllowedTemplateFile
  // below) — not added to the other document buckets' own allowed
  // types, since the shared DOCUMENT_FILE_ACCEPT/isAllowedDocumentFile
  // pair below stays exactly as narrow as project-documents/
  // opportunity-documents/note-documents' own bucket-level
  // allowed_mime_types, which none of these three extend to.
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  txt: "text/plain",
};

// Broad enough (image/*, video/*) that iOS/Android show the camera roll
// and camera as picker options, plus explicit extensions for desktop file
// dialogs. isAllowedDocumentFile() is the real gate — this is only a UI
// hint.
export const DOCUMENT_FILE_ACCEPT =
  ".pdf,application/pdf,image/*,video/*,.heic,.heif,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileExtension(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
}

export type DocumentKind = "pdf" | "image" | "heic" | "video" | "doc" | "other";

// Drives preview rendering (components/projects/project-documents.tsx,
// components/receivers/receiver-documents.tsx): "image" gets a thumbnail,
// "video" gets a built-in player, "heic" can't reliably be shown inline by
// a browser so it falls back to a plain file icon + Download.
export function getDocumentKind(fileName: string): DocumentKind {
  const ext = fileExtension(fileName);
  if (ext === "pdf") return "pdf";
  if (ext === "jpg" || ext === "jpeg" || ext === "png") return "image";
  if (ext === "heic" || ext === "heif") return "heic";
  if (ext === "mp4" || ext === "mov") return "video";
  if (ext === "doc" || ext === "docx" || ext === "xls" || ext === "xlsx" || ext === "odt" || ext === "txt") return "doc";
  return "other";
}

export function isAllowedDocumentFile(file: File): boolean {
  return DOCUMENT_EXTENSIONS.has(fileExtension(file.name));
}

// project-documents/contact-documents/opportunity-documents/note-
// documents' own shared allowed set — narrower than EXTENSION_MIME as
// a whole, which also carries the templates-only extensions below.
const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "mp4",
  "mov",
  "doc",
  "docx",
]);

// Templates (supabase/migrations/036_templates.sql's own bucket):
// office documents and plain text, plus images — no video, no HEIC
// (a template is an authored document, not a phone-camera capture).
const TEMPLATE_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "odt", "txt", "jpg", "jpeg", "png"]);

export const TEMPLATE_FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.odt,.txt,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.text,text/plain,image/jpeg,image/png";

export function isAllowedTemplateFile(file: File): boolean {
  return TEMPLATE_EXTENSIONS.has(fileExtension(file.name));
}

// The Content-Type to send on upload — always derived from the file's
// extension (see EXTENSION_MIME above), falling back to whatever the
// browser reported only for an extension we don't recognize.
export function contentTypeForFile(file: File): string {
  return EXTENSION_MIME[fileExtension(file.name)] ?? file.type ?? "application/octet-stream";
}

export function formatFileSizeMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The extension actually on a file name, or "" if it has none — unlike
// fileExtension() above (which falls back to the whole string when
// there's no dot, fine for its own MIME-lookup use but wrong here).
function extractExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1);
}

// Renaming a document (inbox items, project/contact documents) keeps
// the storage file untouched — only the display name changes — but a
// user retyping "Invoice" shouldn't lose the ".pdf" that made it
// recognizable. If currentFileName has an extension and the typed
// newName doesn't already end with that same one (case-insensitive),
// it's appended; a currentFileName with no extension (or a blank
// newName) is left alone.
// Templates (supabase/migrations/036_templates.sql) only: "Downloads
// keep the original file name, with the version added: 'PGL Sender
// (v3).docx'" — inserted right before the extension; a file with no
// extension just gets the suffix appended. Used both server-side
// (app/(app)/templates/page.tsx, as the `download` filename on each
// version's signed URL) and client-side (components/settings/export-
// backup-button.tsx's zip folder naming) — plain string math, no
// server-only dependency either way.
export function versionedFileName(fileName: string, versionNumber: number): string {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) return `${fileName} (v${versionNumber})`;
  return `${fileName.slice(0, idx)} (v${versionNumber})${fileName.slice(idx)}`;
}

export function withPreservedExtension(currentFileName: string, newName: string): string {
  const trimmed = newName.trim();
  if (!trimmed) return currentFileName;
  const ext = extractExtension(currentFileName);
  if (!ext) return trimmed;
  if (trimmed.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) return trimmed;
  return `${trimmed}.${ext}`;
}

// SHA-256 of a file's bytes, as lowercase hex — used to detect the exact
// same file being attached twice (see 001_ark_schema.sql's file_hash
// column and unique partial index). Takes a Blob/File directly (a
// <input type="file">'s File, or a Blob downloaded from Storage) or raw
// bytes, so callers don't need to know which shape they have on hand.
export async function computeFileHash(source: Blob | ArrayBuffer): Promise<string> {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Uploads directly to a private Supabase Storage bucket via XHR (instead of
// the supabase-js client) so we get real byte-level progress events, which
// the fetch-based storage-js upload doesn't expose.
export function uploadFileWithProgress(
  bucket: string,
  file: File,
  path: string,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("Content-Type", contentTypeForFile(file));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let message = `Upload failed (${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) message = body.message;
        } catch {
          // ignore unparsable error body
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}
