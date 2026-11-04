"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function NoteFilters() {
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
      <label className="flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={searchParams.get("reminders") === "true"}
          onChange={(e) => setParam("reminders", e.target.checked ? "true" : "")}
          className="h-4 w-4 rounded border-white/20 bg-white/[0.03] text-accent accent-accent"
        />
        Reminders only
      </label>
    </div>
  );
}
