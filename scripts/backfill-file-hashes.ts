// Backfills file_hash on existing lead_documents / procedure_documents
// rows (added nullable by migration 020, since nothing had a hash before
// it). Downloads each document that has no file_hash yet, computes its
// SHA-256, and writes just that one column.
//
// Dry run by default — reports counts and nothing else. Pass --apply to
// actually write. Never run with --apply without being told to; this
// comment is a reminder for whoever runs it by hand, not an enforced
// check.
//
//   npx tsx scripts/backfill-file-hashes.ts            # dry run (default)
//   npx tsx scripts/backfill-file-hashes.ts --apply     # writes file_hash
//
// (tsx isn't a project dependency — npx fetches it on demand. ts-node
// with --esm works too if you already have that set up instead.)
//
// Guarantees:
//  - Only ever writes the file_hash column, only on rows where it is
//    currently null. No other column, no file in Storage, is ever
//    touched, modified, or deleted — not in dry-run, not with --apply.
//  - migration 020's unique partial index — (lead_id, file_hash) /
//    (procedure_id, file_hash) where file_hash is not null — rejects a
//    second identical-hash document on the same record. When two
//    existing documents on the same record are byte-identical, this
//    script reports the pair instead of crashing: the first one found
//    (oldest by created_at) gets hashed, the rest are listed under
//    "duplicates" and left with file_hash still null. Re-running the
//    script afterwards reports the same pair again — that's expected;
//    resolving it (e.g. deleting the true duplicate) is a judgment call
//    for a person, not something this script does on its own.
//  - A collision against a document hashed in an *earlier* run of this
//    script (not seen in this run because it already has a file_hash and
//    so isn't selected) is instead caught as a unique-violation error
//    from the actual UPDATE in --apply mode, and reported the same way.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface DocumentRow {
  id: string;
  recordId: string;
  filePath: string;
  fileName: string;
  createdAt: string;
}

interface TableConfig {
  label: string;
  table: "lead_documents" | "procedure_documents";
  bucket: "lead-documents" | "procedure-documents";
  recordIdColumn: "lead_id" | "procedure_id";
}

const TABLES: TableConfig[] = [
  { label: "Lead documents", table: "lead_documents", bucket: "lead-documents", recordIdColumn: "lead_id" },
  {
    label: "Procedure documents",
    table: "procedure_documents",
    bucket: "procedure-documents",
    recordIdColumn: "procedure_id",
  },
];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

async function computeFileHash(bytes: Blob): Promise<string> {
  const buffer = await bytes.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function run() {
  const apply = process.argv.includes("--apply");
  const env = { ...loadEnv(), ...process.env };

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env.local and the environment)."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(apply ? "Running with --apply: file_hash WILL be written.\n" : "Dry run — nothing will be written.\n");

  let grandTotalScanned = 0;
  let grandTotalHashed = 0;
  let grandTotalDuplicates = 0;
  let grandTotalFailed = 0;

  for (const config of TABLES) {
    console.log(`=== ${config.label} (${config.table}) ===`);

    const { data, error } = await supabase
      .from(config.table)
      .select(`id, file_path, file_name, created_at, ${config.recordIdColumn}`)
      .is("file_hash", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`  Failed to query ${config.table}:`, error.message);
      continue;
    }

    const rows: DocumentRow[] = (
      (data as Record<string, unknown>[] | null) ?? []
    ).map((row) => ({
      id: row.id as string,
      recordId: row[config.recordIdColumn] as string,
      filePath: row.file_path as string,
      fileName: row.file_name as string,
      createdAt: row.created_at as string,
    }));

    console.log(`  ${rows.length} document(s) with no file_hash yet.`);
    grandTotalScanned += rows.length;

    // recordId -> hash -> the first (oldest) document that claimed it.
    const seenByRecord = new Map<string, Map<string, DocumentRow>>();
    let hashed = 0;
    let duplicates = 0;
    let failed = 0;

    for (const row of rows) {
      let blob: Blob;
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(config.bucket)
          .download(row.filePath);
        if (downloadError || !fileData) {
          throw new Error(downloadError?.message ?? "download returned no data");
        }
        blob = fileData;
      } catch (err) {
        failed += 1;
        console.error(
          `  [failed] ${row.fileName} (${row.id}): could not download "${row.filePath}" — ${
            err instanceof Error ? err.message : err
          }`
        );
        continue;
      }

      const hash = await computeFileHash(blob);

      let seenHashes = seenByRecord.get(row.recordId);
      if (!seenHashes) {
        seenHashes = new Map();
        seenByRecord.set(row.recordId, seenHashes);
      }
      const earlier = seenHashes.get(hash);

      if (earlier) {
        duplicates += 1;
        console.log(
          `  [duplicate] "${row.fileName}" (${row.id}) on record ${row.recordId} is byte-identical to ` +
            `"${earlier.fileName}" (${earlier.id}, created ${earlier.createdAt}) — ` +
            `${apply ? "leaving file_hash null on the newer one." : "would leave file_hash null on the newer one."}`
        );
        continue;
      }
      seenHashes.set(hash, row);

      if (!apply) {
        hashed += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from(config.table)
        .update({ file_hash: hash })
        .eq("id", row.id)
        .is("file_hash", null);

      if (updateError) {
        if (updateError.code === "23505") {
          // A document hashed in an earlier run of this script already
          // holds this hash on this record — same situation as the
          // in-memory duplicate case above, just discovered by the
          // database instead of by us.
          duplicates += 1;
          console.log(
            `  [duplicate] "${row.fileName}" (${row.id}) on record ${row.recordId} matches a hash already ` +
              `recorded on this record from an earlier run — leaving file_hash null.`
          );
        } else {
          failed += 1;
          console.error(`  [failed] ${row.fileName} (${row.id}): ${updateError.message}`);
        }
        continue;
      }

      hashed += 1;
    }

    console.log(
      `  ${config.label}: ${hashed} ${apply ? "hashed" : "would be hashed"}, ${duplicates} duplicate(s), ${failed} failed.\n`
    );
    grandTotalHashed += hashed;
    grandTotalDuplicates += duplicates;
    grandTotalFailed += failed;
  }

  console.log("=== Summary ===");
  console.log(`Scanned:    ${grandTotalScanned}`);
  console.log(`${apply ? "Hashed" : "Would hash"}:     ${grandTotalHashed}`);
  console.log(`Duplicates: ${grandTotalDuplicates} (left with file_hash null — see lines above)`);
  console.log(`Failed:     ${grandTotalFailed}`);
  if (!apply) {
    console.log("\nThis was a dry run. Re-run with --apply to actually write file_hash.");
  }
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exitCode = 1;
});
