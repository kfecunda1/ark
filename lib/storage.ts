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
  if (ext === "doc" || ext === "docx") return "doc";
  return "other";
}

export function isAllowedDocumentFile(file: File): boolean {
  return fileExtension(file.name) in EXTENSION_MIME;
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
