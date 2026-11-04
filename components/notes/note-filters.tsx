"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";

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
          className="h-4 w-4 rounded border-white/20 bg-white/[0.03] text-indigo-500 accent-indigo-500"
        />
        Reminders only
      </label>

      <select
        aria-label="Filter by linked type"
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All types
        </option>
        <option value="project" className="bg-[#0a0e17]">
          Projects
        </option>
        <option value="contact" className="bg-[#0a0e17]">
          Contacts
        </option>
      </select>
    </div>
  );
}
