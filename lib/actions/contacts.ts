"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import type { Contact, ContactDocumentType, ProductType } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ContactFormState {
  error: string | null;
}

// See the matching helper in lib/actions/projects.ts: converts a
// genuinely unexpected exception (network failure, …) into the same
// returned-error shape every normal Supabase-error path already uses,
// so callers never see a save silently fail.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

function buildContactPayload(formData: FormData) {
  const fullName = formData.get("full_name")?.toString().trim();
  if (!fullName) {
    throw new Error('"Full Name" is required.');
  }

  return {
    full_name: fullName,
    notes: formData.get("notes")?.toString().trim() || null,
    contact_person_id: formData.get("contact_person_id")?.toString().trim() || null,
  };
}

// ----------------------------------------------------------------------------
// Products & ratios — submitted as parallel same-named field arrays:
// product_id (empty string for new rows), product_type, product_ratio,
// product_notes, paired by index. One row per product (the DB's unique
// (contact_id, product_type) is the backstop; the form's ProductFields
// also only ever offers a product once).
// ----------------------------------------------------------------------------

interface SubmittedProduct {
  id: string | null;
  product_type: ProductType;
  ratio: string | null;
  recovery_ratio: string | null;
  notes: string | null;
}

function parseSubmittedProducts(formData: FormData): SubmittedProduct[] {
  const ids = formData.getAll("product_id").map((v) => v.toString());
  const types = formData.getAll("product_type_row").map((v) => v.toString());
  const ratios = formData.getAll("product_ratio").map((v) => v.toString().trim());
  const recoveryRatios = formData.getAll("product_recovery_ratio").map((v) => v.toString().trim());
  const notes = formData.getAll("product_notes").map((v) => v.toString().trim());

  return types
    .map((product_type, i) => ({
      id: ids[i]?.trim() || null,
      product_type: product_type as ProductType,
      ratio: ratios[i] || null,
      recovery_ratio: recoveryRatios[i] || null,
      notes: notes[i] || null,
    }))
    .filter((p) => p.product_type);
}

