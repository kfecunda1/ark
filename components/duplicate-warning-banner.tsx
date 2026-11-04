import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { GlassCard } from "@/components/glass-card";

export interface DuplicateMatch {
  id: string;
  href: string;
  label: string;
  meta: string;
}

interface DuplicateWarningBannerProps {
  heading: string;
  matches: DuplicateMatch[];
  onAddAnyway: () => void;
  addAnywayLabel?: string;
  disabled?: boolean;
}

// Shared "this looks like something that already exists" banner, used by
// both the Lead and Procedure create forms before a possible duplicate is
// actually saved, and by the document-upload components for a
// cross-record file hash match. Lists every match found — its label,
// some identifying detail, and an explicit "Open existing" link — plus
// one "Add anyway" action that bypasses the check and proceeds with the
// save/attach.
export function DuplicateWarningBanner({
  heading,
  matches,
  onAddAnyway,
  addAnywayLabel = "Add anyway",
  disabled = false,
}: DuplicateWarningBannerProps) {
  return (
    <GlassCard interactive={false} className="border-amber-500/25 bg-amber-500/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-300">{heading}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {matches.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="font-medium text-amber-100">{match.label}</span>
                <span className="text-xs text-amber-200/60">{match.meta}</span>
                <Link
                  href={match.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-amber-200 underline decoration-amber-200/30 underline-offset-2 hover:text-amber-100"
                >
                  Open existing
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={(e) => {
              // Same rapid-double-click guard as the form's main submit
              // button (see lib/forms.ts) — disable synchronously, in
              // this same click, before onAddAnyway's async work starts,
              // so a second click can't fire the create flow twice.
              e.currentTarget.disabled = true;
              onAddAnyway();
            }}
            disabled={disabled}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition-colors duration-150 ease-out hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addAnywayLabel}
          </button>
        </div>
      </div>
    </GlassCard>
  );
}
