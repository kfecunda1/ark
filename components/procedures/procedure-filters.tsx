"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { BUSINESS_LINES, BUSINESS_LINE_LABELS } from "@/lib/leads";
import { STATUSES, STATUS_LABELS } from "@/lib/procedures";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";

export function ProcedureFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

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

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          aria-label="Search procedures"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or content…"
          className="w-56 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]"
        />
      </div>

      <select
        aria-label="Filter by area"
        value={searchParams.get("area") ?? ""}
        onChange={(e) => setParam("area", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All areas
        </option>
        {BUSINESS_LINES.map((line) => (
          <option key={line} value={line} className="bg-[#0a0e17]">
            {BUSINESS_LINE_LABELS[line]}
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
    </div>
  );
}