async function syncContactProducts(
  supabase: SupabaseServerClient,
  contactId: string,
  submitted: SubmittedProduct[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("contact_products")
    .select("id, product_type, ratio, recovery_ratio, notes")
    .eq("contact_id", contactId);

  const existingById = new Map(
    (
      (existing as
        | { id: string; product_type: ProductType; ratio: string | null; recovery_ratio: string | null; notes: string | null }[]
        | null) ?? []
    ).map((p) => [p.id, p])
  );
  const submittedIds = new Set(submitted.filter((p) => p.id).map((p) => p.id));

  const idsToDelete = [...existingById.keys()].filter((id) => !submittedIds.has(id));
  const toInsert = submitted
    .filter((p) => !p.id)
    .map((p) => ({
      contact_id: contactId,
      product_type: p.product_type,
      ratio: p.ratio,
      recovery_ratio: p.recovery_ratio,
      notes: p.notes,
    }));
  const toUpdate = submitted.filter((p) => {
    if (!p.id) return false;
    const existingProduct = existingById.get(p.id);
    return (
      existingProduct &&
      (existingProduct.product_type !== p.product_type ||
        existingProduct.ratio !== p.ratio ||
        existingProduct.recovery_ratio !== p.recovery_ratio ||
        existingProduct.notes !== p.notes)
    );
  });

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("contact_products").delete().in("id", idsToDelete);
    if (error) console.error("[syncContactProducts] failed to delete products:", error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("contact_products").insert(toInsert);
    if (error) console.error("[syncContactProducts] failed to insert products:", error.message);
  }

  for (const product of toUpdate) {
    const { error } = await supabase
      .from("contact_products")
      .update({
        product_type: product.product_type,
        ratio: product.ratio,
        recovery_ratio: product.recovery_ratio,
        notes: product.notes,
      })
      .eq("id", product.id!);
    if (error) console.error("[syncContactProducts] failed to update product:", error.message);
  }
}

// Returns the new contact's id instead of redirecting, so the caller
// (the New Contact form's Documents section) can upload staged
// documents — which needs the contact's id — before navigating. Same
// pattern as lib/actions/projects.ts's createProjectWithId.
export async function createContactWithId(
  formData: FormData
): Promise<{ id: string | null; error: string | null }> {
  let payload;
  try {
    payload = buildContactPayload(formData);
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("contacts").insert(payload).select("id").single();

    if (error || !data) {
      return { id: null, error: error?.message ?? "Failed to create receiver." };
    }
    const newId: string = data.id;

    const products = parseSubmittedProducts(formData);
    if (products.length > 0) {
      const { error: productError } = await supabase.from("contact_products").insert(
        products.map((p) => ({
          contact_id: newId,
          product_type: p.product_type,
          ratio: p.ratio,
          recovery_ratio: p.recovery_ratio,
          notes: p.notes,
        }))
      );
      if (productError) {
        console.error("[createContactWithId] failed to insert products:", productError.message);
      }
    }

    revalidatePath("/receivers");
    return { id: newId, error: null };
  } catch (err) {
    return { id: null, error: unexpectedErrorMessage(err) };
  }
}

export async function updateContact(
  id: string,
  _prevState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  let payload;
  try {
    payload = buildContactPayload(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid form data." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contacts").update(payload).eq("id", id);

    if (error) {
      return { error: error.message };
    }

    await syncContactProducts(supabase, id, parseSubmittedProducts(formData));
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }

  revalidatePath("/receivers");
  revalidatePath(`/receivers/${id}`);
  redirect(`/receivers/${id}`);
}

// The Receiver detail page's inline Contact Person quick-editor
// (components/contact-person-select.tsx) — a plain optional link, no
// side effect beyond itself.
export async function updateContactPerson(contactId: string, personId: string | null): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contacts").update({ contact_person_id: personId }).eq("id", contactId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/receivers");
    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// The detail page's Archive toggle (components/archive-toggle-
