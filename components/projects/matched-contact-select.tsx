"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { updateProjectMatchedContact, updateProjectRatioReal } from "@/lib/actions/projects";
import type { ContactOption } from "@/components/contacts/contact-picker";

interface MatchedContactSelectProps {
  projectId: string;
  contacts: ContactOption[];
  currentContact: ContactOption | null;
}

type Message =
  | { tone: "filled"; text: string }
  | { tone: "differs"; contactName: string; productType: string; theirRatio: string; currentRatio: string }
  | { tone: "missing"; contactName: string; productType: string; isRecovery: boolean };

// The detail page's quick-editor for matched_contact_id — picking a
// contact here saves immediately (same pattern as StageSelect/
// StatusSelect) and runs the ratio auto-fill against the project's
// already-saved product_type. The create/edit form has its own client-
// side version of the same check, since there the project may not be
// saved yet.
export function MatchedContactSelect({ projectId, contacts, currentContact }: MatchedContactSelectProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? contacts.filter((c) => c.full_name.toLowerCase().includes(q)) : contacts;
    return pool.slice(0, 20);
  }, [contacts, query]);

  function apply(contactId: string | null) {
    setError(null);
    setMessage(null);
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      try {
        const result = await updateProjectMatchedContact(projectId, contactId);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.autoFill) {
          const { filled, differs, contactName, productType, theirRatio, currentRatio, isRecovery } = result.autoFill;
          if (filled) {
            setMessage({ tone: "filled", text: `Real ratio filled from ${contactName} (${productType}).` });
          } else if (differs) {
            setMessage({ tone: "differs", contactName, productType, theirRatio: theirRatio!, currentRatio: currentRatio ?? "" });
          } else {
            setMessage({ tone: "missing", contactName, productType, isRecovery });
          }
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  // The only way ratio_real is overwritten once it already holds a
  // different value — never automatically.
  function useTheirRatio() {
    if (message?.tone !== "differs") return;
    const { theirRatio } = message;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectRatioReal(projectId, theirRatio);
        if (result.error) {
          setError(result.error);
          return;
        }
        setMessage(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative w-56">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          value={currentContact && !open ? currentContact.full_name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          disabled={isPending}
          placeholder="Matched with…"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pr-7 pl-7 text-xs font-medium text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
        />
        {currentContact && !open && (
          <button
            type="button"
            onClick={() => apply(null)}
            disabled={isPending}
            aria-label="Clear matched contact"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {open && (
          <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">No matching contacts.</li>}
            {filtered.map((contact) => (
              <li
                key={contact.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(contact.id);
                }}
                className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
              >
                {contact.full_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {message?.tone === "filled" && <p className="text-xs text-emerald-300">{message.text}</p>}
      {message?.tone === "differs" && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-200">
            {message.contactName}&apos;s ratio for {message.productType} is {message.theirRatio}. Current real
            ratio is {message.currentRatio}.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={useTheirRatio}
              disabled={isPending}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use {message.theirRatio}
            </button>
            <button
              type="button"
              onClick={() => setMessage(null)}
              disabled={isPending}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Keep {message.currentRatio}
            </button>
          </div>
        </div>
      )}
      {message?.tone === "missing" && (
        <p className="text-xs text-amber-300">
          {message.contactName} has no {message.isRecovery ? "recovery ratio" : "ratio"} set for {message.productType}.
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
