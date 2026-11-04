import { NoteForm } from "@/components/notes/note-form";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_LINE_LABELS } from "@/lib/leads";
import { contactLabel } from "@/lib/contacts";
import { truncate } from "@/lib/procedures";
import type { Contact, Lead, Procedure } from "@/lib/types";

interface NewNotePageProps {
  searchParams: Promise<{ lead_id?: string; procedure_id?: string; contact_id?: string }>;
}

export default async function NewNotePage({ searchParams }: NewNotePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: leadsData }, { data: proceduresData }, { data: contactsData }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, business_line, product_type, primary_contact_id, counterparty_contact_id")
      .eq("archived", false),
    supabase.from("procedures").select("id, title, raw_content"),
    supabase.from("contacts").select("id, full_name, phone, email"),
  ]);

  const contacts = (contactsData as Contact[] | null) ?? [];
  const contactNameById = new Map(contacts.map((c) => [c.id, c.full_name]));

  const leads = (
    (leadsData as
      | Pick<Lead, "id" | "business_line" | "product_type" | "primary_contact_id" | "counterparty_contact_id">[]
      | null) ?? []
  ).map((lead) => {
    const contactName = lead.primary_contact_id ? contactNameById.get(lead.primary_contact_id) : null;
    return {
      id: lead.id,
      label: `${contactName ? `${contactName} — ` : ""}${BUSINESS_LINE_LABELS[lead.business_line]} — ${lead.product_type}`,
    };
  });

  const procedures = ((proceduresData as Pick<Procedure, "id" | "title" | "raw_content">[] | null) ?? []).map(
    (procedure) => ({
      id: procedure.id,
      label: procedure.title || truncate(procedure.raw_content, 60),
    })
  );

  const contactOptions = contacts.map((contact) => ({ id: contact.id, label: contactLabel(contact) }));

  const defaultLinkType = params.lead_id ? "lead" : params.procedure_id ? "procedure" : params.contact_id ? "contact" : "";
  const defaultLinkId = params.lead_id ?? params.procedure_id ?? params.contact_id ?? null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Note</h1>
        <p className="mt-1 text-sm text-white/45">Jot something down, optionally as a reminder.</p>
      </div>
      <NoteForm
        mode="create"
        leads={leads}
        procedures={procedures}
        contacts={contactOptions}
        defaultLinkType={defaultLinkType}
        defaultLinkId={defaultLinkId}
      />
    </div>
  );
}
