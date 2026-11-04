import { notFound } from "next/navigation";
import { ProcedureForm } from "@/components/procedures/procedure-form";
import { createClient } from "@/lib/supabase/server";
import { WALLET_LABEL_SUGGESTIONS } from "@/lib/wallets";
import type { Procedure, ProcedureDocument, ProcedureWallet } from "@/lib/types";

interface EditProcedurePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProcedurePage({ params }: EditProcedurePageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: procedureData },
    { data: contacts },
    { data: walletsData },
    { data: documentsData },
    { data: walletLabelsData },
  ] = await Promise.all([
    supabase.from("procedures").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
    supabase.from("procedure_wallets").select("*").eq("procedure_id", id).order("created_at"),
    supabase.from("procedure_documents").select("*").eq("procedure_id", id).order("created_at"),
    supabase.from("procedure_wallets").select("label"),
  ]);
  const procedure = procedureData as Procedure | null;
  const wallets = (walletsData as ProcedureWallet[] | null) ?? [];
  const documents = (documentsData as ProcedureDocument[] | null) ?? [];
  const existingWalletLabels = ((walletLabelsData as { label: string | null }[] | null) ?? [])
    .map((w) => w.label)
    .filter((l): l is string => Boolean(l));
  const walletLabelSuggestions = [...new Set([...WALLET_LABEL_SUGGESTIONS, ...existingWalletLabels])].sort();

  if (!procedure) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Procedure</h1>
        <p className="mt-1 text-sm text-white/45">Update the details captured for this procedure.</p>
      </div>
      <ProcedureForm
        mode="edit"
        procedure={procedure}
        contacts={contacts ?? []}
        wallets={wallets}
        documents={documents}
        walletLabelSuggestions={walletLabelSuggestions}
      />
    </div>
  );
}
