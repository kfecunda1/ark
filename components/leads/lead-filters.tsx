"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, CheckCircle2 } from "lucide-react";
import { BUSINESS_LINES, BUSINESS_LINE_LABELS, STAGES, STAGE_LABELS } from "@/lib/leads";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";

export function LeadFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("archived") === "true";
  const showClosed = searchParams.get("closed") === "true";

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
        aria-label="Filter by business line"
        value={searchParams.get("business_line") ?? ""}
        onChange={(e) => setParam("business_line", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All business lines
        </option>
        {BUSINESS_LINES.map((line) => (
          <option key={line} value={line} className="bg-[#0a0e17]">
            {BUSINESS_LINE_LABELS[line]}
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

      <button
        type="button"
        onClick={() => setParam("closed", showClosed ? "" : "true")}
        aria-pressed={showClosed}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
          showClosed
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border-white/[0.06] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
        }`}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {showClosed ? "Showing Closed" : "Closed"}
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
        {showArchived ? "Showing Archived" : "Show Archived"}
      </button>

      <select
        aria-label="Sort leads"
        value={searchParams.get("sort") ?? "follow_up_date"}
        onChange={(e) => setParam("sort", e.target.value)}
        className={`${selectClass} ml-auto`}
      >
        <option value="follow_up_date" className="bg-[#0a0e17]">
          Sort: Follow-up date
        </option>
        <option value="stage_updated_at" className="bg-[#0a0e17]">
          Sort: Stage updated (oldest first)
        </option>
      </select>
    </div>
  );
}
