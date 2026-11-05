"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { runGlobalSearch, searchResultHref, type SearchResult, type SearchResultType } from "@/lib/search";

const GROUP_LABELS: Record<SearchResultType, string> = {
  project: "Projects",
  contact: "Receivers",
  document: "Documents",
  note: "Notes",
  person: "Contacts",
};

const GROUP_ORDER: SearchResultType[] = ["project", "contact", "document", "note", "person"];

export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    const timeout = setTimeout(async () => {
      if (cancelled) return;
      if (trimmed.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const found = await runGlobalSearch(trimmed);
        if (!cancelled) setResults(found);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function goTo(result: SearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(searchResultHref(result));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      goTo(results[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative hidden max-w-md flex-1 sm:block">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search projects, receivers, contacts, notes…"
        className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
      />

      {showDropdown && (
        <div className="absolute z-40 mt-1.5 max-h-96 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
          {loading && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && <p className="px-3 py-3 text-sm text-white/35">No matches.</p>}
          {GROUP_ORDER.map((type) => {
            const group = results.filter((r) => r.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type} className="border-b border-white/[0.06] py-1 last:border-0">
                <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-white/35 uppercase">
                  {GROUP_LABELS[type]}
                </p>
                {group.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => goTo(result)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-white/[0.06]"
                  >
                    <span className="truncate text-sm text-white/85">{result.title}</span>
                    <span className="truncate text-xs text-white/40">{result.subtitle}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
