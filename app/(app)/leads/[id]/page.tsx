import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Inbox, Pencil, Wallet } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { CopyWalletButton } from "@/components/copy-wallet-button";
import { PriorityBadge } from "@/components/leads/badges";
import { StageSelect } from "@/components/leads/stage-select";
import { ArchiveLeadButton } from "@/components/leads/archive-lead-button";
import { ProcedureSourceBadge } from "@/components/procedures/badges";
import { LeadDocuments } from "@/components/leads/lead-documents";
import { LinkedNotes } from "@/components/notes/linked-notes";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_LINE_LABELS, formatDateOnly, isFollowUpDue, isStuckDeal } from "@/lib/leads";
import { formatDateTime, truncate } from "@/lib/procedures";
import type { Contact, Lead, LeadDocument, LeadWallet, Note, Procedure, Profile } from "@/lib/types";

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failedDocs?: string; conversionIssue?: string }>;
}

export default async function LeadDetailPage({ params, searchParams }: LeadDetailPageProps) {
  const { id } = await params;
  const { failedDocs, conversionIssue } = await searchParams;
  const failedDocNames = failedDocs ? failedDocs.split(",").filter(Boolean) : [];
  const supabase = await createClient();

  const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  const lead = data as Lead | null;

  if (!lead) {
    notFound();
  }

  let assignedProfile: Profile | null = null;
  if (lead.assigned_to) {
    const { data } = await supabase.from("profiles").select("*").eq("id", lead.assigned_to).maybeSingle();
    assignedProfile = data;
  }

  const contactIds = [lead.primary_contact_id, lead.counterparty_contact_id].filter(
    (contactId): contactId is string => Boolean(contactId)
  );
  let contactsById = new Map<string, Contact>();
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase.from("contacts").select("*").in("id", contactIds);
    contactsById = new Map(((contactsData as Contact[] | null) ?? []).map((c) => [c.id, c]));
  }
  const primaryContact = lead.primary_contact_id ? (contactsById.get(lead.primary_contact_id) ?? null) : null;
  const counterpartyContact = lead.counterparty_contact_id
    ? (contactsById.get(lead.counterparty_contact_id) ?? null)
    : null;

  const { data: matchRowsData } = await supabase
    .from("procedure_lead_matches")
    .select("procedure_id")
    .eq("lead_id", lead.id);
  const matchedProcedureIds = ((matchRowsData as { procedure_id: string }[] | null) ?? []).map(
    (m) => m.procedure_id
  );

  let matchedProcedures: Procedure[] = [];
  if (matchedProcedureIds.length > 0) {
    const { data: procedureData } = await supabase
      .from("procedures")
      .select("*")
      .in("id", matchedProcedureIds)
      .order("created_at", { ascending: false });
    matchedProcedures = (procedureData as Procedure[] | null) ?? [];
  }

  const { data: walletsData } = await supabase
    .from("lead_wallets")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at");
  const wallets = (walletsData as LeadWallet[] | null) ?? [];

  const { data: leadDocumentsData } = await supabase
    .from("lead_documents")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });
  const leadDocuments = (leadDocumentsData as LeadDocument[] | null) ?? [];

  let documentsWithUrls = leadDocuments.map((doc) => ({ ...doc, signedUrl: null as string | null }));
  if (leadDocuments.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("lead-documents")
      .createSignedUrls(
        leadDocuments.map((doc) => doc.file_path),
        3600
      );
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = leadDocuments.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  const { data: notesData } = await supabase
    .from("notes")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });
  const notes = (notesData as Note[] | null) ?? [];

  const stuck = isStuckDeal(lead.stage, lead.stage_updated_at);
  const followUpDue = isFollowUpDue(lead.follow_up_date);

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Business Line", value: BUSINESS_LINE_LABELS[lead.business_line] },
    { label: "Product Type", value: lead.product_type },
    { label: "Procedure Type", value: lead.procedure_type },
    {
      label: "Primary Contact",
      value: primaryContact ? (
        <Link
          href={`/contacts/${primaryContact.id}`}
          className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
        >
          {primaryContact.full_name}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      label: "Counterparty",
      value: counterpartyContact ? (
        <Link
          href={`/contacts/${counterpartyContact.id}`}
          className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
        >
          {counterpartyContact.full_name}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      label: "Deal Value",
      value: lead.deal_value != null ? `${lead.currency ?? ""} ${lead.deal_value}`.trim() : "—",
    },
    { label: "Source", value: lead.source || "—" },
    {
      label: "Assigned To",
      value: assignedProfile?.full_name || assignedProfile?.email || "Unassigned",
    },
    { label: "Follow-up Date", value: lead.follow_up_date ? formatDateOnly(lead.follow_up_date) : "—" },
    { label: "Last Updated", value: formatDateTime(lead.updated_at) },
    { label: "Notes", value: lead.notes || "—" },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to leads
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {primaryContact?.full_name ?? lead.product_type}
            </h1>
            {lead.archived && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-white/50">
                Archived
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/45">
            {lead.product_type} — {BUSINESS_LINE_LABELS[lead.business_line]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ArchiveLeadButton leadId={lead.id} archived={lead.archived} />
          <Link
            href={`/leads/${lead.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      {failedDocNames.length > 0 && (
        <GlassCard interactive={false} className="mb-6 border-amber-500/25 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-medium text-amber-300">
            {failedDocNames.length === 1
              ? "1 document failed to attach during lead creation:"
              : `${failedDocNames.length} documents failed to attach during lead creation:`}
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-amber-200/80">
            {failedDocNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-200/60">
            You can add them again using the Documents section below.
          </p>
        </GlassCard>
      )}

      {conversionIssue && (
        <GlassCard interactive={false} className="mb-6 border-amber-500/25 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-medium text-amber-300">{conversionIssue}</p>
        </GlassCard>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PriorityBadge priority={lead.priority} />
        <StageSelect leadId={lead.id} currentStage={lead.stage} />
        {stuck && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            Stuck deal
          </span>
        )}
        {followUpDue && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-300">
            Follow-up due
          </span>
        )}
      </div>

      <GlassCard interactive={false} className="p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{field.label}</dt>
              <dd className="mt-1 text-sm text-white/85">{field.value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>

      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-white/35 uppercase">
          <Wallet className="h-3.5 w-3.5" />
          Wallet{wallets.length === 1 ? "" : "s"}
        </h2>
        <GlassCard interactive={false} className="p-6">
          {wallets.length === 0 ? (
            <p className="text-sm text-white/40">No wallets added.</p>
          ) : (
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
          )}
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Documents</h2>
        <GlassCard interactive={false} className="p-6">
          <LeadDocuments leadId={lead.id} documents={documentsWithUrls} />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Notes</h2>
        <GlassCard interactive={false} className="p-6">
          <LinkedNotes notes={notes} addHref={`/notes/new?lead_id=${lead.id}`} />
        </GlassCard>
      </div>

      {matchedProcedures.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">
            Matched Procedures
          </h2>
          <div className="flex flex-col gap-2">
            {matchedProcedures.map((procedure) => (
              <Link
                key={procedure.id}
                href={`/procedures/${procedure.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
              >
                <Inbox className="h-4 w-4 shrink-0 text-white/35" />
                <ProcedureSourceBadge source={procedure.source} />
                <span className="min-w-0 flex-1 truncate text-sm text-white/70">
                  {truncate(procedure.raw_content, 80)}
                </span>
                <span className="shrink-0 text-xs text-white/35">{formatDateTime(procedure.created_at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
