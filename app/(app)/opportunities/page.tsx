import Link from "next/link";
import { Suspense } from "react";
import { Plus, Briefcase } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { SortableHeader, MobileSortControl, type SortOption } from "@/components/sort-controls";
import { createClient } from "@/lib/supabase/server";
import { getAllProducts } from "@/lib/products";
import { getOpportunityProductsByOpportunityIds, displayOpportunityProducts } from "@/lib/opportunity-products";
import { isOpportunityStale } from "@/lib/opportunities";
import { compareNullsLast, parseSortDirection } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";
import { personLabel } from "@/lib/people";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Opportunity, OpportunityStatus, Person } from "@/lib/types";

const OPPORTUNITY_SORT_KEYS = ["title", "intermediary", "document_count", "last_activity_at", "created_at"] as const;
type OpportunitySortKey = (typeof OPPORTUNITY_SORT_KEYS)[number];

function isOpportunitySortKey(value: string | undefined): value is OpportunitySortKey {
  return (OPPORTUNITY_SORT_KEYS as readonly string[]).includes(value ?? "");
}

interface OpportunitiesPageProps {
  searchParams: Promise<{
    q?: string;
    product_type?: string;
    intermediary?: string;
    status?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const params = await searchParams;
  const sort: OpportunitySortKey = isOpportunitySortKey(params.sort) ? params.sort : "last_activity_at";
  const dir = parseSortDirection(params.dir);
  const status: OpportunityStatus =
    params.status === "converted" || params.status === "closed" ? params.status : "open";

  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const SORT_OPTIONS: SortOption[] = [
    { value: "title", label: t.opportunities.colTitle },
    { value: "intermediary", label: t.opportunities.colIntermediary },
    { value: "document_count", label: t.opportunities.colDocuments },
    { value: "last_activity_at", label: t.opportunities.colLastActivity },
    { value: "created_at", label: t.common.created },
  ];

  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").select("*").eq("status", status);
  const allOpportunities = (data as Opportunity[] | null) ?? [];

  const products = await getAllProducts();

  const [{ data: peopleData }, { data: docsData }] = await Promise.all([
    supabase.from("people").select("id, first_name, last_name, archived_at").is("archived_at", null).order("first_name"),
    supabase.from("opportunity_documents").select("opportunity_id"),
  ]);

  const allPeople = (peopleData as Pick<Person, "id" | "first_name" | "last_name" | "archived_at">[] | null) ?? [];
  const peopleById = new Map(allPeople.map((p) => [p.id, p]));

  const opportunityProductsById = await getOpportunityProductsByOpportunityIds(allOpportunities.map((o) => o.id));

  const documentCountById = new Map<string, number>();
  for (const row of (docsData as { opportunity_id: string }[] | null) ?? []) {
    documentCountById.set(row.opportunity_id, (documentCountById.get(row.opportunity_id) ?? 0) + 1);
  }

  // Every person who is at least one opportunity's intermediary,
  // system-wide (not just among the ones on this page) — same "every
  // option still in play, not just what's visible" rule the Projects
  // list's own intermediary filter follows.
  const { data: allIntermediaryIdsData } = await supabase
    .from("opportunities")
    .select("intermediary_person_id")
    .not("intermediary_person_id", "is", null);
  const intermediaryIds = [
    ...new Set(((allIntermediaryIdsData as { intermediary_person_id: string }[] | null) ?? []).map((r) => r.intermediary_person_id)),
  ];
  const intermediaryOptions = intermediaryIds
    .map((id) => peopleById.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ id: p.id, label: personLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const searchTerm = params.q?.trim().toLowerCase();
  const productFilter = params.product_type;
  const intermediaryFilter = params.intermediary;

  let opportunities = allOpportunities.filter((o) => {
    if (intermediaryFilter && o.intermediary_person_id !== intermediaryFilter) return false;
    if (productFilter) {
      const opts = opportunityProductsById.get(o.id) ?? [];
      if (!opts.some((p) => p.product === productFilter)) return false;
    }
    if (searchTerm) {
      const intermediaryName = o.intermediary_person_id ? personLabel(peopleById.get(o.intermediary_person_id) ?? { first_name: "", last_name: null }) : "";
      return o.title.toLowerCase().includes(searchTerm) || intermediaryName.toLowerCase().includes(searchTerm);
    }
    return true;
  });

  function sortValue(o: Opportunity, key: OpportunitySortKey): number | string | null {
    switch (key) {
      case "title":
        return o.title.toLowerCase();
      case "intermediary":
        return o.intermediary_person_id ? personLabel(peopleById.get(o.intermediary_person_id) ?? { first_name: "", last_name: null }).toLowerCase() : null;
      case "document_count":
        return documentCountById.get(o.id) ?? 0;
      case "last_activity_at":
        return o.last_activity_at;
      case "created_at":
        return o.created_at;
    }
  }

  opportunities = [...opportunities].sort((a, b) => compareNullsLast(a, b, (o) => sortValue(o, sort), dir));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.opportunities.title}</h1>
          <p className="mt-1 text-sm text-white/45">{t.opportunities.subtitle}</p>
        </div>
        <Link
          href="/opportunities/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          {t.opportunities.newOpportunity}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <Suspense>
          <OpportunityFilters products={products} intermediaries={intermediaryOptions} lang={lang} />
        </Suspense>
        <Suspense>
          <MobileSortControl options={SORT_OPTIONS} currentSort={sort} currentDir={dir} lang={lang} />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          {t.opportunities.failedToLoad(error.message)}
        </GlassCard>
      )}

      {!error && opportunities.length === 0 && (
        <GlassCard interactive={false} className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Briefcase className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">
            {searchTerm || productFilter || intermediaryFilter ? t.opportunities.noMatching : t.opportunities.noneYet(t.opportunities.statusLabels[status])}
          </p>
          <p className="max-w-xs text-xs text-white/35">{t.opportunities.emptyHint}</p>
        </GlassCard>
      )}

      {!error && opportunities.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <SortableHeader sortKey="title" label={t.opportunities.colTitle} currentSort={sort} currentDir={dir} />
                  <SortableHeader sortKey="intermediary" label={t.opportunities.colIntermediary} currentSort={sort} currentDir={dir} />
                  <th className="px-4 py-3 font-medium">{t.opportunities.colProducts}</th>
                  <SortableHeader
                    sortKey="document_count"
                    label={t.opportunities.colDocuments}
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <SortableHeader
                    sortKey="last_activity_at"
                    label={t.opportunities.colLastActivity}
                    currentSort={sort}
                    currentDir={dir}
                    defaultDir="desc"
                  />
                  <th className="px-4 py-3 font-medium">{t.opportunities.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => {
                  const person = o.intermediary_person_id ? peopleById.get(o.intermediary_person_id) : undefined;
                  const opts = opportunityProductsById.get(o.id) ?? [];
                  const stale = isOpportunityStale(o.last_activity_at);
                  return (
                    <ClickableRow
                      key={o.id}
                      href={`/opportunities/${o.id}`}
                      className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 text-white/85 group-hover:text-white">{o.title}</td>
                      <td className="px-4 py-3 text-white/70">{person ? personLabel(person) : "—"}</td>
                      <td className="px-4 py-3 text-white/70">{displayOpportunityProducts(opts)}</td>
                      <td className="px-4 py-3 text-white/70">{documentCountById.get(o.id) ?? 0}</td>
                      <td className={`px-4 py-3 ${stale ? "font-medium text-amber-300" : "text-white/50"}`}>
                        {formatDateTime(o.last_activity_at, lang)}
                      </td>
                      <td className="px-4 py-3">
                        <OpportunityStatusBadge status={o.status} lang={lang} />
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {opportunities.map((o) => {
              const person = o.intermediary_person_id ? peopleById.get(o.intermediary_person_id) : undefined;
              const opts = opportunityProductsById.get(o.id) ?? [];
              const stale = isOpportunityStale(o.last_activity_at);
              return (
                <ClickableCard key={o.id} href={`/opportunities/${o.id}`}>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-white/85">{o.title}</span>
                    <OpportunityStatusBadge status={o.status} lang={lang} />
                  </div>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        {t.opportunities.colIntermediary}
                      </dt>
                      <dd className="mt-0.5 text-white/70">{person ? personLabel(person) : "—"}</dd>
                    </div>
                    {opts.length > 0 && (
                      <div>
                        <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                          {t.opportunities.colProducts}
                        </dt>
                        <dd className="mt-0.5 text-white/70">{displayOpportunityProducts(opts)}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        {t.opportunities.colLastActivity}
                      </dt>
                      <dd className={`mt-0.5 ${stale ? "font-medium text-amber-300" : "text-white/50"}`}>
                        {formatDateTime(o.last_activity_at, lang)}
                      </dd>
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
