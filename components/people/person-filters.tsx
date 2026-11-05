"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, Search } from "lucide-react";

export function PersonFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const showArchived = searchParams.get("archived") === "true";

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
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          aria-label="Search contacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, or email…"
          className="w-72 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
        />
      </div>

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
    </div>
  );
}
