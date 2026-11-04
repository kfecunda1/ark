"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ACTIVITY_FILTERS, ACTIVITY_FILTER_LABELS } from "@/lib/activity";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";

export function ActivityFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
        aria-label="Filter by record type"
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All types
        </option>
        {ACTIVITY_FILTERS.map((filter) => (
          <option key={filter} value={filter} className="bg-[#0a0e17]">
            {ACTIVITY_FILTER_LABELS[filter]}
          </option>
        ))}
      </select>
    </div>
  );
}
