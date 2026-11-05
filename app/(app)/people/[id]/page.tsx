import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ArchivedBadge } from "@/components/archived-badge";
import { ArchiveToggleButton } from "@/components/archive-toggle-button";
import { DeletePersonButton } from "@/components/people/delete-person-button";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { personLabel } from "@/lib/people";
import { displayProduct, getProjectProductsByProjectIds } from "@/lib/project-products";
import type { Contact, Person, Project } from "@/lib/types";

interface PersonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonDetailPage({ params }: PersonDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  const person = data as Person | null;

  if (!person) {
    notFound();
  }

  const [{ data: receiversData }, { data: projectsData }, isAdmin] = await Promise.all([
    supabase.from("contacts").select("id, full_name, archived_at").eq("contact_person_id", id).order("full_name"),
    supabase.from("projects").select("*").eq("contact_person_id", id).order("created_at", { ascending: false }),
    isCurrentUserAdmin(),
  ]);

  const linkedReceivers = (receiversData as Pick<Contact, "id" | "full_name" | "archived_at">[] | null) ?? [];
  const linkedProjects = (projectsData as Project[] | null) ?? [];
  const linkedProjectProductsById = await getProjectProductsByProjectIds(linkedProjects.map((p) => p.id));

  const fields: { label: string; value: string }[] = [
    { label: "Phone", value: person.phone || "—" },
    { label: "Email", value: person.email || "—" },
    { label: "Created", value: formatDateTime(person.created_at) },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/people" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to contacts
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{personLabel(person)}</h1>
            {person.archived_at && <ArchivedBadge />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/people/${person.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          <ArchiveToggleButton entityType="person" entityId={person.id} archived={Boolean(person.archived_at)} />
          {isAdmin && (
            <DeletePersonButton
              personId={person.id}
              redirectTo="/people"
              linkedProjectCount={linkedProjects.length}
              linkedReceiverCount={linkedReceivers.length}
            />
          )}
        </div>
      </div>

      <GlassCard interactive={false} className="p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">{field.label}</dt>
              <dd className="mt-1 text-sm text-white/85">{field.value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Linked Receivers</h2>
        {linkedReceivers.length === 0 ? (
          <p className="text-sm text-white/35">Not linked as the contact person for any Receiver.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {linkedReceivers.map((receiver) => (
              <Link
                key={receiver.id}
                href={`/receivers/${receiver.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-white/80">{receiver.full_name}</span>
                {receiver.archived_at && <ArchivedBadge />}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Linked Projects</h2>
        {linkedProjects.length === 0 ? (
          <p className="text-sm text-white/35">Not linked as the contact person for any Project.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {linkedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-white/80">{project.name}</span>
                <span className="shrink-0 text-xs text-white/35">
                  {displayProduct(project.final_product, linkedProjectProductsById.get(project.id) ?? []) ?? "—"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