// button.tsx, via lib/actions/archive.ts's setArchived dispatcher) —
// everyone can archive/unarchive, unlike delete below. Archiving never
// touches any other row: an archived receiver stays exactly as linked
// as it was, just hidden from new-entry pickers, lists, and search.
export async function toggleContactArchived(id: string, archived: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("contacts")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/receivers");
    revalidatePath(`/receivers/${id}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Admin-only (also enforced by the contacts_delete_admin RLS policy,
// supabase/migrations/017_archive_receivers_people.sql — this app-level
// check just turns a denied RLS delete into a clean message instead of
// a raw Postgres error). Blocked outright while any project is still
// matched with this receiver — archiving or unlinking first is the
// only way past that, same spirit as every other "warning, don't
// silently cascade" rule in this app, just upgraded to a hard block
// since there's no undoing a delete. contact_products/contact_documents/
// notes rows cascade-delete with the contacts row (on delete cascade,
// 001_ark_schema.sql / 003_contacts_upgrade.sql); documents' storage
// files can't cascade with them, so those are removed afterward, same
// order as deleteContactDocument above (DB row gone first, storage
// cleanup is best-effort and never blocks the delete from completing).
export async function deleteContact(id: string): Promise<{ error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) {
      return { error: "Only admins can delete receivers." };
    }

    const supabase = await createClient();

    const { count: projectCount } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("matched_contact_id", id);

    if ((projectCount ?? 0) > 0) {
      return {
        error: `Linked to ${projectCount} project${projectCount === 1 ? "" : "s"}. Archive instead, or unlink first.`,
      };
    }

    const { data: documents } = await supabase.from("contact_documents").select("file_path").eq("contact_id", id);
    const filePaths = ((documents as { file_path: string | null }[] | null) ?? [])
      .map((d) => d.file_path)
      .filter((p): p is string => Boolean(p));

    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) {
      return { error: error.message };
    }

    if (filePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from("contact-documents").remove(filePaths);
      if (storageError) {
        console.error("[deleteContact] failed to remove storage files:", storageError.message);
      }
    }

    revalidatePath("/receivers");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Used by the Entity Picker's inline "+ New Receiver" flow: creates a
// contact without redirecting so the caller can select it immediately.
export async function quickCreateContact(input: { full_name: string }): Promise<{
  contact: Contact | null;
  error: string | null;
}> {
  const fullName = input.full_name.trim();
  if (!fullName) {
    return { contact: null, error: "Name is required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({ full_name: fullName })
      .select("*")
      .single();

    if (error || !data) {
      return { contact: null, error: error?.message ?? "Failed to create receiver." };
    }

    revalidatePath("/receivers");
    return { contact: data as Contact, error: null };
  } catch (err) {
    return { contact: null, error: unexpectedErrorMessage(err) };
  }
}

// Updates a single product row from the contact detail page's inline
// Products & Ratios section (as opposed to the full edit form above,
// which syncs every row at once on save).
export async function upsertContactProduct(
  contactId: string,
  productType: ProductType,
  ratio: string,
  recoveryRatio: string,
  notes: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contact_products").upsert(
      {
        contact_id: contactId,
        product_type: productType,
        ratio: ratio.trim() || null,
        recovery_ratio: recoveryRatio.trim() || null,
        notes: notes.trim() || null,
      },
      { onConflict: "contact_id,product_type" }
    );

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteContactProduct(contactId: string, productId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contact_products").delete().eq("id", productId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Documents — same pattern as lib/actions/projects.ts's document
// functions, just owned by a contact and stored in the
// "contact-documents" bucket.
// ----------------------------------------------------------------------------

export async function addContactDocument(
  contactId: string,
  documentType: ContactDocumentType,
  filePath: string,
  fileName: string,
  fileHash: string | null
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contact_documents").insert({
      contact_id: contactId,
      document_type: documentType,
      file_path: filePath,
      file_name: fileName,
      file_hash: fileHash,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// A link to a file kept elsewhere, instead of an upload — see
// addProjectDocumentLink in lib/actions/projects.ts for the same shape.
export async function addContactDocumentLink(
  contactId: string,
  documentType: ContactDocumentType,
  name: string,
  url: string
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("contact_documents").insert({
      contact_id: contactId,
      document_type: documentType,
      file_name: name,
      url,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteContactDocument(documentId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("contact_documents")
      .select("contact_id, file_path")
      .eq("id", documentId)
      .maybeSingle();

    const { error } = await supabase.from("contact_documents").delete().eq("id", documentId);

    if (error) {
      return { error: error.message };
    }

    if (existing?.file_path) {
      const { error: storageError } = await supabase.storage
        .from("contact-documents")
        .remove([existing.file_path]);
      if (storageError) {
        console.error("[deleteContactDocument] failed to remove storage file:", storageError.message);
      }
    }

    if (existing?.contact_id) {
      revalidatePath(`/receivers/${existing.contact_id}`);
    }
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export interface ContactDocumentHashMatch {
  documentId: string;
  contactId: string;
  contactLabel: string;
  fileName: string;
}

export async function findContactDocumentsByHash(hash: string): Promise<ContactDocumentHashMatch[]> {
  if (!hash) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contact_documents")
      .select("id, contact_id, file_name")
      .eq("file_hash", hash);

    if (error) {
      console.error("[findContactDocumentsByHash] query failed:", error.message);
      return [];
    }

    const rows = (data as { id: string; contact_id: string; file_name: string }[] | null) ?? [];
    if (rows.length === 0) return [];

    const contactIds = [...new Set(rows.map((r) => r.contact_id))];
    const { data: contactsData } = await supabase.from("contacts").select("id, full_name").in("id", contactIds);
    const contactNameById = new Map(
      ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
    );

    return rows.map((row) => ({
      documentId: row.id,
      contactId: row.contact_id,
      contactLabel: contactNameById.get(row.contact_id) ?? "Receiver",
      fileName: row.file_name,
    }));
  } catch (err) {
    console.error("[findContactDocumentsByHash] unexpected error:", unexpectedErrorMessage(err));
    return [];
  }
}

// ----------------------------------------------------------------------------
// Notes — adds a note directly from the contact detail page without
// leaving it, unlike lib/actions/notes.ts's createNote (which redirects
// to /notes, right for the standalone New Note page it's meant for).
// ----------------------------------------------------------------------------

export async function addContactNote(
  contactId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const content = formData.get("content")?.toString().trim();
  if (!content) {
    return { error: '"Content" is required.' };
  }

  const isReminder = formData.get("is_reminder") === "on";
  const dueDate = formData.get("due_date")?.toString().trim() || null;
  if (isReminder && !dueDate) {
    return { error: '"Due date" is required for a reminder.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("notes").insert({
      title: formData.get("title")?.toString().trim() || null,
      content,
      is_reminder: isReminder,
      due_date: isReminder ? dueDate : null,
      contact_id: contactId,
      created_by: user?.id ?? null,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${contactId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Ratio lookup — read-only, used by the ratio auto-fill (see
// components/projects/project-form.tsx and updateProjectMatchedContact
// in lib/actions/projects.ts). Never writes anything itself.
// ----------------------------------------------------------------------------

export interface ContactProductRatio {
  // Already resolved to whichever column applies, per the caller's
  // `isRecovery` — recovery_ratio when true, ratio when false. Callers
  // never need to know which column backed it, only the matching
  // "no ratio set" / "no recovery ratio set" wording (see
  // lib/actions/projects.ts's autoFillRatio).
  ratio: string | null;
  contactName: string | null;
}

export async function getContactProductRatio(
  contactId: string,
  productType: ProductType,
  isRecovery: boolean
): Promise<ContactProductRatio> {
  try {
    const supabase = await createClient();
    const [{ data: product }, { data: contact }] = await Promise.all([
      supabase
        .from("contact_products")
        .select("ratio, recovery_ratio")
        .eq("contact_id", contactId)
        .eq("product_type", productType)
        .maybeSingle(),
      supabase.from("contacts").select("full_name").eq("id", contactId).maybeSingle(),
    ]);

    const row = product as { ratio: string | null; recovery_ratio: string | null } | null;
    return {
      ratio: (isRecovery ? row?.recovery_ratio : row?.ratio) ?? null,
      contactName: (contact as { full_name: string } | null)?.full_name ?? null,
    };
  } catch (err) {
    console.error("[getContactProductRatio] unexpected error:", unexpectedErrorMessage(err));
    return { ratio: null, contactName: null };
  }
}

// Batched sibling of getContactProductRatio — used by
// components/projects/project-product-options.tsx and the create/edit
// form's own client-side preview to show the matched contact's ratio
// for *every* undecided option at once (information only, never
// written anywhere) instead of one round trip per option.
export async function getContactProductRatios(
  contactId: string,
  productTypes: ProductType[],
  isRecovery: boolean
): Promise<Record<string, string | null>> {
  if (productTypes.length === 0) return {};

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contact_products")
      .select("product_type, ratio, recovery_ratio")
      .eq("contact_id", contactId)
      .in("product_type", productTypes);

    if (error) {
      console.error("[getContactProductRatios] query failed:", error.message);
      return {};
    }

    const rows = (data as { product_type: ProductType; ratio: string | null; recovery_ratio: string | null }[] | null) ?? [];
    return Object.fromEntries(rows.map((row) => [row.product_type, (isRecovery ? row.recovery_ratio : row.ratio) ?? null]));
  } catch (err) {
    console.error("[getContactProductRatios] unexpected error:", unexpectedErrorMessage(err));
    return {};
  }
}
