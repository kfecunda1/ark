import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ArchivedBadge } from "@/components/archived-badge";
import { ArchiveToggleButton } from "@/components/archive-toggle-button";
import { ReceiverProductsSection } from "@/components/receivers/receiver-products-section";
import { ReceiverDocuments } from "@/components/receivers/receiver-documents";
import { ReceiverNotesSection } from "@/components/receivers/receiver-notes-section";
import { ReceiverIntermediariesSection } from "@/components/receivers/receiver-intermediaries-section";
import { DeleteReceiverButton } from "@/components/receivers/delete-receiver-button";
import { ContactPersonSelect } from "@/components/contact-person-select";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { getActiveProducts } from "@/lib/products";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getProjectProductsByProjectIds, displayProduct } from "@/lib/project-products";
import { getReceiverIntermediaries } from "@/lib/intermediaries";
import { personLabel } from "@/lib/people";
import type { Contact, ContactDocument, ContactProduct, Note, Person, Project } from "@/lib/types";

interface ReceiverDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failedDocs?: string }>;
}

// UI: Receiver. The underlying table/type stays `contacts`/`Contact`
// — see AGENTS.md's UI-naming-vs-database-naming note.
export default async function ReceiverDetailPage({ params, searchParams }: ReceiverDetailPageProps) {
  const { id } = await params;
  const { failedDocs } = await searchParams;
  const failedDocNames = failedDocs ? failedDocs.split(",").filter(Boolean) : [];
  const supabase = await createClient();

  const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  const contact = data as Contact | null;

  if (!contact) {
    notFound();
  }

  const [
    { data: projectsData },
    { data: productsData },
    { data: documentsData },
    { data: notesData },
    { data: allPeopleData },
    availableProducts,
    documentTypes,
    isAdmin,
    intermediaries,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("matched_contact_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("contact_products").select("*").eq("contact_id", id).order("created_at"),
    supabase.from("contact_documents").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
    // Archived people disappear from this picker's search, same as
    // every other picker — the current contact person (if any) is
    // fetched separately below regardless of its own archived state,
    // so this list never needs to special-case preserving it.
    supabase.from("people").select("id, first_name, last_name, archived_at").is("archived_at", null).order("first_name"),
    getActiveProducts(),
    getActiveDocumentTypes(),
    isCurrentUserAdmin(),
    getReceiverIntermediaries(id),
  ]);

  // The query above already scopes to matched_contact_id = this
  // receiver — "Matched with" is the only relation a project carries to
  // a receiver now (supabase/migrations/013_projects_restructure.sql
  // dropped client_contact_id and assigned_contact_id).
  const matchedProjects = (projectsData as Project[] | null) ?? [];
  const matchedProjectProductsById = await getProjectProductsByProjectIds(matchedProjects.map((p) => p.id));
  const products = (productsData as ContactProduct[] | null) ?? [];
  const documents = (documentsData as ContactDocument[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];
  const allPeople = (allPeopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const intermediaryPickerOptions = allPeople.map((p) => ({ id: p.id, label: personLabel(p) }));
  const contactPerson = contact.contact_person_id
    ? ((
        await supabase
          .from("people")
          .select("id, first_name, last_name, archived_at")
          .eq("id", contact.contact_person_id)
          .maybeSingle()
      ).data as Pick<Person, "id" | "first_name" | "last_name" | "archived_at"> | null)
    : null;

  let documentsWithUrls = documents.map((doc) => ({ ...doc, signedUrl: null as string | null }));
  if (documents.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("contact-documents")
      .createSignedUrls(
        documents.map((doc) => doc.file_path),
        3600
      );
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = documents.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/receivers" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to receivers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{contact.full_name}</h1>
            {contact.archived_at && <ArchivedBadge />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/receivers/${contact.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          <ArchiveToggleButton entityType="receiver" entityId={contact.id} archived={Boolean(contact.archived_at)} />
          {isAdmin && (
            <DeleteReceiverButton
              contactId={contact.id}
              linkedProjectCount={matchedProjects.length}
              productCount={products.length}
              documentCount={documents.length}
              noteCount={notes.length}
            />
          )}
        </div>
      </div>

      {failedDocNames.length > 0 && (
        <GlassCard interactive={false} className="mb-6 border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-300">
            {failedDocNames.length === 1
              ? "1 document failed to attach during receiver creation:"
              : `${failedDocNames.length} documents failed to attach during receiver creation:`}
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-red-300/80">
            {failedDocNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-red-300/60">
            You can add them again using the Documents section below.
          </p>
        </GlassCard>
      )}

      <GlassCard interactive={false} className="p-6">
        <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">About</dt>
        <dd className="mt-1 text-sm whitespace-pre-wrap text-white/85">{contact.notes || "—"}</dd>
      </GlassCard>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Contact Person</h2>
        <GlassCard interactive={false} className="p-6">
          <ContactPersonSelect
            entityType="receiver"
            entityId={contact.id}
            people={allPeople}
            currentPerson={contactPerson}
          />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Products & Ratios</h2>
        <ReceiverProductsSection contactId={contact.id} products={products} availableProducts={availableProducts} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Intermediaries</h2>
        <GlassCard interactive={false} className="p-6">
          <ReceiverIntermediariesSection
            receiverId={contact.id}
            intermediaries={intermediaries}
            pickerOptions={intermediaryPickerOptions}
          />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Documents</h2>
        <GlassCard interactive={false} className="p-6">
          <ReceiverDocuments contactId={contact.id} documents={documentsWithUrls} documentTypes={documentTypes} />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Matched Projects</h2>
        {matchedProjects.length === 0 ? (
          <p className="text-sm text-white/35">Not yet matched with any projects.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {matchedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-white/80">{project.name}</span>
                <span className="shrink-0 text-xs text-white/35">
                  {displayProduct(project.final_product, matchedProjectProductsById.get(project.id) ?? []) ?? "—"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Notes</h2>
        <GlassCard interactive={false} className="p-6">
          <ReceiverNotesSection contactId={contact.id} notes={notes} />
        </GlassCard>
      </div>
    </div>
  );
}
