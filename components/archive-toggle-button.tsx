"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { setArchived, type ArchivableEntityType } from "@/lib/actions/archive";

interface ArchiveToggleButtonProps {
  entityType: ArchivableEntityType;
  entityId: string;
  archived: boolean;
}

// Same shape as components/projects/archive-project-button.tsx, just
// generic over Receivers and Contacts (people) — calls setArchived
// itself (entityType/entityId/archived are plain data, not a
// function), for the same reason components/contact-person-select.tsx
// does: a Server Component page must never pass this button a closure
// over toggleContactArchived/togglePersonArchived.
export function ArchiveToggleButton({ entityType, entityId, archived }: ArchiveToggleButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setArchived(entityType, entityId, !archived);
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
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        {isPending ? "Saving…" : archived ? "Unarchive" : "Archive"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
