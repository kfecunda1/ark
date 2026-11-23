import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { OpportunityDocuments, type OpportunityDocumentWithUrl } from "@/components/opportunities/opportunity-documents";
import { OpportunityNotesSection } from "@/components/opportunities/opportunity-notes-section";
import { OpportunityActions } from "@/components/opportunities/opportunity-actions";
import { DeleteOpportunityButton } from "@/components/opportunities/delete-opportunity-button";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getOpportunityProductsByOpportunityIds, displayOpportunityProducts } from "@/lib/opportunity-products";
import { formatDateTime } from "@/lib/format";
import { personLabel } from "@/lib/people";
import { receiverDisplayName, projectDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, Opportunity, OpportunityDocument, Person, Project } from "@/lib/types";

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failedDocs?: string }>;
}

export default async function OpportunityDetailPage({ params, searchParams }: OpportunityDetailPageProps) {
  const { id } = await params;
  const { failedDocs } = await searchParams;
  const failedDocNames = failedDocs ? failedDocs.split(",").filter(Boolean) : [];
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const { data } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
  const opportunity = data as Opportunity | null;

  if (!opportunity) {
    notFound();
  }

  const [
    { data: documentsData },
    { data: notesData },
    { data: receiversData },
    documentTypes,
    isAdmin,
    opportunityProductsById,
  ] = await Promise.all([
    supabase.from("opportunity_documents").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
    supabase.from("contacts").select("id, full_name, nickname").is("archived_at", null).order("full_name"),
    getActiveDocumentTypes(),
    isCurrentUserAdmin(),
    getOpportunityProductsByOpportunityIds([id]),
  ]);

  const intermediary = opportunity.intermediary_person_id
    ? ((
        await supabase
          .from("people")
          .select("id, first_name, last_name, archived_at")
          .eq("id", opportunity.intermediary_person_id)
          .maybeSingle()
      ).data as Pick<Person, "id" | "first_name" | "last_name" | "archived_at"> | null)
    : null;

  const documents = (documentsData as OpportunityDocument[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];
  const products = opportunityProductsById.get(id) ?? [];
  const receivers = ((receiversData as { id: string; full_name: string; nickname: string | null }[] | null) ?? []).map(
    (c) => ({ id: c.id, label: receiverDisplayName(c) })
  );

  let documentsWithUrls: OpportunityDocumentWithUrl[] = documents.map((doc) => ({ ...doc, signedUrl: null }));
  const filePaths = documents.map((doc) => doc.file_path).filter((p): p is string => Boolean(p));
  if (filePaths.length > 0) {
    const { data: signedUrls } = await supabase.storage.from("opportunity-documents").createSignedUrls(filePaths, 3600);
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = documents.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  // The read-only outcome line once converted — whichever record it
  // became, by whichever name/title it currently has (not whatever it
  // was called at the moment of conversion).
  let convertedToLabel: string | null = null;
  let convertedToHref: string | null = null;
  if (opportunity.status === "converted" && opportunity.converted_to_id) {
    if (opportunity.converted_to_type === "project") {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("id, name, nickname")
        .eq("id", opportunity.converted_to_id)
        .maybeSingle();
      if (projectRow) {
        convertedToLabel = projectDisplayName(projectRow as Pick<Project, "name" | "nickname">);
        convertedToHref = `/projects/${opportunity.converted_to_id}`;
      }
    } else if (opportunity.converted_to_type === "receiver") {
      const { data: contactRow } = await supabase
        .from("contacts")
        .select("id, full_name, nickname")
        .eq("id", opportunity.converted_to_id)
        .maybeSingle();
      if (contactRow) {
        convertedToLabel = receiverDisplayName(contactRow as Pick<Contact, "full_name" | "nickname">);
        convertedToHref = `/receivers/${opportunity.converted_to_id}`;
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/opportunities" className="text-xs font-medium text-white/40 hover:text-white/70">
            {t.opportunities.backToOpportunities}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{opportunity.title}</h1>
            <OpportunityStatusBadge status={opportunity.status} lang={lang} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {opportunity.status === "open" && (
            <Link
              href={`/opportunities/${opportunity.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
            >
              <Pencil className="h-4 w-4" />
              {t.common.edit}
            </Link>
          )}
          {isAdmin && (
            <DeleteOpportunityButton
              opportunityId={opportunity.id}
              documentCount={documents.length}
              noteCount={notes.length}
              lang={lang}
            />
          )}
        </div>
      </div>

      {failedDocNames.length > 0 && (
        <GlassCard interactive={false} className="mb-6 border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-300">
            {failedDocNames.length === 1
              ? t.opportunities.failedDocsOne
              : t.opportunities.failedDocsMany(failedDocNames.length)}
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-red-300/80">
            {failedDocNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-red-300/60">{t.opportunities.addAgainHint}</p>
        </GlassCard>
      )}

      {opportunity.status === "converted" && convertedToLabel && (
        <GlassCard interactive={false} className="mb-6 border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-sm text-emerald-300">
            {t.opportunities.convertedTo(
              opportunity.converted_to_type === "project" ? t.opportunities.aProject : t.opportunities.aReceiver
            )}{" "}
            {convertedToHref && (
              <Link href={convertedToHref} className="font-semibold underline underline-offset-2 hover:text-emerald-200">
                {convertedToLabel}
              </Link>
            )}
          </p>
        </GlassCard>
      )}

      {opportunity.status === "closed" && (
        <GlassCard interactive={false} className="mb-6 border-white/10 bg-white/[0.04] p-4">
          <p className="text-sm text-white/70">
            {opportunity.closed_reason ? t.opportunities.closedWithReason(opportunity.closed_reason) : t.opportunities.closedNoReason}
          </p>
        </GlassCard>
      )}

      <GlassCard interactive={false} className="p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{t.opportunities.colIntermediary}</dt>
            <dd className="mt-1 text-sm text-white/85">{intermediary ? personLabel(intermediary) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{t.opportunities.colProducts}</dt>
            <dd className="mt-1 text-sm text-white/85">{displayOpportunityProducts(products)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{t.opportunities.colLastActivity}</dt>
            <dd className="mt-1 text-sm text-white/85">{formatDateTime(opportunity.last_activity_at, lang)}</dd>
          </div>
        </dl>
        {opportunity.notes_summary && (
          <div className="mt-5">
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{t.opportunityForm.summaryLabel}</dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap text-white/70">{opportunity.notes_summary}</dd>
          </div>
        )}
      </GlassCard>

      {opportunity.status !== "converted" && (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.opportunities.actionsHeading}</h2>
          <GlassCard interactive={false} className="p-6">
            <OpportunityActions opportunity={opportunity} receivers={receivers} lang={lang} />
          </GlassCard>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.common.documents}</h2>
        <GlassCard interactive={false} className="p-6">
          <OpportunityDocuments
            opportunityId={opportunity.id}
            documents={documentsWithUrls}
            documentTypes={documentTypes}
            lang={lang}
          />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.common.notes}</h2>
        <GlassCard interactive={false} className="p-6">
          <OpportunityNotesSection opportunityId={opportunity.id} notes={notes} lang={lang} />
        </GlassCard>
      </div>
    </div>
  );
}
