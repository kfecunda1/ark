import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PriorityBadge, RecoveryBadge } from "@/components/projects/badges";
import { StageSelect } from "@/components/projects/stage-select";
import { StatusSelect } from "@/components/projects/status-select";
import { ArchiveProjectButton } from "@/components/projects/archive-project-button";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { TranchesSection } from "@/components/projects/tranches-section";
import { MatchedReceiverSelect } from "@/components/projects/matched-receiver-select";
import { ContactPersonSelect } from "@/components/contact-person-select";
import { ProjectProductOptions } from "@/components/projects/project-product-options";
import { RecoveryToggle } from "@/components/projects/recovery-toggle";
import { ProjectTimeline } from "@/components/projects/project-timeline";
import { createClient } from "@/lib/supabase/server";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { formatDateTime } from "@/lib/format";
import { amountInWords, formatMoney } from "@/lib/money";
import type { Contact, Note, Person, Project, ProjectDocument, ProjectProduct, ProjectStep, ProjectTranche } from "@/lib/types";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failedDocs?: string }>;
}

export default async function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  const { id } = await params;
  const { failedDocs } = await searchParams;
  const failedDocNames = failedDocs ? failedDocs.split(",").filter(Boolean) : [];
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
    supabase.from("contacts").select("id, full_name").is("archived_at", null).order("full_name"),
    supabase.from("people").select("id, first_name, last_name, archived_at").is("archived_at", null).order("first_name"),
  ]);
  const allContacts = (allContactsData as { id: string; full_name: string }[] | null) ?? [];
  const allPeople = (allPeopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];

  const [
    { data: projectDocumentsData },
    { data: tranchesData },
    { data: stepsData },
    { data: notesData },
    { data: projectProductsData },
    documentTypes,
  ] = await Promise.all([
    supabase.from("project_documents").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_tranches").select("*").eq("project_id", project.id).order("tranche_number"),
    supabase.from("project_steps").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_products").select("*").eq("project_id", project.id).order("sort_order"),
    getActiveDocumentTypes(),
  ]);
  const projectDocuments = (projectDocumentsData as ProjectDocument[] | null) ?? [];
  const tranches = (tranchesData as ProjectTranche[] | null) ?? [];
  const steps = (stepsData as ProjectStep[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];
  const projectProducts = (projectProductsData as ProjectProduct[] | null) ?? [];

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
        p.full_name?.trim() || p.email || "Unknown user",
      ])
    );
  }

  let documentsWithUrls = projectDocuments.map((doc) => ({ ...doc, signedUrl: null as string | null }));
  if (projectDocuments.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("project-documents")
      .createSignedUrls(
        projectDocuments.map((doc) => doc.file_path),
        3600
      );
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
    documentsWithUrls = projectDocuments.map((doc) => ({
      ...doc,
      signedUrl: (doc.file_path && urlByPath.get(doc.file_path)) || null,
    }));
  }

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Matched With",
      value: (
        <MatchedReceiverSelect
          projectId={project.id}
          receivers={allContacts.map((c) => ({ id: c.id, label: c.full_name }))}
          currentReceiver={
            matchedContact
              ? { id: matchedContact.id, label: matchedContact.full_name + (matchedContact.archived_at ? " (Archived)" : "") }
              : null
          }
        />
      ),
    },
    {
      label: "Contact Person",
      value: (
        <ContactPersonSelect
          entityType="project"
          entityId={project.id}
          people={allPeople}
          currentPerson={contactPerson}
        />
      ),
    },
    { label: "Ratio Presented", value: project.ratio_presented || "—" },
    { label: "Ratio Real", value: project.ratio_real || "—" },
    {
      label: "Total Face Value",
      value: (
        <>
          {formatMoney(project.total_face_value, project.currency)}
          {project.total_face_value != null && (
            <p className="mt-0.5 text-xs text-white/40">{amountInWords(project.total_face_value, project.currency)}</p>
          )}
        </>
      ),
    },
    { label: "Last Activity", value: formatDateTime(project.last_activity_at) },
    { label: "Created", value: formatDateTime(project.created_at) },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to projects
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{project.name}</h1>
            {project.archived_at && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-white/50">
                Archived
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-white/45">
            {project.is_recovery && (
              <>
                <RecoveryBadge />
                <span>·</span>
              </>
            )}
            <span>{project.final_product ?? "Product not decided"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ArchiveProjectButton projectId={project.id} archived={Boolean(project.archived_at)} />
          <Link
            href={`/projects/${project.id}/edit`}
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
              ? "1 document failed to attach during project creation:"
              : `${failedDocNames.length} documents failed to attach during project creation:`}
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PriorityBadge priority={project.priority} />
        <StageSelect projectId={project.id} currentStage={project.stage} />
        <StatusSelect projectId={project.id} currentStatus={project.status} />
        <RecoveryToggle projectId={project.id} isRecovery={project.is_recovery} />
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Products</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectProductOptions
            projectId={project.id}
            options={projectProducts.map((p) => p.product)}
            finalProduct={project.final_product}
            matchedContactId={project.matched_contact_id}
            isRecovery={project.is_recovery}
          />
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
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Tranches</h2>
        <TranchesSection projectId={project.id} tranches={tranches} currency={project.currency} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Documents</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectDocuments projectId={project.id} documents={documentsWithUrls} documentTypes={documentTypes} />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Timeline</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectTimeline projectId={project.id} steps={steps} notes={notes} authorNameById={authorNameById} />
        </GlassCard>
      </div>
    </div>
  );
}
