"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS } from "@/lib/leads";
import type { BusinessLine, Contact, LeadDocumentType, LeadPriority, LeadStage } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface LeadFormState {
  error: string | null;
}

const REQUIRED_FIELDS = ["business_line", "product_type", "procedure_type"] as const;

function buildLeadPayload(formData: FormData) {
  for (const field of REQUIRED_FIELDS) {
    if (!formData.get(field)?.toString().trim()) {
      throw new Error(`"${field.replace(/_/g, " ")}" is required.`);
    }
  }

  const primaryContactId = formData.get("primary_contact_id")?.toString().trim();
  if (!primaryContactId) {
    throw new Error('"Primary Contact" is required.');
  }

  const dealValueRaw = formData.get("deal_value")?.toString().trim();
  const followUpRaw = formData.get("follow_up_date")?.toString().trim();
  const assignedToRaw = formData.get("assigned_to")?.toString().trim();
  const counterpartyContactId = formData.get("counterparty_contact_id")?.toString().trim();

  return {
    business_line: formData.get("business_line") as BusinessLine,
    product_type: (formData.get("product_type") as string).trim(),
    procedure_type: (formData.get("procedure_type") as string).trim(),
    priority: formData.get("priority") as LeadPriority,
    stage: formData.get("stage") as LeadStage,
    primary_contact_id: primaryContactId,
    counterparty_contact_id: counterpartyContactId || null,
    deal_value: dealValueRaw ? Number(dealValueRaw) : null,
    currency: formData.get("currency")?.toString().trim() || null,
    source: formData.get("source")?.toString().trim() || null,
    notes: formData.get("notes")?.toString().trim() || null,
    follow_up_date: followUpRaw || null,
    assigned_to: assignedToRaw || null,
  };
}

// Wallet rows are submitted as parallel same-named field arrays: wallet_id
// (empty string for new rows), wallet_address, and wallet_label, paired by
// index. Same pattern as procedure wallets.
function parseSubmittedWallets(
  formData: FormData
): { id: string | null; address: string; label: string | null }[] {
  const ids = formData.getAll("wallet_id").map((v) => v.toString());
  const addresses = formData.getAll("wallet_address").map((v) => v.toString().trim());
  const labels = formData.getAll("wallet_label").map((v) => v.toString().trim());

  return addresses
    .map((address, i) => ({ id: ids[i]?.trim() || null, address, label: labels[i] || null }))
    .filter((w) => w.address);
}

async function syncLeadWallets(
  supabase: SupabaseServerClient,
  leadId: string,
  submitted: { id: string | null; address: string; label: string | null }[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("lead_wallets")
    .select("id, wallet_address, label")
    .eq("lead_id", leadId);

  const existingById = new Map(
    ((existing as { id: string; wallet_address: string; label: string | null }[] | null) ?? []).map((w) => [
      w.id,
      w,
    ])
  );
  const submittedIds = new Set(submitted.filter((w) => w.id).map((w) => w.id));

  const idsToDelete = [...existingById.keys()].filter((id) => !submittedIds.has(id));
  const toInsert = submitted
    .filter((w) => !w.id)
    .map((w) => ({ lead_id: leadId, wallet_address: w.address, label: w.label }));
  const toUpdate = submitted.filter((w) => {
    if (!w.id) return false;
    const existingWallet = existingById.get(w.id);
    return existingWallet && (existingWallet.wallet_address !== w.address || existingWallet.label !== w.label);
  });

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("lead_wallets").delete().in("id", idsToDelete);
    if (error) console.error("[syncLeadWallets] failed to delete wallets:", error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("lead_wallets").insert(toInsert);
    if (error) console.error("[syncLeadWallets] failed to insert wallets:", error.message);
  }

  for (const wallet of toUpdate) {
    const { error } = await supabase
      .from("lead_wallets")
      .update({ wallet_address: wallet.address, label: wallet.label })
      .eq("id", wallet.id!);
    if (error) console.error("[syncLeadWallets] failed to update wallet:", error.message);
  }
}

// Returns the new lead's id instead of redirecting, so the caller can
// upload staged documents (which needs the lead's id) before navigating.
export async function createLeadWithId(
  formData: FormData
): Promise<{ id: string | null; error: string | null }> {
  let payload;
  try {
    payload = buildLeadPayload(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "Invalid form data." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").insert(payload).select("id").single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Failed to create lead." };
  }

  const wallets = parseSubmittedWallets(formData);
  if (wallets.length > 0) {
    const { error: walletError } = await supabase
      .from("lead_wallets")
      .insert(wallets.map((w) => ({ lead_id: data.id, wallet_address: w.address, label: w.label })));
    if (walletError) {
      console.error("[createLeadWithId] failed to insert wallets:", walletError.message);
    }
  }

  revalidatePath("/leads");
  return { id: data.id, error: null };
}

export async function updateLead(
  id: string,
  _prevState: LeadFormState,
  formData: FormData
): Promise<LeadFormState> {
  let payload;
  try {
    payload = buildLeadPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(payload).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  await syncLeadWallets(supabase, id, parseSubmittedWallets(formData));

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}`);
}

export async function updateLeadStage(
  id: string,
  stage: LeadStage
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ stage }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  return { error: null };
}

export async function toggleLeadArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ archived }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function addLeadDocument(
  leadId: string,
  documentType: LeadDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("lead_documents").insert({
    lead_id: leadId,
    document_type: documentType,
    file_path: filePath,
    file_name: fileName,
    file_hash: fileHash,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/leads/${leadId}`);
  return { error: null };
}

