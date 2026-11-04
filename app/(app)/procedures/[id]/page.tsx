import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, Pencil, Sparkles, Wallet } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PossibleDuplicateBadge, ProcedureSourceBadge, ProcedureStatusBadge } from "@/components/procedures/badges";
import { ArchiveButton } from "@/components/procedures/archive-button";
import { DeleteProcedureButton } from "@/components/procedures/delete-procedure-button";
import { CopyWalletButton } from "@/components/copy-wallet-button";
import { ProcedureDocuments } from "@/components/procedures/procedure-documents";
import { MatchedLeads, type LeadOption } from "@/components/procedures/matched-leads";
import { LinkedNotes } from "@/components/notes/linked-notes";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_LINE_LABELS } from "@/lib/leads";
import { formatDateTime } from "@/lib/procedures";
import type {
  BusinessLine,
  Contact,
  LeadStage,
  Note,
  Procedure,
  ProcedureDocument,
  ProcedureWallet,
} from "@/lib/types";

interface ProcedureDetailPageProps {
  params: Promise<{ id: string }>;
}

interface RawLead {
  id: string;
  business_line: BusinessLine;
  product_type: string;
  stage: LeadStage;
  primary_contact_id: string | null;
  counterparty_contact_id: string | null;
}

function toLeadOption(lead: RawLead, nameById: Map<string, string>): LeadOption {
  return {
    id: lead.id,
    business_line: lead.business_line,
    product_type: lead.product_type,
    stage: lead.stage,
    primary_contact_name: (lead.primary_contact_id && nameById.get(lead.primary_contact_id)) || "Unknown contact",
    counterparty_contact_name: lead.counterparty_contact_id
      ? (nameById.get(lead.counterparty_contact_id) ?? null)
      : null,
  };
}

// Pre-fills the New Lead form from a procedure's fields; the form's create
// flow reads these query params and, on save, links the new lead back to
// this procedure (see the `from_procedure` param and lib/actions/procedures
// `matchProcedureToLead`).
function buildConvertToLeadHref(procedure: Procedure): string {
  const params = new URLSearchParams({ from_procedure: procedure.id });
  if (procedure.area) params.set("business_line", procedure.area);
  if (procedure.contact_id) params.set("contact_id", procedure.contact_id);

  const notes = procedure.title ? `${procedure.title}\n\n${procedure.raw_content}` : procedure.raw_content;
  if (notes) params.set("notes", notes);

  return `/leads/new?${params.toString()}`;
}

