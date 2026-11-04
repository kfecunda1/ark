import { ProcedureForm } from "@/components/procedures/procedure-form";
import { createClient } from "@/lib/supabase/server";
import { WALLET_LABEL_SUGGESTIONS } from "@/lib/wallets";

export default async function NewProcedurePage() {
  const supabase = await createClient();
  const [{ data: contacts }, { data: walletLabelsData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, phone, email").order("full_name"),
    supabase.from("procedure_wallets").select("label"),
  ]);

  const existingWalletLabels = ((walletLabelsData as { label: string | null }[] | null) ?? [])
    .map((w) => w.label)
    .filter((l): l is string => Boolean(l));
  const walletLabelSuggestions = [...new Set([...WALLET_LABEL_SUGGESTIONS, ...existingWalletLabels])].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Add Procedure</h1>
        <p className="mt-1 text-sm text-white/45">
          Log a raw offer or request before it&apos;s matched to a lead.
        </p>
      </div>
      <ProcedureForm mode="create" contacts={contacts ?? []} walletLabelSuggestions={walletLabelSuggestions} />
    </div>
  );
}
