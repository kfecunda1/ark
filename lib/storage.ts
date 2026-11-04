// Shared helpers for the app's private Storage bucket (lead-documents).
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

// SHA-256 of a file's bytes, as lowercase hex — used to detect the exact
// same file being attached twice (see migration 020's file_hash columns
// and unique partial indexes). Takes a Blob/File directly (a <input
// type="file">'s File, or a Blob downloaded from Storage) or raw bytes,
// so callers don't need to know which shape they have on hand.
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
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

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
