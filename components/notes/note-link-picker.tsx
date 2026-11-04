"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export interface LinkOption {
  id: string;
  label: string;
}

interface NoteLinkPickerProps {
  contacts: LinkOption[];
  defaultContactId?: string | null;
}

const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

// A note's only possible link is a contact (projects no longer link to
// notes — see supabase/migrations/004_timeline.sql), so this is just a
// search-select with a clear button, not a link-type switcher.
export function NoteLinkPicker({ contacts, defaultContactId = null }: NoteLinkPickerProps) {
  const [selected, setSelected] = useState<LinkOption | null>(
    () => contacts.find((c) => c.id === defaultContactId) ?? null
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? contacts.filter((o) => o.label.toLowerCase().includes(q)) : contacts;
    return matches.slice(0, 20);
  }, [query, contacts]);

  return (
    <div>
      <label className={labelClass}>Link to Contact (optional)</label>
      <input type="hidden" name="contact_id" value={selected?.id ?? ""} />

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={selected ? selected.label : query}
          onChange={(e) => {
            setSelected(null);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search contacts…"
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-2.5 pr-9 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
        />
        {selected && (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            aria-label="Clear selection"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {open && !selected && (
          <ul className="absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-white/35">No matches.</li>}
            {filtered.map((option) => (
              <li
                key={option.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelected(option);
                  setQuery("");
                  setOpen(false);
                }}
                className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
