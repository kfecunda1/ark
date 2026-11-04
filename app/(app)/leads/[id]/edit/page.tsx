import { notFound } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { createClient } from "@/lib/supabase/server";
import { WALLET_LABEL_SUGGESTIONS } from "@/lib/wallets";
import type { LeadWallet } from "@/lib/types";

interface EditLeadPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditLeadPage({ params }: EditLeadPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: lead },
    { data: profiles },
    { data: contacts },
    { data: walletsData },
    { data: leadFieldsData },
    { data: walletLabelsData },
  ] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
    supabase.from("lead_wallets").select("*").eq("lead_id", id).order("created_at"),
    supabase.from("leads").select("product_type, procedure_type, source"),
    supabase.from("lead_wallets").select("label"),
  ]);

  if (!lead) {
    notFound();
  }

  const wallets = (walletsData as LeadWallet[] | null) ?? [];
  const leadFields =
    (leadFieldsData as { product_type: string; procedure_type: string; source: string | null }[] | null) ?? [];
  const existingProductTypes = [...new Set(leadFields.map((l) => l.product_type))].sort();
  const existingProcedureTypes = [...new Set(leadFields.map((l) => l.procedure_type))].sort();
  const existingSources = [...new Set(leadFields.map((l) => l.source).filter((s): s is string => Boolean(s)))].sort();
  const existingWalletLabels = ((walletLabelsData as { label: string | null }[] | null) ?? [])
    .map((w) => w.label)
    .filter((l): l is string => Boolean(l));
  const walletLabelSuggestions = [...new Set([...WALLET_LABEL_SUGGESTIONS, ...existingWalletLabels])].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Lead</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {lead.product_type}.</p>
      </div>
      <LeadForm
        mode="edit"
        lead={lead}
        profiles={profiles ?? []}
        contacts={contacts ?? []}
        wallets={wallets}
        existingProductTypes={existingProductTypes}
        existingProcedureTypes={existingProcedureTypes}
        existingSources={existingSources}
        walletLabelSuggestions={walletLabelSuggestions}
      />
    </div>
  );
}
