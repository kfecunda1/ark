import Link from "next/link";
import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ContactFilters } from "@/components/contacts/contact-filters";
import { SortableHeader, MobileSortControl, type SortOption } from "@/components/sort-controls";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { compareNullsLast, parseSortDirection } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";
import type { Contact, ContactProduct, ProductType } from "@/lib/types";

const CONTACT_SORT_KEYS = ["name", "products_count", "matched_count", "created_at"] as const;
type ContactSortKey = (typeof CONTACT_SORT_KEYS)[number];

function isContactSortKey(value: string | undefined): value is ContactSortKey {
  return (CONTACT_SORT_KEYS as readonly string[]).includes(value ?? "");
}

const SORT_OPTIONS: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "products_count", label: "Number of products" },
  { value: "matched_count", label: "Number of matched projects" },
  { value: "created_at", label: "Created" },
];

interface ContactsPageProps {
  searchParams: Promise<{ q?: string; product_type?: string; sort?: string; dir?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const sort: ContactSortKey = isContactSortKey(params.sort) ? params.sort : "name";
  const dir = parseSortDirection(params.dir);

  const supabase = await createClient();
  const { data, error } = await supabase.from("contacts").select("*");
  const allContacts = (data as Contact[] | null) ?? [];

  const products = await getAllProducts();

  const [{ data: contactProductsData }, { data: matchedProjectsData }] = await Promise.all([
    supabase.from("contact_products").select("*"),
    supabase.from("projects").select("id, matched_contact_id").not("matched_contact_id", "is", null),
  ]);

  const productsByContactId = new Map<string, ContactProduct[]>();
  for (const product of (contactProductsData as ContactProduct[] | null) ?? []) {
    const list = productsByContactId.get(product.contact_id) ?? [];
    list.push(product);
    productsByContactId.set(product.contact_id, list);
  }

  const matchedCountByContactId = new Map<string, number>();
  for (const row of (matchedProjectsData as { id: string; matched_contact_id: string }[] | null) ?? []) {
    matchedCountByContactId.set(row.matched_contact_id, (matchedCountByContactId.get(row.matched_contact_id) ?? 0) + 1);
  }

  const searchTerm = params.q?.trim().toLowerCase();
  const productFilter = params.product_type as ProductType | undefined;

  let contacts = allContacts.filter((contact) => {
    const contactProducts = productsByContactId.get(contact.id) ?? [];
    if (productFilter && !contactProducts.some((p) => p.product_type === productFilter)) return false;
    if (searchTerm) {
      return (
        contact.full_name.toLowerCase().includes(searchTerm) ||
        (contact.notes ?? "").toLowerCase().includes(searchTerm)
      );
    }
    return true;
  });

  function sortValue(contact: Contact, key: ContactSortKey): number | string | null {
    switch (key) {
      case "name":
        return contact.full_name.toLowerCase();
      case "products_count":
        return (productsByContactId.get(contact.id) ?? []).length;
      case "matched_count":
        return matchedCountByContactId.get(contact.id) ?? 0;
      case "created_at":
        return contact.created_at;
    }
  }

  contacts = [...contacts].sort((a, b) => compareNullsLast(a, b, (c) => sortValue(c, sort), dir));

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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Suspense>
          <ContactFilters products={products} />
          <MobileSortControl options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />
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
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <SortableHeader sortKey="name" label="Name" currentSort={sort} currentDir={dir} />
                  <th className="px-4 py-3 font-medium">Products</th>
                  <SortableHeader
                    sortKey="products_count"
                    label="# Products"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader
                    sortKey="matched_count"
                    label="# Matched Projects"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader
                    sortKey="created_at"
                    label="Created"
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const contactProducts = productsByContactId.get(contact.id) ?? [];
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
                        {contactProducts.length === 0 ? (
                          <span className="text-white/35">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {contactProducts.map((product) => (
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
                      <td className="px-4 py-3 text-white/70">{contactProducts.length}</td>
                      <td className="px-4 py-3 text-white/70">{matchedCountByContactId.get(contact.id) ?? 0}</td>
                      <td className="px-4 py-3 text-white/50">{formatDateTime(contact.created_at)}</td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {contacts.map((contact) => {
              const contactProducts = productsByContactId.get(contact.id) ?? [];
              return (
                <ClickableCard key={contact.id} href={`/contacts/${contact.id}`}>
                  <span className="font-medium text-white/85">{contact.full_name}</span>
                  {contactProducts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {contactProducts.map((product) => (
                        <span
                          key={product.id}
                          className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent-soft"
                        >
                          {product.product_type}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-white/35">
                    {matchedCountByContactId.get(contact.id) ?? 0} matched project
                    {(matchedCountByContactId.get(contact.id) ?? 0) === 1 ? "" : "s"}
                  </p>
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
