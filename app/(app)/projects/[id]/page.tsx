import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PriorityBadge, RecoveryBadge } from "@/components/projects/badges";
import { StageSelect } from "@/components/projects/stage-select";
import { StatusSelect } from "@/components/projects/status-select";
import { ArchiveProjectButton } from "@/components/projects/archive-project-button";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { TranchesSection } from "@/components/projects/tranches-section";
import { MatchedReceiverSelect } from "@/components/projects/matched-receiver-select";
import { FindReceiversPanel } from "@/components/projects/find-receivers-panel";
import { DocumentChecklistPanel } from "@/components/projects/document-checklist-panel";
import { ContactPersonSelect } from "@/components/contact-person-select";
import { ProjectProductOptions } from "@/components/projects/project-product-options";
import { ProjectIntermediariesSection } from "@/components/projects/project-intermediaries-section";
import { SetProjectSection } from "@/components/projects/set-project-section";
import { RecoveryToggle } from "@/components/projects/recovery-toggle";
import { ProjectTimeline, type ComposerKind } from "@/components/projects/project-timeline";
import { ProjectSummaryHeader } from "@/components/projects/project-summary-header";
import { createClient } from "@/lib/supabase/server";
import { getAllStatuses } from "@/lib/statuses";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { getAppSettings } from "@/lib/app-settings";
import { isCurrentUserAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { amountInWords, formatMoney } from "@/lib/money";
import { buildIntermediaryPickerOptions, getProjectIntermediaryChain } from "@/lib/intermediaries";
import { getReceiverIntermediaryPersonIds } from "@/lib/actions/intermediaries";
import { computeChecklistStatus, getChecklistCatalog } from "@/lib/checklists";
import { getActiveTemplatesByDocumentType } from "@/lib/templates";
import { personLabel } from "@/lib/people";
import { daysSinceInstant } from "@/lib/projects";
import { hasDisplayNickname, projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, Note, Person, Project, ProjectDocument, ProjectProduct, ProjectStep, ProjectTranche } from "@/lib/types";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    failedDocs?: string;
    findReceivers?: string;
    uploadType?: string;
    composer?: string;
    opportunityMoveError?: string;
  }>;
}

function isComposerKind(value: string | undefined): value is ComposerKind {
  return value === "step_taken" || value === "next_step" || value === "note";
}

