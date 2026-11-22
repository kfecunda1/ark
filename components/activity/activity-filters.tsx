"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ACTIVITY_FILTERS, activityFilterLabel } from "@/lib/activity";
import { getDictionary, type Lang } from "@/lib/i18n";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

export function ActivityFilters({ lang = "en" }: { lang?: Lang } = {}) {
  const router = useRouter();
  const t = getDictionary(lang);
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
        aria-label={t.activity.filterByRecordType}
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          {t.activity.allTypes}
        </option>
        {ACTIVITY_FILTERS.map((filter) => (
          <option key={filter} value={filter} className="bg-[#0a0e17]">
            {activityFilterLabel(filter, lang)}
          </option>
        ))}
      </select>
    </div>
  );
}
