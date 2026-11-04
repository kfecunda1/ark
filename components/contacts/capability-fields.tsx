"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ContactCapability } from "@/lib/types";

interface CapabilityRow {
  key: string;
  id: string | null;
  tag: string;
}

interface CapabilityFieldsProps {
  initialCapabilities?: ContactCapability[];
  existingTags?: string[];
}

export function CapabilityFields({ initialCapabilities = [], existingTags = [] }: CapabilityFieldsProps) {
  const [rows, setRows] = useState<CapabilityRow[]>(
    initialCapabilities.map((c) => ({ key: c.id, id: c.id, tag: c.tag }))
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  function addRow() {
    setRows((prev) => [...prev, { key: crypto.randomUUID(), id: null, tag: "" }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function updateTag(key: string, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, tag: value } : row)));
  }

  function suggestionsFor(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return existingTags.filter((tag) => tag.toLowerCase().includes(q)).slice(0, 8);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const suggestions = openKey === row.key ? suggestionsFor(row.tag) : [];

        return (
          <div key={row.key} className="flex items-center gap-2">
            <input type="hidden" name="capability_id" value={row.id ?? ""} />
            <div className="relative w-full">
              <input
                name="capability_tag"
                value={row.tag}
                onChange={(e) => {
                  updateTag(row.key, e.target.value);
                  setOpenKey(row.key);
                }}
                onFocus={() => setOpenKey(row.key)}
                onBlur={() => setTimeout(() => setOpenKey((k) => (k === row.key ? null : k)), 120)}
                placeholder='e.g. "Oil - EN590" or "BTC - Face to Face Dubai"'
                autoComplete="off"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]"
              />

              {suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
                  {suggestions.map((tag) => (
                    <li
                      key={tag}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        updateTag(row.key, tag);
                        setOpenKey(null);
                      }}
                      className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              aria-label="Remove capability"
              className="shrink-0 rounded-md p-2 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Capability
      </button>
    </div>
  );
}
