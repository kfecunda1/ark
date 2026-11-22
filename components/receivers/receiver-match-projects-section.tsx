"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecoveryBadge } from "@/components/projects/badges";
import { useMatchAndAutoFill } from "@/lib/use-match-and-autofill";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { ProjectNeedingReceiver } from "@/lib/actions/matching";

interface ReceiverMatchProjectsSectionProps {
  receiverId: string;
  receiverLabel: string;
  projects: ProjectNeedingReceiver[];
  lang?: Lang;
}

// The reverse of components/projects/find-receivers-panel.tsx: every
// open, unmatched project whose options include a product this
// receiver offers (lib/actions/matching.ts's findProjectsNeedingReceiver,
// fetched server-side by the page), each with the same "Match" + ratio
// auto-fill flow. lib/use-match-and-autofill.ts / lib/actions/
// matching.ts are out of this pass's scope — any raw error text they
// return is passed through resolveError, which no-ops on anything
// that isn't a recognized errors.* key.
export function ReceiverMatchProjectsSection({
  receiverId,
  receiverLabel,
  projects,
  lang = "en",
}: ReceiverMatchProjectsSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [justMatched, setJustMatched] = useState<string | null>(null);

  const { match, resolveDiffers, isPending, matchingProjectId, error, differs } = useMatchAndAutoFill(() => {
    setJustMatched(t.receiverDialogs.matchedWith(receiverLabel));
    router.refresh();
  });

  useEffect(() => {
    if (!justMatched) return;
    const timeout = setTimeout(() => setJustMatched(null), 5000);
    return () => clearTimeout(timeout);
  }, [justMatched]);

  if (projects.length === 0) {
    return <p className="text-sm text-white/35">{t.receiverDialogs.noProjectsNeedReceiver}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {justMatched && <p className="text-xs text-emerald-300">{justMatched}</p>}
      {error && <p className="text-xs text-rose-300">{resolveError(error, lang)}</p>}

      {differs && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-200">
            {t.receiverDialogs.ratioDiffers(differs.contactName, differs.productType, differs.theirRatio, differs.currentRatio)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolveDiffers("use")}
              disabled={isPending}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.receiverDialogs.useRatio(differs.theirRatio)}
            </button>
            <button
              type="button"
              onClick={() => resolveDiffers("keep")}
              disabled={isPending}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.receiverDialogs.keepRatio(differs.currentRatio)}
            </button>
          </div>
        </div>
      )}

      {projects.map((project) => (
        <div
          key={project.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
        >
          <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 truncate text-sm text-white/80 hover:underline">
            {project.name}
          </Link>
          {project.isRecovery && <RecoveryBadge lang={lang} />}
          <span className="shrink-0 text-xs text-white/40">{project.product}</span>
          <button
            type="button"
            onClick={() => match(project.id, receiverId, receiverLabel)}
            disabled={isPending}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending && matchingProjectId === project.id ? t.receiverDialogs.matching : t.receiverDialogs.match}
          </button>
        </div>
      ))}
    </div>
  );
}
