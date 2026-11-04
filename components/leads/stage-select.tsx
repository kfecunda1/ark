"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStage } from "@/lib/actions/leads";
import { STAGES, STAGE_LABELS } from "@/lib/leads";
import type { LeadStage } from "@/lib/types";

export function StageSelect({ leadId, currentStage }: { leadId: string; currentStage: LeadStage }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(stage: LeadStage) {
    setError(null);
    startTransition(async () => {
      const result = await updateLeadStage(leadId, stage);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Change stage"
        value={currentStage}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as LeadStage)}
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white outline-none transition-colors duration-150 ease-out focus:border-white/20 disabled:opacity-50"
      >
        {STAGES.map((stage) => (
          <option key={stage} value={stage} className="bg-[#0a0e17]">
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
