"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectStage } from "@/lib/actions/projects";
import { STAGES, STAGE_LABELS } from "@/lib/projects";
import type { ProjectStage } from "@/lib/types";

export function StageSelect({ projectId, currentStage }: { projectId: string; currentStage: ProjectStage }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(stage: ProjectStage) {
    setError(null);
    startTransition(async () => {
      const result = await updateProjectStage(projectId, stage);
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
        onChange={(e) => handleChange(e.target.value as ProjectStage)}
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
