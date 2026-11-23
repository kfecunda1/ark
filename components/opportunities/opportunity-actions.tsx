"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2, RotateCcw, X } from "lucide-react";
import { EntityPicker, type EntityOption } from "@/components/entity-picker";
import { attachOpportunityToReceiver, closeOpportunity, reopenOpportunity } from "@/lib/actions/opportunities";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Opportunity } from "@/lib/types";

interface OpportunityActionsProps {
  opportunity: Opportunity;
  receivers: EntityOption[];
  lang?: Lang;
}

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.06]";

// The three lifecycle actions on an open opportunity (components/
// opportunities' own detail page renders this only while status is
// 'open' — a converted/closed opportunity shows its own read-only
// outcome line instead, see app/(app)/opportunities/[id]/page.tsx).
export function OpportunityActions({ opportunity, receivers, lang = "en" }: OpportunityActionsProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [attaching, setAttaching] = useState(false);
  const [selectedReceiver, setSelectedReceiver] = useState<EntityOption | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAttach() {
    if (!selectedReceiver) {
      setError(t.opportunities.pickReceiverFirst);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await attachOpportunityToReceiver(opportunity.id, selectedReceiver.id);
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      router.push(`/receivers/${selectedReceiver.id}`);
    });
  }

  function handleClose() {
    setError(null);
    startTransition(async () => {
      const result = await closeOpportunity(opportunity.id, closeReason);
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      setClosing(false);
      router.refresh();
    });
  }

  function handleReopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenOpportunity(opportunity.id);
      if (result.error) {
        setError(resolveError(result.error, lang));
      } else {
        router.refresh();
      }
    });
  }

  if (opportunity.status !== "open") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {opportunity.status === "closed" && (
          <button type="button" onClick={handleReopen} disabled={isPending} className={buttonClass}>
            <RotateCcw className="h-3.5 w-3.5" />
            {isPending ? t.opportunities.reopening : t.opportunities.reopen}
          </button>
        )}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/projects/new?fromOpportunity=${opportunity.id}`} className={buttonClass}>
          <ArrowRight className="h-3.5 w-3.5" />
          {t.opportunities.convertToProject}
        </Link>
        <button type="button" onClick={() => setAttaching((a) => !a)} className={buttonClass}>
          <Link2 className="h-3.5 w-3.5" />
          {attaching ? t.common.close : t.opportunities.attachToReceiver}
        </button>
        <button type="button" onClick={() => setClosing((c) => !c)} className={buttonClass}>
          <X className="h-3.5 w-3.5" />
          {closing ? t.common.close : t.opportunities.closeNotMatched}
        </button>
      </div>

      {attaching && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <EntityPicker
            name="attach_receiver_id"
            label={t.opportunities.pickReceiverLabel}
            options={receivers}
            entityNoun={lang === "es" ? "receptor" : "receiver"}
            entityNounPlural={lang === "es" ? "receptores" : "receivers"}
            lang={lang}
            onSelect={setSelectedReceiver}
          />
          <button
            type="button"
            onClick={handleAttach}
            disabled={isPending}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t.opportunities.attaching : t.opportunities.confirmAttach}
          </button>
        </div>
      )}

      {closing && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <label className="mb-1.5 block text-xs font-medium text-white/55">{t.opportunities.closeReasonLabel}</label>
          <textarea
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            rows={2}
            placeholder={t.opportunities.closeReasonPlaceholder}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
          />
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="mt-2 rounded-md bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t.opportunities.closing : t.opportunities.confirmClose}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
}
