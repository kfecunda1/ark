import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { LinkedNotes } from "@/components/notes/linked-notes";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactCapability, Note, Project } from "@/lib/types";

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactDetailPage({ params }: ContactDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  const contact = data as Contact | null;

  if (!contact) {
    notFound();
  }

  const [{ data: leadsData }, { data: capabilitiesData }, { data: notesData }] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .or(`primary_contact_id.eq.${id},counterparty_contact_id.eq.${id}`)
      .order("created_at", { ascending: false }),
    supabase.from("contact_capabilities").select("*").eq("contact_id", id).order("created_at"),
    supabase.from("notes").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
  ]);

  const relatedProjects = (leadsData as Project[] | null) ?? [];
  const capabilities = (capabilitiesData as ContactCapability[] | null) ?? [];
  const notes = (notesData as Note[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/contacts" className="text-xs font-medium text-white/40 hover:text-white/70">
            ← Back to contacts
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{contact.full_name}</h1>
        </div>
        <Link
          href={`/contacts/${contact.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Link>
      </div>

      <GlassCard interactive={false} className="p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">Phone</dt>
            <dd className="mt-1 text-sm text-white/85">{contact.phone || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">Email</dt>
            <dd className="mt-1 text-sm text-white/85">{contact.email || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">Capabilities</dt>
            <dd className="mt-1.5">
              {capabilities.length === 0 ? (
                <span className="text-sm text-white/40">—</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.map((capability) => (
                    <span
                      key={capability.id}
                      className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-indigo-300"
                    >
                      {capability.tag}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium tracking-wide text-white/35 uppercase">Notes</dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap text-white/85">{contact.notes || "—"}</dd>
          </div>
        </dl>
      </GlassCard>

      {relatedProjects.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Related Projects</h2>
          <div className="flex flex-col gap-2">
            {relatedProjects.map((project) => {
              const role = project.primary_contact_id === contact.id ? "Primary" : "Counterparty";
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/50">
                    {role}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white/80">{project.product_type}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-white/35">Not yet linked to any projects.</p>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">Linked Notes</h2>
        <GlassCard interactive={false} className="p-6">
          <LinkedNotes notes={notes} addHref={`/notes/new?contact_id=${contact.id}`} />
        </GlassCard>
      </div>
    </div>
  );
}
