"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export interface LinkOption {
  id: string;
  label: string;
}

type LinkType = "" | "lead" | "procedure" | "contact";

interface NoteLinkPickerProps {
  leads: LinkOption[];
  procedures: LinkOption[];
  contacts: LinkOption[];
  defaultLinkType?: LinkType;
  defaultLinkId?: string | null;
}

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function NoteLinkPicker({
  leads,
  procedures,
  contacts,
  defaultLinkType = "",
  defaultLinkId = null,
}: NoteLinkPickerProps) {
  const [linkType, setLinkType] = useState<LinkType>(defaultLinkType);

  const optionsByType: Record<Exclude<LinkType, "">, LinkOption[]> = { lead: leads, procedure: procedures, contact: contacts };

  const [selected, setSelected] = useState<LinkOption | null>(
    () => (defaultLinkType && defaultLinkId ? (optionsByType[defaultLinkType].find((o) => o.id === defaultLinkId) ?? null) : null)
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const options: Record<Exclude<LinkType, "">, LinkOption[]> = { lead: leads, procedure: procedures, contact: contacts };
    const pool = linkType ? options[linkType] : [];
    const q = query.trim().toLowerCase();
    const matches = q ? pool.filter((o) => o.label.toLowerCase().includes(q)) : pool;
    return matches.slice(0, 20);
  }, [linkType, query, leads, procedures, contacts]);

  function handleTypeChange(value: LinkType) {
    setLinkType(value);
    setSelected(null);
    setQuery("");
    setOpen(false);
  }

  return (
    <div>
      <label className={labelClass}>Link to</label>
      <input type="hidden" name="link_type" value={linkType} />
      <input type="hidden" name="link_id" value={selected?.id ?? ""} />

      <select
        value={linkType}
        onChange={(e) => handleTypeChange(e.target.value as LinkType)}
        className={`${selectClass} w-full`}
      >
        <option value="" className="bg-[#0a0e17]">
          No link
        </option>
        <option value="lead" className="bg-[#0a0e17]">
          Lead
        </option>
        <option value="procedure" className="bg-[#0a0e17]">
          Procedure
        </option>
        <option value="contact" className="bg-[#0a0e17]">
          Contact
        </option>
      </select>

      {linkType && (
        <div className="relative mt-2">
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
            placeholder={`Search ${linkType}s…`}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-2.5 pr-9 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]"
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
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-white/35">No matches.</li>
              )}
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
      )}
    </div>
  );
}