export async function deleteLeadDocument(documentId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("lead_documents")
    .select("lead_id, file_path")
    .eq("id", documentId)
    .maybeSingle();

  const { error } = await supabase.from("lead_documents").delete().eq("id", documentId);

  if (error) {
    return { error: error.message };
  }

  if (existing?.file_path) {
    const { error: storageError } = await supabase.storage
      .from("lead-documents")
      .remove([existing.file_path]);
    if (storageError) {
      console.error("[deleteLeadDocument] failed to remove storage file:", storageError.message);
    }
  }

  if (existing?.lead_id) {
    revalidatePath(`/leads/${existing.lead_id}`);
  }
  return { error: null };
}

// Same "primary contact name, else product type" label the activity log
// (migration 019's activity_lead_label) and the reminders digest already
// use — kept as a small local helper rather than a shared export since
// callers here already have the contact rows in hand.
function leadLabel(lead: { product_type: string }, contactName: string | null): string {
  return contactName || lead.product_type || "Lead";
}

export interface LeadDocumentHashMatch {
  documentId: string;
  leadId: string;
  fileName: string;
  leadLabel: string;
}

// Every lead_documents row with this exact file_hash, across all leads.
// The caller (the upload UI) decides what "same record" vs "a different
// record" means by comparing leadId against the lead it's uploading to —
// for a brand-new lead that doesn't exist yet, every match is necessarily
// "a different record".
export async function findLeadDocumentsByHash(hash: string): Promise<LeadDocumentHashMatch[]> {
  if (!hash) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_documents")
    .select("id, lead_id, file_name")
    .eq("file_hash", hash);

  if (error) {
    console.error("[findLeadDocumentsByHash] query failed:", error.message);
    return [];
  }

  const rows = (data as { id: string; lead_id: string; file_name: string }[] | null) ?? [];
  if (rows.length === 0) return [];

  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: leadsData } = await supabase
    .from("leads")
    .select("id, product_type, primary_contact_id")
    .in("id", leadIds);
  const leads = (leadsData as { id: string; product_type: string; primary_contact_id: string | null }[] | null) ?? [];
  const leadsById = new Map(leads.map((l) => [l.id, l]));

  const contactIds = leads.map((l) => l.primary_contact_id).filter((id): id is string => Boolean(id));
  let contactNameById = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase.from("contacts").select("id, full_name").in("id", contactIds);
    contactNameById = new Map(((contactsData as Pick<Contact, "id" | "full_name">[] | null) ?? []).map((c) => [c.id, c.full_name]));
  }

  return rows.map((row) => {
    const lead = leadsById.get(row.lead_id);
    const contactName = lead?.primary_contact_id ? (contactNameById.get(lead.primary_contact_id) ?? null) : null;
    return {
      documentId: row.id,
      leadId: row.lead_id,
      fileName: row.file_name,
      leadLabel: lead ? leadLabel(lead, contactName) : "Lead",
    };
  });
}

export interface DuplicateLeadMatch {
  id: string;
  label: string;
  meta: string;
}

// Leads sharing the same primary contact + business line + product type +
// procedure type (the latter two compared trimmed and case-insensitively)
// as the one about to be created. Scans every lead regardless of archived
// state or stage — including a closed-out duplicate is still useful
// information — and the caller is told the stage/archived state of each
// so it can show that in the warning.
export async function findDuplicateLeads(input: {
  primaryContactId: string;
  businessLine: BusinessLine;
  productType: string;
  procedureType: string;
}): Promise<DuplicateLeadMatch[]> {
  const productType = input.productType.trim().toLowerCase();
  const procedureType = input.procedureType.trim().toLowerCase();
  if (!input.primaryContactId || !productType || !procedureType) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, product_type, procedure_type, stage, archived")
    .eq("primary_contact_id", input.primaryContactId)
    .eq("business_line", input.businessLine);

  if (error) {
    console.error("[findDuplicateLeads] query failed:", error.message);
    return [];
  }

  const rows =
    (data as { id: string; product_type: string; procedure_type: string; stage: LeadStage; archived: boolean }[] | null) ??
    [];

  const matches = rows.filter(
    (row) =>
      row.product_type.trim().toLowerCase() === productType &&
      row.procedure_type.trim().toLowerCase() === procedureType
  );
  if (matches.length === 0) return [];

  const { data: contactData } = await supabase
    .from("contacts")
    .select("full_name")
    .eq("id", input.primaryContactId)
    .maybeSingle();
  const contactName = (contactData as { full_name: string } | null)?.full_name ?? null;

  return matches.map((row) => ({
    id: row.id,
    label: leadLabel(row, contactName),
    meta: row.archived ? `Archived · ${STAGE_LABELS[row.stage]}` : STAGE_LABELS[row.stage],
  }));
}
