import { createClient } from "@/lib/supabase/server";

// Both private buckets (supabase/migrations/001_ark_schema.sql,
// 003_contacts_upgrade.sql) hold every file flat at the bucket root
// (buildDocumentPath in lib/storage.ts never nests into folders), so a
// single non-recursive list() per bucket, paginated, sees every file.
const BUCKETS = ["project-documents", "contact-documents"] as const;
const PAGE_SIZE = 1000;

// Matches Supabase's free-plan Storage limit — see Settings' storage
// meter (components/settings/storage-meter.tsx).
export const STORAGE_LIMIT_MB = 1024;

// Sums Storage's own per-file size metadata (via the same list() API the
// Storage UI itself uses) rather than project_documents/contact_
// documents.file_hash or any DB column — this reports actual bytes
// stored, which is what a plan limit is measured against.
export async function getStorageUsedBytes(): Promise<number> {
  const supabase = await createClient();
  let total = 0;

  for (const bucket of BUCKETS) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list("", { limit: PAGE_SIZE, offset });
      if (error || !data) break;

      for (const entry of data) {
        const size = (entry.metadata as { size?: number } | null)?.size;
        if (typeof size === "number") total += size;
      }

      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return total;
}
