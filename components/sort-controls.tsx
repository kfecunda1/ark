"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortDirection } from "@/lib/sort";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface SortableHeaderProps {
  sortKey: string;
  label: string;
  // The page's already-resolved sort/dir (its own default applied when
  // the URL has neither param) — not re-derived from raw searchParams
  // here, so the column a page defaults to still shows its arrow on a
  // first load with no `sort`/`dir` in the URL at all.
  currentSort: string;
  currentDir: SortDirection;
  // Direction to apply the first time this column is clicked (while
  // some other column is active) — a second click on the same column
  // always just flips whatever direction it's already showing.
  defaultDir?: SortDirection;
  className?: string;
}

// A clickable <th> for the desktop table — mirrors components/projects/
// project-filters.tsx's controls in spirit (reads/writes the URL
// directly) but takes the page's resolved sort state as props instead
// of re-deriving it, specifically so the default-sorted column reads
// as active before the user has ever clicked anything.
export function SortableHeader({
  sortKey,
  label,
  currentSort,
  currentDir,
  defaultDir = "asc",
  className,
}: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = currentSort === sortKey;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", sortKey);
    params.set("dir", active ? (currentDir === "asc" ? "desc" : "asc") : defaultDir);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <th className={`px-4 py-3 font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1 whitespace-nowrap text-inherit transition-colors duration-150 ease-out hover:text-white"
      >
        {label}
        {active &&
          (currentDir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-accent-soft" />
          ) : (
            <ArrowDown className="h-3 w-3 text-accent-soft" />
          ))}
      </button>
    </th>
  );
}

export interface SortOption {
  value: string;
  label: string;
}

interface MobileSortControlProps {
  options: SortOption[];
  currentSort: string;
  currentDir: SortDirection;
}

// The mobile equivalent of SortableHeader — there's no table to put
// clickable headers on below md, so this is a "Sort by" select plus a
// direction-toggle button instead, shown only below that breakpoint
// (the filter bars this sits in already render their other controls
// at every width; this is the one piece that's mobile-only, since
// desktop uses the column headers for the exact same job). Takes the
// same page-resolved current state as props, for the same reason.
export function MobileSortControl({ options, currentSort, currentDir }: MobileSortControlProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 md:hidden">
      <select
        aria-label="Sort by"
        value={currentSort}
        onChange={(e) => setParam("sort", e.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0a0e17]">
            Sort: {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setParam("dir", currentDir === "asc" ? "desc" : "asc")}
        aria-label={currentDir === "asc" ? "Sort ascending" : "Sort descending"}
        className="shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2 text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
      >
        {currentDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