export default async function ProcedureDetailPage({ params }: ProcedureDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("procedures").select("*").eq("id", id).maybeSingle();
  const procedure = data as Procedure | null;

  if (!procedure) {
    notFound();
  }

  const [{ data: matchRowsData }, { data: allLeadsData }, { data: allContactsData }] = await Promise.all([
    supabase.from("procedure_lead_matches").select("lead_id").eq("procedure_id", procedure.id),
    supabase
      .from("leads")
      .select("id, business_line, product_type, stage, primary_contact_id, counterparty_contact_id, archived"),
    supabase.from("contacts").select("id, full_name"),
  ]);

  const nameById = new Map(
    ((allContactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );
  const allLeads = (allLeadsData as (RawLead & { archived: boolean })[] | null) ?? [];
  const leadById = new Map(allLeads.map((lead) => [lead.id, lead]));

  const matchedLeadIds = new Set(
    ((matchRowsData as { lead_id: string }[] | null) ?? []).map((m) => m.lead_id)
  );

  const matchedLeads = [...matchedLeadIds]
    .map((leadId) => leadById.get(leadId))
    .filter((lead): lead is RawLead & { archived: boolean } => Boolean(lead))
    .map((lead) => toLeadOption(lead, nameById))
    .sort((a, b) => a.primary_contact_name.localeCompare(b.primary_contact_name));

  const candidateLeads =
    procedure.status !== "archived"
      ? allLeads
          .filter((lead) => !lead.archived && !matchedLeadIds.has(lead.id))
          .map((lead) => toLeadOption(lead, nameById))
          .sort((a, b) => a.primary_contact_name.localeCompare(b.primary_contact_name))
      : [];

  let procedureContact: Contact | null = null;
  if (procedure.contact_id) {
    const { data: contactData } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", procedure.contact_id)
      .maybeSingle();
    procedureContact = contactData;
  }

  const { data: walletsData } = await supabase
    .from("procedure_wallets")
    .select("*")
    .eq("procedure_id", procedure.id)
    .order("created_at");
  const wallets = (walletsData as ProcedureWallet[] | null) ?? [];

  const { data: documentsData } = await supabase
    .from("procedure_documents")
    .select("*")
    .eq("procedure_id", procedure.id)
    .order("created_at", { ascending: false });
  const procedureDocuments = (documentsData as ProcedureDocument[] | null) ?? [];

  const { data: notesData } = await supabase
    .from("notes")
    .select("*")
    .eq("procedure_id", procedure.id)
    .order("created_at", { ascending: false });
  const notes = (notesData as Note[] | null) ?? [];

  let documentsWithUrls = procedureDocuments.map((doc) => ({ ...doc, signedUrl: null as string | null }));
  if (procedureDocuments.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("procedure-documents")
      .createSignedUrls(
        procedureDocuments.map((doc) => doc.file_path),
        3600
      );
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = procedureDocuments.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Area", value: procedure.area ? BUSINESS_LINE_LABELS[procedure.area] : "—" },
    { label: "Created", value: formatDateTime(procedure.created_at) },
    { label: "Last Updated", value: formatDateTime(procedure.updated_at) },
    {
      label: "Contact",
      value: procedureContact ? (
        <Link
          href={`/contacts/${procedureContact.id}`}
          className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
        >
          {procedureContact.full_name}
        </Link>
      ) : (
        "—"
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/procedures" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to procedures
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {procedure.title || "Procedure"}
            </h1>
            <ProcedureSourceBadge source={procedure.source} />
            <ProcedureStatusBadge status={procedure.status} />
            {procedure.intended_as_lead && (
              <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-fuchsia-300">
                <Sparkles className="h-3 w-3" />
                Flagged as lead
              </span>
            )}
            {procedure.possible_duplicate && <PossibleDuplicateBadge />}
          </div>
        </div>
        <Link
          href={`/procedures/${procedure.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <GlassCard interactive={false} className="p-6">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.label}>
                  <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{field.label}</dt>
                  <dd className="mt-1 text-sm text-white/85">{field.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5">
              <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">Raw Content</dt>
              <dd className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm whitespace-pre-wrap wrap-anywhere text-white/85">
                {procedure.raw_content}
              </dd>
            </div>
          </GlassCard>

          {wallets.length > 0 && (
            <GlassCard interactive={false} className="p-6">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-white/35 uppercase">
                <Wallet className="h-3.5 w-3.5" />
                Seller Wallet{wallets.length > 1 ? "s" : ""}
              </p>
              <div className="flex flex-col gap-2">
                {wallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      {wallet.label && (
                        <p className="truncate text-xs font-medium text-white/45">{wallet.label}</p>
                      )}
                      <p className="truncate font-mono text-sm text-white/85">{wallet.wallet_address}</p>
                    </div>
                    <CopyWalletButton address={wallet.wallet_address} />
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          <GlassCard interactive={false} className="p-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Documents</p>
            <ProcedureDocuments procedureId={procedure.id} documents={documentsWithUrls} />
          </GlassCard>

          <GlassCard interactive={false} className="p-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Notes</p>
            <LinkedNotes notes={notes} addHref={`/notes/new?procedure_id=${procedure.id}`} />
          </GlassCard>
        </div>

        <div className="flex flex-col gap-6">
          <GlassCard interactive={false} className="p-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Matched Leads</p>
            <MatchedLeads
              procedureId={procedure.id}
              matchedLeads={matchedLeads}
              candidateLeads={candidateLeads}
              canAddMatches={procedure.status !== "archived"}
            />
          </GlassCard>

          <GlassCard interactive={false} className="p-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Actions</p>
            <div className="flex flex-wrap items-center gap-3">
              {procedure.intended_as_lead && (
                <Link
                  href={buildConvertToLeadHref(procedure)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-fuchsia-400"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Convert to Lead
                </Link>
              )}
              {procedure.status !== "archived" && <ArchiveButton procedureId={procedure.id} />}
              <DeleteProcedureButton procedureId={procedure.id} redirectTo="/procedures" />
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
