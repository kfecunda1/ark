"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { updateProjectMatchedContact, updateProjectRatioReal } from "@/lib/actions/projects";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { EntityOption } from "@/components/entity-picker";

interface MatchedReceiverSelectProps {
  projectId: string;
  receivers: EntityOption[];
  currentReceiver: EntityOption | null;
  lang?: Lang;
}

type Message =
  | { tone: "filled"; text: string }
  | { tone: "differs"; contactName: string; productType: string; theirRatio: string; currentRatio: string }
  | { tone: "missing"; contactName: string; productType: string; isRecovery: boolean };

// The detail page's quick-editor for matched_contact_id (UI: "Matched
// With", picking a Receiver — see AGENTS.md's UI-naming-vs-database-
// naming note) — picking one here saves immediately (same pattern as
// StageSelect/StatusSelect) and runs the ratio auto-fill against the
// project's already-saved final product. The create/edit form has its
// own client-side version of the same check, since there the project
// may not be saved yet.
export function MatchedReceiverSelect({ projectId, receivers, currentReceiver, lang = "en" }: MatchedReceiverSelectProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? receivers.filter((r) => r.label.toLowerCase().includes(q)) : receivers;
    return pool.slice(0, 20);
  }, [receivers, query]);

  function apply(receiverId: string | null) {
    setError(null);
    setMessage(null);
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      try {
        const result = await updateProjectMatchedContact(projectId, receiverId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        if (result.autoFill) {
          const { filled, differs, contactName, productType, theirRatio, currentRatio, isRecovery } = result.autoFill;
          if (filled) {
            setMessage({ tone: "filled", text: t.matchedReceiver.ratioFilled(contactName, productType) });
          } else if (differs) {
            setMessage({ tone: "differs", contactName, productType, theirRatio: theirRatio!, currentRatio: currentRatio ?? "" });
          } else {
            setMessage({ tone: "missing", contactName, productType, isRecovery });
          }
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
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
          setError(resolveError(result.error, lang));
          return;
        }
        setMessage(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative w-56">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          value={currentReceiver && !open ? currentReceiver.label : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          disabled={isPending}
          placeholder={t.matchedReceiver.placeholder}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pr-7 pl-7 text-xs font-medium text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
        />
        {currentReceiver && !open && (
          <button
            type="button"
            onClick={() => apply(null)}
            disabled={isPending}
            aria-label={t.matchedReceiver.clear}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-white/30 transition-colors duration-150 ease-out hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {open && (
          <ul className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-white/35">{t.matchedReceiver.noMatching}</li>}
            {filtered.map((receiver) => (
              <li
                key={receiver.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(receiver.id);
                }}
                className="cursor-pointer px-3 py-1.5 text-xs text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
              >
                {receiver.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {message?.tone === "filled" && <p className="text-xs text-emerald-300">{message.text}</p>}
      {message?.tone === "differs" && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-200">
            {t.matchedReceiver.ratioDiffers(message.contactName, message.productType, message.theirRatio, message.currentRatio)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={useTheirRatio}
              disabled={isPending}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.matchedReceiver.useRatio(message.theirRatio)}
            </button>
            <button
              type="button"
              onClick={() => setMessage(null)}
              disabled={isPending}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.matchedReceiver.keepRatio(message.currentRatio)}
            </button>
          </div>
        </div>
      )}
      {message?.tone === "missing" && (
        <p className="text-xs text-amber-300">
          {t.matchedReceiver.noRatioSet(
            message.contactName,
            message.isRecovery ? t.matchedReceiver.recoveryRatioNoun : t.matchedReceiver.ratioNoun,
            message.productType
          )}
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
