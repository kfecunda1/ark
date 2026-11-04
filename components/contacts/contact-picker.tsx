"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { quickCreateContact } from "@/lib/actions/contacts";
import { contactLabel } from "@/lib/contacts";

export interface ContactOption {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

interface ContactPickerProps {
  name: string;
  label: string;
  contacts: ContactOption[];
  defaultContactId?: string | null;
  placeholder?: string;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const smallFieldClass =
  "w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function ContactPicker({ name, label, contacts, defaultContactId, placeholder }: ContactPickerProps) {
  const [allContacts, setAllContacts] = useState(contacts);
  const [selected, setSelected] = useState<ContactOption | null>(
    () => allContacts.find((c) => c.id === defaultContactId) ?? null
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? allContacts.filter((c) => c.full_name.toLowerCase().includes(q)) : allContacts;
    return pool.slice(0, 20);
  }, [allContacts, query]);

  function selectContact(contact: ContactOption) {
    setSelected(contact);
    setQuery("");
    setOpen(false);
  }

  function clearSelection() {
    setSelected(null);
    setQuery("");
  }

  function startCreating() {
    setError(null);
    setNewName(query.trim());
    setNewPhone("");
    setNewEmail("");
    setCreating(true);
    setOpen(false);
  }

  function cancelCreating() {
    setCreating(false);
    setError(null);
  }

  function handleCreate() {
    if (!newName.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await quickCreateContact({
          full_name: newName.trim(),
          phone: newPhone.trim() || null,
          email: newEmail.trim() || null,
        });
        if (result.error || !result.contact) {
          setError(result.error ?? "Could not create contact.");
          return;
        }
        const created = result.contact;
        setAllContacts((prev) => [...prev, created]);
        selectContact(created);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />

      {!creating && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={selected ? contactLabel(selected) : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={placeholder ?? "Search contacts…"}
            className={`${fieldClass} pr-9 pl-9`}
          />
          {selected && (
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear contact"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {open && !selected && (
            <ul className="absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-white/35">No matching contacts.</li>
              )}
              {filtered.map((contact) => (
                <li
                  key={contact.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectContact(contact);
                  }}
                  className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                >
                  {contactLabel(contact)}
                </li>
              ))}
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  startCreating();
                }}
                className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-2 text-sm font-medium text-accent-soft transition-colors duration-100 ease-out hover:bg-white/[0.06]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                New contact{query.trim() ? ` "${query.trim()}"` : ""}
              </li>
            </ul>
          )}
        </div>
      )}

      {creating && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              autoFocus
              placeholder="Name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={smallFieldClass}
            />
            <input
              placeholder="Phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className={smallFieldClass}
            />
            <input
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={smallFieldClass}
            />
          </div>
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={handleCreate}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create & Select"}
            </button>
            <button
              type="button"
              onClick={cancelCreating}
              className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
