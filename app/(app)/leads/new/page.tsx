import { LeadForm } from "@/components/leads/lead-form";
import { createClient } from "@/lib/supabase/server";
import { WALLET_LABEL_SUGGESTIONS } from "@/lib/wallets";
import type { BusinessLine } from "@/lib/types";

interface NewLeadPageProps {
  searchParams: Promise<{
    from_procedure?: string;
    business_line?: string;
    notes?: string;
    contact_id?: string;
  }>;
}

export default async function NewLeadPage({ searchParams }: NewLeadPageProps) {
  const params = await searchParams;

  const supabase = await createClient();
  const [{ data: profiles }, { data: contacts }, { data: leadFieldsData }, { data: walletLabelsData }] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
      supabase.from("leads").select("product_type, procedure_type, source"),
      supabase.from("lead_wallets").select("label"),
    ]);

  const leadFields =
    (leadFieldsData as { product_type: string; procedure_type: string; source: string | null }[] | null) ?? [];
  const existingProductTypes = [...new Set(leadFields.map((l) => l.product_type))].sort();
  const existingProcedureTypes = [...new Set(leadFields.map((l) => l.procedure_type))].sort();
  const existingSources = [...new Set(leadFields.map((l) => l.source).filter((s): s is string => Boolean(s)))].sort();
  const existingWalletLabels = ((walletLabelsData as { label: string | null }[] | null) ?? [])
    .map((w) => w.label)
    .filter((l): l is string => Boolean(l));
  const walletLabelSuggestions = [...new Set([...WALLET_LABEL_SUGGESTIONS, ...existingWalletLabels])].sort();

  const prefill = params.from_procedure
    ? {
        businessLine: (params.business_line as BusinessLine | undefined) || undefined,
        notes: params.notes,
        contactId: params.contact_id,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">New Lead</h1>
        <p className="mt-1 text-sm text-white/45">
          {params.from_procedure ? "Converting a flagged procedure into a lead." : "Add a new lead to the pipeline."}
        </p>
      </div>
      <LeadForm
        mode="create"
        profiles={profiles ?? []}
        contacts={contacts ?? []}
        existingProductTypes={existingProductTypes}
        existingProcedureTypes={existingProcedureTypes}
        existingSources={existingSources}
        walletLabelSuggestions={walletLabelSuggestions}
        prefill={prefill}
        fromProcedureId={params.from_procedure}
      />
    </div>
  );
}
