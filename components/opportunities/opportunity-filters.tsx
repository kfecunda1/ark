"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";
import type { EntityOption } from "@/components/entity-picker";
import type { OpportunityStatus, Product } from "@/lib/types";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface OpportunityFiltersProps {
  products: Product[];
  intermediaries: EntityOption[];
  lang?: Lang;
}

const STATUSES: OpportunityStatus[] = ["open", "converted", "closed"];

// "Open" is the default view — unlike Receivers' plain archived/not
// toggle, missing ?status= here means "open", not "every status at
// once" (there is no "all" tab at all, per the task's own spec).
export function OpportunityFilters({ products, intermediaries, lang = "en" }: OpportunityFiltersProps) {
  const t = getDictionary(lang);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const status = (searchParams.get("status") as OpportunityStatus | null) ?? "open";

  useEffect(() => {
    const currentQ = searchParams.get("q") ?? "";
    if (query === currentQ) return;

    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set("q", query);
      } else {
        params.delete("q");
      }
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    }, 300);

    return () => clearTimeout(timeout);
  }, [query, searchParams, pathname, router]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-fit items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setParam("status", s === "open" ? "" : s)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
              status === s ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {t.opportunities.statusLabels[s]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            aria-label={t.opportunities.searchOpportunities}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.opportunities.searchPlaceholder}
            className="w-64 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
          />
        </div>

        <select
          aria-label={t.opportunities.filterByProduct}
          value={searchParams.get("product_type") ?? ""}
          onChange={(e) => setParam("product_type", e.target.value)}
          className={selectClass}
        >
          <option value="" className="bg-[#0a0e17]">
            {t.receivers.allProducts}
          </option>
          {products.map((product) => (
            <option key={product.id} value={product.name} className="bg-[#0a0e17]">
              {product.name}
            </option>
          ))}
        </select>

        <select
          aria-label={t.opportunities.filterByIntermediary}
          value={searchParams.get("intermediary") ?? ""}
          onChange={(e) => setParam("intermediary", e.target.value)}
          className={selectClass}
        >
          <option value="" className="bg-[#0a0e17]">
            {t.opportunities.allIntermediaries}
          </option>
          {intermediaries.map((person) => (
            <option key={person.id} value={person.id} className="bg-[#0a0e17]">
              {person.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
