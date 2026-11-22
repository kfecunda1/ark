"use client";

import { useState, useTransition } from "react";
import { updateProjectMatchedContact, updateProjectRatioReal } from "@/lib/actions/projects";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

// Shared "Match" action for the two new find-receivers UIs
// (components/projects/find-receivers-panel.tsx, components/
// receivers/receiver-match-projects-section.tsx) — sets matched_contact_id
// and runs the exact same ratio auto-fill rules the existing Matched
// With quick-editor (components/projects/matched-receiver-select.tsx)
// already uses: filled silently if the project had no ratio_real yet,
// or paused on a Use/Keep prompt if it already held a different one.
// Only once there's nothing left to resolve does `onMatched` fire.
export interface DiffersState {
  projectId: string;
  receiverLabel: string;
  contactName: string;
  productType: string;
  theirRatio: string;
  currentRatio: string;
}

export function useMatchAndAutoFill(onMatched: (receiverLabel: string) => void, lang: Lang = "en") {
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [matchingProjectId, setMatchingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [differs, setDiffers] = useState<DiffersState | null>(null);

  function match(projectId: string, receiverId: string, receiverLabel: string) {
    setError(null);
    setDiffers(null);
    setMatchingProjectId(projectId);
    startTransition(async () => {
      try {
        const result = await updateProjectMatchedContact(projectId, receiverId);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        if (result.autoFill?.differs) {
          const { contactName, productType, theirRatio, currentRatio } = result.autoFill;
          setDiffers({
            projectId,
            receiverLabel,
            contactName,
            productType,
            theirRatio: theirRatio!,
            currentRatio: currentRatio ?? "",
          });
          return;
        }
        onMatched(receiverLabel);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setMatchingProjectId(null);
      }
    });
  }

  // The only way ratio_real is overwritten once it already holds a
  // different value — never automatically (same rule matched-receiver-
  // select.tsx follows).
  function resolveDiffers(action: "use" | "keep") {
    if (!differs) return;
    const { projectId, receiverLabel, theirRatio } = differs;

    if (action === "keep") {
      setDiffers(null);
      onMatched(receiverLabel);
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateProjectRatioReal(projectId, theirRatio);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setDiffers(null);
        onMatched(receiverLabel);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return {
    match,
    resolveDiffers,
    isPending,
    matchingProjectId,
    error,
    differs,
    clearError: () => setError(null),
  };
}
