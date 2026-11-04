import Link from "next/link";
import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ContactFilters } from "@/components/contacts/contact-filters";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactProduct, ProductType } from "@/lib/types";

interface ContactsPageProps {
  searchParams: Promise<{ q?: string; product_type?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("contacts").select("*").order("full_name");
  const allContacts = (data as Contact[] | null) ?? [];

  const { data: productsData } = await supabase.from("contact_products").select("*").order("created_at");
  const productsByContactId = new Map<string, ContactProduct[]>();
  for (const product of (productsData as ContactProduct[] | null) ?? []) {
    const list = productsByContactId.get(product.contact_id) ?? [];
    list.push(product);
    productsByContactId.set(product.contact_id, list);
  }

  const searchTerm = params.q?.trim().toLowerCase();
  const productFilter = params.product_type as ProductType | undefined;

  const contacts = allContacts.filter((contact) => {
    const products = productsByContactId.get(contact.id) ?? [];
    if (productFilter && !products.some((p) => p.product_type === productFilter)) return false;
    if (searchTerm) {
      return (
        contact.full_name.toLowerCase().includes(searchTerm) ||
        (contact.notes ?? "").toLowerCase().includes(searchTerm)
      );
    }
    return true;
  });

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
            {searchTerm || productFilter ? "No matching contacts" : "No contacts yet"}
          </p>
          <p className="max-w-xs text-xs text-white/35">
            {searchTerm || productFilter
              ? "No contacts match your filters."
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
                  <th className="px-4 py-3 font-medium">Products</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const products = productsByContactId.get(contact.id) ?? [];
                  return (
                    <ClickableRow
                      key={contact.id}
                      href={`/contacts/${contact.id}`}
                      className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-white/85 group-hover:text-white">
                          {contact.full_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {products.length === 0 ? (
                          <span className="text-white/35">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {products.map((product) => (
                              <span
                                key={product.id}
                                className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent-soft"
                              >
                                {product.product_type}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {contacts.map((contact) => {
              const products = productsByContactId.get(contact.id) ?? [];
              return (
                <ClickableCard key={contact.id} href={`/contacts/${contact.id}`}>
                  <span className="font-medium text-white/85">{contact.full_name}</span>
                  {products.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {products.map((product) => (
                        <span
                          key={product.id}
                          className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent-soft"
                        >
                          {product.product_type}
                        </span>
                      ))}
                    </div>
                  )}
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
