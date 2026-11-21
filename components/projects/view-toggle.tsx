"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List as ListIcon } from "lucide-react";

const STORAGE_KEY = "ark:projects-view";

// The URL (?view=board) is always the source of truth for what
// renders — a shared link always opens the view it names. localStorage
// only seeds that URL on a plain visit with no ?view= at all, so a
// browser's last choice survives a fresh page load without a link.
// Wrapped in try/catch throughout: private browsing / disabled storage
// just means "don't remember," never a thrown error.
export function ViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "board" ? "board" : "list";

  useEffect(() => {
    if (searchParams.has("view")) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "board") {
        const params = new URLSearchParams(searchParams.toString());
        params.set("view", "board");
        router.replace(`${pathname}?${params.toString()}`);
      }
    } catch {
      // localStorage unavailable — stay on the URL's own default (list).
    }
    // Deliberately mount-once: this restores a remembered view only on
    // a fresh visit with no explicit ?view= yet. Re-running on every
    // searchParams change (e.g. right after this same effect sets
    // ?view=board) would re-read storage every time, which is harmless
    // here but pointless; empty deps keeps it a single restore attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setView(next: "list" | "board") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — the URL change below still works without storage.
    }
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("view");
    else params.set("view", next);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-1">
      <button
        type="button"
        onClick={() => setView("list")}
        aria-pressed={view === "list"}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
          view === "list" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
        }`}
      >
        <ListIcon className="h-3.5 w-3.5" />
        List
      </button>
      <button
        type="button"
        onClick={() => setView("board")}
        aria-pressed={view === "board"}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
          view === "board" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Board
      </button>
    </div>
  );
}
