"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectStage } from "@/lib/actions/projects";
import { STAGES, stageLabel } from "@/lib/projects";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { ProjectStage } from "@/lib/types";

export function StageSelect({
  projectId,
  currentStage,
  lang = "en",
}: {
  projectId: string;
  currentStage: ProjectStage;
  lang?: Lang;
}) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(stage: ProjectStage) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectStage(projectId, stage);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t.stageSelect.changeStage}
        value={currentStage}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as ProjectStage)}
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
      >
        {STAGES.map((stage) => (
          <option key={stage} value={stage} className="bg-[#0a0e17]">
            {stageLabel(stage, lang)}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
