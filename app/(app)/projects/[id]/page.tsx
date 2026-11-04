import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PriorityBadge } from "@/components/projects/badges";
import { StageSelect } from "@/components/projects/stage-select";
import { ArchiveProjectButton } from "@/components/projects/archive-project-button";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { TranchesSection } from "@/components/projects/tranches-section";
import { LinkedNotes } from "@/components/notes/linked-notes";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS } from "@/lib/projects";
import { formatDateTime } from "@/lib/format";
import type { Contact, Note, Project, ProjectDocument, ProjectTranche } from "@/lib/types";

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

  const contactIds = [project.client_contact_id, project.assigned_contact_id].filter(
    (contactId): contactId is string => Boolean(contactId)
  );
  let contactsById = new Map<string, Contact>();
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase.from("contacts").select("*").in("id", contactIds);
    contactsById = new Map(((contactsData as Contact[] | null) ?? []).map((c) => [c.id, c]));
  }
  const clientContact = project.client_contact_id ? (contactsById.get(project.client_contact_id) ?? null) : null;
  const assignedContact = project.assigned_contact_id
    ? (contactsById.get(project.assigned_contact_id) ?? null)
    : null;

  const [{ data: projectDocumentsData }, { data: tranchesData }, { data: notesData }] = await Promise.all([
    supabase.from("project_documents").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_tranches").select("*").eq("project_id", project.id).order("tranche_number"),
    supabase.from("notes").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
  ]);
  const projectDocuments = (projectDocumentsData as ProjectDocument[] | null) ?? [];
  const tranches = (tranchesData as ProjectTranche[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];

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
    { label: "Product Type", value: project.product_type },
    {
      label: "Client Contact",
      value: clientContact ? (
        <Link
          href={`/contacts/${clientContact.id}`}
          className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
        >
          {clientContact.full_name}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      label: "Assigned Contact",
      value: assignedContact ? (
        <Link
          href={`/contacts/${assignedContact.id}`}
          className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
        >
          {assignedContact.full_name}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Status", value: project.status ? STATUS_LABELS[project.status] : "—" },
    { label: "Ratio Presented", value: project.ratio_presented || "—" },
    { label: "Ratio Real", value: project.ratio_real || "—" },
    {
      label: "Total Face Value",
      value: project.total_face_value != null ? `${project.currency} ${project.total_face_value}` : "—",
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
          <p className="mt-1 text-sm text-white/45">{project.product_type}</p>
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
        <TranchesSection projectId={project.id} tranches={tranches} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Documents</h2>
        <GlassCard interactive={false} className="p-6">
          <ProjectDocuments projectId={project.id} documents={documentsWithUrls} />
        </GlassCard>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Notes</h2>
        <GlassCard interactive={false} className="p-6">
          <LinkedNotes notes={notes} addHref={`/notes/new?project_id=${project.id}`} />
        </GlassCard>
      </div>
    </div>
  );
}
