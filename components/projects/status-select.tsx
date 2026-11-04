"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectStatus } from "@/lib/actions/projects";
import { STATUSES, STATUS_LABELS } from "@/lib/projects";
import type { ProjectStatus } from "@/lib/types";

// Always visible and always usable, regardless of the project's current
// stage — picking any real status here moves the project into the
// Status stage as part of the same save (see updateProjectStatus). When
// there's no status yet (because the project has never been in the
// Status stage), the select shows a disabled placeholder instead of
// defaulting to a real option, so it can't look like a status is
// already set when none has actually been chosen.
export function StatusSelect({
  projectId,
  currentStatus,
}: {
  projectId: string;
  currentStatus: ProjectStatus | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(status: ProjectStatus) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectStatus(projectId, status);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Change status"
        value={currentStatus ?? ""}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as ProjectStatus)}
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
      >
        {currentStatus === null && (
          <option value="" disabled className="bg-[#0a0e17]">
            Set status…
          </option>
        )}
        {STATUSES.map((status) => (
          <option key={status} value={status} className="bg-[#0a0e17]">
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
