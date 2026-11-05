"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive } from "lucide-react";
import { STAGES, STAGE_LABELS, STATUSES, STATUS_LABELS } from "@/lib/projects";
import type { Product } from "@/lib/types";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface ProjectFiltersProps {
  // Every product, active or not — a project already set to a
  // since-hidden product must still be findable by filtering on it.
  products: Product[];
}

export function ProjectFilters({ products }: ProjectFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("archived") === "true";

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
        aria-label="Filter by product"
        value={searchParams.get("product_type") ?? ""}
        onChange={(e) => setParam("product_type", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All products
        </option>
        {products.map((product) => (
          <option key={product.id} value={product.name} className="bg-[#0a0e17]">
            {product.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by stage"
        value={searchParams.get("stage") ?? ""}
        onChange={(e) => setParam("stage", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All stages
        </option>
        {STAGES.map((stage) => (
          <option key={stage} value={stage} className="bg-[#0a0e17]">
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        value={searchParams.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All statuses
        </option>
        {STATUSES.map((status) => (
          <option key={status} value={status} className="bg-[#0a0e17]">
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>

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
        {showArchived ? "Showing Archived" : "Show Archived"}
      </button>

      <select
        aria-label="Sort projects"
        value={searchParams.get("sort") ?? "last_activity_at"}
        onChange={(e) => setParam("sort", e.target.value)}
        className={`${selectClass} ml-auto`}
      >
        <option value="last_activity_at" className="bg-[#0a0e17]">
          Sort: Last activity
        </option>
        <option value="created_at" className="bg-[#0a0e17]">
          Sort: Oldest first
        </option>
        <option value="next_step_due" className="bg-[#0a0e17]">
          Sort: Next step due
        </option>
      </select>
    </div>
  );
}
