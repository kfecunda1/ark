"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, FileWarning } from "lucide-react";
import { STAGES, stageLabel } from "@/lib/projects";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { Product, StatusRecord } from "@/lib/types";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface ProjectFiltersProps {
  // Every product, active or not — a project already set to a
  // since-hidden product must still be findable by filtering on it.
  products: Product[];
  // Every status, active or not — same reasoning as products above.
  statuses: StatusRecord[];
  // Every person who is an intermediary on at least one project —
  // archived people included (same "a since-hidden/archived value must
  // still be findable by filtering on it" reasoning as products above).
  intermediaries: { id: string; label: string }[];
  lang?: Lang;
}

export function ProjectFilters({ products, statuses, intermediaries, lang = "en" }: ProjectFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = getDictionary(lang);
  const showArchived = searchParams.get("archived") === "true";
  const missingDocuments = searchParams.get("missing_documents") === "true";

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
    <div className="flex flex-wrap items-center gap-3">
      <select
        aria-label={t.projectsList.filterByProduct}
        value={searchParams.get("product_type") ?? ""}
        onChange={(e) => setParam("product_type", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          {t.projectsList.allProducts}
        </option>
        {products.map((product) => (
          <option key={product.id} value={product.name} className="bg-[#0a0e17]">
            {product.name}
          </option>
        ))}
      </select>

      <select
        aria-label={t.projectsList.filterByStage}
        value={searchParams.get("stage") ?? ""}
        onChange={(e) => setParam("stage", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          {t.projectsList.allStages}
        </option>
        {STAGES.map((stage) => (
          <option key={stage} value={stage} className="bg-[#0a0e17]">
            {stageLabel(stage, lang)}
          </option>
        ))}
      </select>

      <select
        aria-label={t.projectsList.filterByStatus}
        value={searchParams.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          {t.projectsList.allStatuses}
        </option>
        {[...statuses]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((status) => (
            <option key={status.id} value={status.name} className="bg-[#0a0e17]">
              {catalogLabel(status, lang)}
            </option>
          ))}
      </select>

      <select
        aria-label={t.projectsList.filterByIntermediary}
        value={searchParams.get("intermediary") ?? ""}
        onChange={(e) => setParam("intermediary", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          {t.projectsList.allIntermediaries}
        </option>
        {intermediaries.map((person) => (
          <option key={person.id} value={person.id} className="bg-[#0a0e17]">
            {person.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setParam("missing_documents", missingDocuments ? "" : "true")}
        aria-pressed={missingDocuments}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
          missingDocuments
            ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
            : "border-white/[0.06] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
        }`}
      >
        <FileWarning className="h-3.5 w-3.5" />
        {t.projectsList.missingDocuments}
      </button>

      <button
        type="button"
        onClick={() => setParam("archived", showArchived ? "" : "true")}
        aria-pressed={showArchived}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
          showArchived
            ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
            : "border-white/[0.06] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
        }`}
      >
        <Archive className="h-3.5 w-3.5" />
        {showArchived ? t.common.showingArchived : t.common.showArchived}
      </button>
    </div>
  );
}
