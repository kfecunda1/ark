import Link from "next/link";
import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ContactFilters } from "@/components/contacts/contact-filters";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactCapability } from "@/lib/types";

interface ContactsPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("contacts").select("*").order("full_name");
  const allContacts = (data as Contact[] | null) ?? [];

  const { data: capabilitiesData } = await supabase
    .from("contact_capabilities")
    .select("*")
    .order("created_at");
  const capabilitiesByContactId = new Map<string, ContactCapability[]>();
  for (const capability of (capabilitiesData as ContactCapability[] | null) ?? []) {
    const list = capabilitiesByContactId.get(capability.contact_id) ?? [];
    list.push(capability);
    capabilitiesByContactId.set(capability.contact_id, list);
  }

  const searchTerm = params.q?.trim().toLowerCase();
  const contacts = searchTerm
    ? allContacts.filter((contact) => {
        const tags = capabilitiesByContactId.get(contact.id) ?? [];
        return (
          contact.full_name.toLowerCase().includes(searchTerm) ||
          (contact.notes ?? "").toLowerCase().includes(searchTerm) ||
          tags.some((c) => c.tag.toLowerCase().includes(searchTerm))
        );
      })
    : allContacts;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Contacts</h1>
          <p className="mt-1 text-sm text-white/45">People linked to projects.</p>
        </div>
        <Link
          href="/contacts/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          New Contact
        </Link>
      </div>

      <div className="mb-4">
        <Suspense>
          <ContactFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load contacts: {error.message}
        </GlassCard>
      )}

      {!error && contacts.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Users className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">
            {searchTerm ? "No matching contacts" : "No contacts yet"}
          </p>
          <p className="max-w-xs text-xs text-white/35">
            {searchTerm
              ? "No contacts match your search."
              : "Contacts you create here can be linked to projects."}
          </p>
        </GlassCard>
      )}

      {!error && contacts.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <ClickableRow
                    key={contact.id}
                    href={`/contacts/${contact.id}`}
                    className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-white/85 group-hover:text-white">
                        {contact.full_name}
                      </span>
                      {(capabilitiesByContactId.get(contact.id) ?? []).length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {(capabilitiesByContactId.get(contact.id) ?? []).map((capability) => (
                            <span
                              key={capability.id}
                              className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent-soft"
                            >
                              {capability.tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60 group-hover:text-white">{contact.phone || "—"}</td>
                    <td className="px-4 py-3 text-white/60 group-hover:text-white">{contact.email || "—"}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {contacts.map((contact) => {
              const tags = capabilitiesByContactId.get(contact.id) ?? [];
              return (
                <ClickableCard key={contact.id} href={`/contacts/${contact.id}`}>
                  <div className="mb-3">
                    <span className="font-medium text-white/85">{contact.full_name}</span>
                    {tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {tags.map((capability) => (
                          <span
                            key={capability.id}
                            className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent-soft"
                          >
                            {capability.tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Phone</dt>
                      <dd className="mt-0.5 text-white/60">{contact.phone || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Email</dt>
                      <dd className="mt-0.5 text-white/60">{contact.email || "—"}</dd>
                    </div>
                  </dl>
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
