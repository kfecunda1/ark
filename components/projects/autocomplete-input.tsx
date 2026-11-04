"use client";

import { useState } from "react";

interface AutocompleteInputProps {
  id?: string;
  name: string;
  defaultValue?: string;
  suggestions?: string[];
  placeholder?: string;
  required?: boolean;
  className: string;
}

// Free-text input with a suggestions dropdown of existing values — same
// pattern as CapabilityFields' tag suggestions, adapted for a single value
// instead of a repeatable list. Typing an entirely new value is always
// allowed; the dropdown is just a shortcut to reuse an existing one.
export function AutocompleteInput({
  id,
  name,
  defaultValue = "",
  suggestions = [],
  placeholder,
  required,
  className,
}: AutocompleteInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);

  function matchesFor(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  }

  const options = open ? matchesFor(value) : [];

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        required={required}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />

      {options.length > 0 && (
        <ul className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
          {options.map((option) => (
            <li
              key={option}
              onMouseDown={(e) => {
                e.preventDefault();
                setValue(option);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