export default async function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  const { id } = await params;
  const { failedDocs, findReceivers, uploadType, composer, opportunityMoveError } = await searchParams;
  const initialComposerKind = isComposerKind(composer) ? composer : null;
  const failedDocNames = failedDocs ? failedDocs.split(",").filter(Boolean) : [];
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const { data } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  const project = data as Project | null;

  if (!project) {
    notFound();
  }

  const matchedContact = project.matched_contact_id
    ? (
        await supabase.from("contacts").select("*").eq("id", project.matched_contact_id).maybeSingle()
      ).data as Contact | null
    : null;

  const contactPerson = project.contact_person_id
    ? (
        await supabase
          .from("people")
          .select("id, first_name, last_name, archived_at")
          .eq("id", project.contact_person_id)
          .maybeSingle()
      ).data as Pick<Person, "id" | "first_name" | "last_name" | "archived_at"> | null
    : null;

  // The matched-receiver and contact-person pickers each need to
  // search every row of their own list, not just whichever one (if
  // any) is already loaded above. Archived rows are excluded from
  // these search lists (same as every other picker) — the current
  // selection, if any, is tracked separately above regardless of its
  // own archived state, so it's never at risk of disappearing here.
  const [{ data: allContactsData }, { data: allPeopleData }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, nickname").is("archived_at", null).order("full_name"),
    supabase.from("people").select("id, first_name, last_name, archived_at").is("archived_at", null).order("first_name"),
  ]);
  const allContacts = (allContactsData as { id: string; full_name: string; nickname: string | null }[] | null) ?? [];
  const allPeople = (allPeopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];

  const [intermediaryChain, receiverIntermediaryIds] = await Promise.all([
    getProjectIntermediaryChain(project.id, lang),
    project.matched_contact_id ? getReceiverIntermediaryPersonIds(project.matched_contact_id) : Promise.resolve([]),
  ]);
  const intermediaryPickerOptions = buildIntermediaryPickerOptions(allPeople, new Set(receiverIntermediaryIds));
  const matchedReceiverLabel = matchedContact
    ? receiverDisplayName(matchedContact) + (matchedContact.archived_at ? ` (${t.common.archived})` : "")
    : null;
  const matchedReceiverSublabel =
    matchedContact && hasDisplayNickname(matchedContact.nickname)
      ? matchedContact.full_name + (matchedContact.archived_at ? ` (${t.common.archived})` : "")
      : undefined;

  const [
    { data: projectDocumentsData },
    { data: tranchesData },
    { data: stepsData },
    { data: notesData },
    { data: projectProductsData },
    documentTypes,
    statuses,
    appSettings,
    isAdmin,
  ] = await Promise.all([
    supabase.from("project_documents").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_tranches").select("*").eq("project_id", project.id).order("tranche_number"),
    supabase.from("project_steps").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_products").select("*").eq("project_id", project.id).order("sort_order"),
    getActiveDocumentTypes(),
    getAllStatuses(),
    getAppSettings(),
    isCurrentUserAdmin(),
  ]);
  const projectDocuments = (projectDocumentsData as ProjectDocument[] | null) ?? [];
  const tranches = (tranchesData as ProjectTranche[] | null) ?? [];
  const steps = (stepsData as ProjectStep[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];
  const projectProducts = (projectProductsData as ProjectProduct[] | null) ?? [];

  const [checklistCatalog, templatesByType] = await Promise.all([
    getChecklistCatalog(supabase),
    getActiveTemplatesByDocumentType(supabase),
  ]);
  const checklistStatus = computeChecklistStatus(
    project.final_product,
    projectProducts.map((p) => p.product),
    checklistCatalog,
    new Set(projectDocuments.map((d) => d.document_type))
  );
  const checklistProductLabel = project.final_product ?? projectProducts.map((p) => p.product).join(", ");

  // Summary header (components/projects/project-summary-header.tsx) —
  // every value below is derived from data this page already fetches
  // for its own sections, nothing queried specifically for the header.
  const summaryProductLabel =
    project.final_product ?? t.common.optionsLabel(projectProducts.map((p) => p.product).join(" / "));
  const summaryStatusColor = project.status ? statuses.find((s) => s.name === project.status)?.color ?? null : null;
  const summaryContactPersonLabel = contactPerson
    ? personLabel(contactPerson) + (contactPerson.archived_at ? ` (${t.common.archived})` : "")
    : null;
  const summarySoonestNextStep = steps
    .filter((s) => s.kind === "next_step" && !s.done)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
  const summaryNextStep = summarySoonestNextStep
    ? { id: summarySoonestNextStep.id, body: summarySoonestNextStep.body, dueDate: summarySoonestNextStep.due_date }
    : null;
  const summaryTrancheStats = {
    sentCount: tranches.filter((t) => t.sent_on).length,
    confirmedCount: tranches.filter((t) => t.confirmed_on).length,
    paidOutCount: tranches.filter((t) => t.paid_out_on).length,
    activeAmountLabel: (() => {
      const activeAmount = tranches
        .filter((t) => t.confirmed_on && !t.paid_out_on)
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);
      return activeAmount > 0 ? formatMoney(activeAmount, project.currency) : null;
    })(),
  };
  const summaryLastActivityDaysAgo = daysSinceInstant(project.last_activity_at);

  // Admin-only counts for the Delete confirmation dialog (components/
  // projects/delete-project-button.tsx) — tranche_payouts/tranche_
  // payout_shares are admin-only RLS, so these two are only ever
  // queried for an admin's own session, which is also the only session
  // that ever renders the button these counts feed.
  let payoutCount = 0;
  let payoutShareCount = 0;
  if (isAdmin && tranches.length > 0) {
    const trancheIds = tranches.map((t) => t.id);
    const { data: payoutRows } = await supabase.from("tranche_payouts").select("id").in("tranche_id", trancheIds);
    const payoutIds = ((payoutRows as { id: string }[] | null) ?? []).map((p) => p.id);
    payoutCount = payoutIds.length;
    if (payoutIds.length > 0) {
      const { count } = await supabase
        .from("tranche_payout_shares")
        .select("id", { count: "exact", head: true })
        .in("tranche_payout_id", payoutIds);
      payoutShareCount = count ?? 0;
    }
  }

  const authorIds = [
    ...new Set(
      [...steps.map((s) => s.author_id), ...notes.map((n) => n.created_by)].filter((id): id is string =>
        Boolean(id)
      )
    ),
  ];
  let authorNameById: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profilesData } = await supabase.from("profiles").select("id, full_name, email").in("id", authorIds);
    authorNameById = Object.fromEntries(
      ((profilesData as { id: string; full_name: string | null; email: string | null }[] | null) ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || t.projectTimeline.unknownUser,
      ])
    );
  }

  let documentsWithUrls = projectDocuments.map((doc) => ({ ...doc, signedUrl: null as string | null }));
  const projectDocFilePaths = projectDocuments.map((doc) => doc.file_path).filter((p): p is string => Boolean(p));
  if (projectDocFilePaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("project-documents")
      .createSignedUrls(projectDocFilePaths, 3600);
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = projectDocuments.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: t.projectSummary.contactPersonProjectLabel,
      value: (
        <ContactPersonSelect
          entityType="project"
          entityId={project.id}
          people={allPeople}
          currentPerson={contactPerson}
          lang={lang}
        />
      ),
    },
    { label: t.projectSummary.ratioPresented, value: project.ratio_presented || "—" },
    { label: t.projectSummary.ratioReal, value: project.ratio_real || "—" },
    {
      label: t.projectSummary.totalFaceValueLabel,
      value: (
        <>
          {formatMoney(project.total_face_value, project.currency)}
          {project.total_face_value != null && (
            <p className="mt-0.5 text-xs text-white/40">{amountInWords(project.total_face_value, project.currency, lang)}</p>
          )}
        </>
      ),
    },
    { label: t.projectSummary.lastActivityLabel, value: formatDateTime(project.last_activity_at, lang) },
    { label: t.projectSummary.createdLabel, value: formatDateTime(project.created_at, lang) },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <SetProjectSection isRecovery={project.is_recovery} />
      <ProjectSummaryHeader
        projectId={project.id}
        projectName={projectDisplayName(project)}
        projectFullName={project.name}
        productLabel={summaryProductLabel}
        showRecoveryBadge={appSettings.show_recovery && project.is_recovery}
        stage={project.stage}
        statusLabel={project.status}
        statusColor={summaryStatusColor}
        totalFaceValueLabel={formatMoney(project.total_face_value, project.currency)}
        matchedReceiver={
          matchedContact ? { id: matchedContact.id, label: matchedReceiverLabel!, fullName: matchedContact.full_name } : null
        }
        contactPersonLabel={summaryContactPersonLabel}
        checklist={checklistStatus}
        nextStep={summaryNextStep}
        tranches={summaryTrancheStats}
        lastActivityDaysAgo={summaryLastActivityDaysAgo}
        stuckAfterDays={appSettings.stuck_after_days}
        lang={lang}
      />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={appSettings.show_recovery && project.is_recovery ? "/recovery" : "/projects"}
            className="text-xs font-medium text-white/40 hover:text-white/70"
          >
            {t.projectSummary.backTo(
              appSettings.show_recovery && project.is_recovery
                ? t.projectsList.recoveryProjectsNoun
                : t.projectsList.projectsNoun
            )}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{project.name}</h1>
            {project.nickname && (
              <span
                title={t.common.nicknameLabel}
                className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-soft"
              >
                {project.nickname}
              </span>
            )}
            {project.archived_at && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-white/50">
                {t.common.archived}
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-white/45">
            {appSettings.show_recovery && project.is_recovery && (
              <>
                <RecoveryBadge lang={lang} />
                <span>·</span>
              </>
            )}
            <span>{project.final_product ?? t.projectSummary.productNotDecided}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ArchiveProjectButton projectId={project.id} archived={Boolean(project.archived_at)} lang={lang} />
          <Link
            href={`/projects/${project.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Pencil className="h-4 w-4" />
            {t.common.edit}
          </Link>
          {isAdmin && (
            <DeleteProjectButton
              projectId={project.id}
              trancheCount={tranches.length}
              payoutCount={payoutCount}
              payoutShareCount={payoutShareCount}
              stepCount={steps.length}
              noteCount={notes.length}
              productOptionCount={projectProducts.length}
              intermediaryCount={intermediaryChain.length}
              documentCount={projectDocuments.length}
              lang={lang}
            />
          )}
        </div>
      </div>

      {opportunityMoveError && (
        <GlassCard interactive={false} className="mb-6 border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-300">{t.opportunities.moveFailed(opportunityMoveError)}</p>
        </GlassCard>
      )}

      {failedDocNames.length > 0 && (
        <GlassCard interactive={false} className="mb-6 border-amber-500/25 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-medium text-amber-300">
            {failedDocNames.length === 1
              ? t.projectSummary.failedDocsOne
              : t.projectSummary.failedDocsMany(failedDocNames.length)}
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-amber-200/80">
            {failedDocNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-200/60">{t.projectSummary.addAgainHint}</p>
        </GlassCard>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PriorityBadge priority={project.priority} lang={lang} />
        <StageSelect projectId={project.id} currentStage={project.stage} lang={lang} />
        <StatusSelect projectId={project.id} currentStatus={project.status} statuses={statuses} lang={lang} />
        {appSettings.show_recovery && (
          <RecoveryToggle projectId={project.id} isRecovery={project.is_recovery} lang={lang} />
        )}
      </div>

      <div className="mb-6">
        <DocumentChecklistPanel
          projectId={project.id}
          productLabel={checklistProductLabel}
          status={checklistStatus}
          isAdmin={isAdmin}
          documentTypes={documentTypes}
          templatesByType={templatesByType}
          lang={lang}
        />
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.projectSummary.productsHeading}</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectProductOptions
            projectId={project.id}
            options={projectProducts.map((p) => p.product)}
            finalProduct={project.final_product}
            matchedContactId={project.matched_contact_id}
            isRecovery={project.is_recovery}
            lang={lang}
          />
        </GlassCard>
      </div>

      <div id="matched-with" className="mb-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.projectSummary.matchedWithHeading}</h2>
        <GlassCard interactive={false} className="p-6">
          <MatchedReceiverSelect
            projectId={project.id}
            receivers={allContacts.map((c) => ({
              id: c.id,
              label: receiverDisplayName(c),
              sublabel: hasDisplayNickname(c.nickname) ? c.full_name : undefined,
            }))}
            currentReceiver={
              matchedContact
                ? { id: matchedContact.id, label: matchedReceiverLabel!, sublabel: matchedReceiverSublabel }
                : null
            }
            lang={lang}
          />
          <div className="mt-4">
            <FindReceiversPanel
              projectId={project.id}
              hasMatch={Boolean(project.matched_contact_id)}
              defaultOpen={findReceivers === "true"}
              lang={lang}
            />
          </div>
          <div className="mt-4">
            <ProjectIntermediariesSection
              projectId={project.id}
              entries={intermediaryChain}
              receiverLabel={matchedReceiverLabel}
              pickerOptions={intermediaryPickerOptions}
              lang={lang}
            />
          </div>
        </GlassCard>
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
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.projectSummary.tranchesHeading}</h2>
        <TranchesSection
          projectId={project.id}
          tranches={tranches}
          currency={project.currency}
          documents={documentsWithUrls}
          documentTypes={documentTypes}
          lang={lang}
        />
      </div>

      <div id="project-documents" className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.projectSummary.documentsHeading}</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectDocuments
            key={uploadType ?? "default"}
            projectId={project.id}
            documents={documentsWithUrls}
            documentTypes={documentTypes}
            tranches={tranches}
            scope={{ kind: "all" }}
            initialDocumentType={uploadType}
            lang={lang}
          />
        </GlassCard>
      </div>

      <div id="project-timeline" className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{t.projectSummary.timelineHeading}</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectTimeline
            key={composer ?? "default"}
            projectId={project.id}
            steps={steps}
            notes={notes}
            authorNameById={authorNameById}
            initialComposerKind={initialComposerKind}
            lang={lang}
          />
        </GlassCard>
      </div>
    </div>
  );
}
