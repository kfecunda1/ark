"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecoveryBadge } from "@/components/projects/badges";
import { upsertTranchePayout, type PayoutShareInput } from "@/lib/actions/payouts";
import { formatDateOnly } from "@/lib/projects";
import { formatMoney } from "@/lib/money";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { PayoutGroup, ProjectTranche, TranchePayout, TranchePayoutShare } from "@/lib/types";

interface PayoutRowProps {
  tranche: ProjectTranche;
  project: { id: string; name: string; currency: string; is_recovery: boolean } | undefined;
  allGroups: PayoutGroup[];
  payout: TranchePayout | undefined;
  shares: TranchePayoutShare[];
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

function shareKey(payout: TranchePayout | undefined, shares: TranchePayoutShare[]): string {
  const sharesPart = [...shares]
    .sort((a, b) => a.group_id.localeCompare(b.group_id))
    .map((s) => `${s.group_id}:${s.share_pct}`)
    .join(",");
  return `${payout?.our_pct ?? ""}|${sharesPart}`;
}

export function PayoutRow({ tranche, project, allGroups, payout, shares, lang = "en" }: PayoutRowProps) {
  const router = useRouter();
  const t = getDictionary(lang);

  // Every currently-active group, plus any hidden one that already has
  // a saved share here — same "hidden but still shown where it's
  // already in use" rule Products/Statuses follow.
  const visibleGroups = useMemo(
    () => allGroups.filter((g) => g.active || shares.some((s) => s.group_id === g.id)),
    [allGroups, shares]
  );

  const [ourPct, setOurPct] = useState(payout?.our_pct != null ? String(payout.our_pct) : "");
  const [shareByGroupId, setShareByGroupId] = useState<Record<string, string>>(() => {
    if (shares.length > 0) {
      return Object.fromEntries(shares.map((s) => [s.group_id, String(s.share_pct)]));
    }
    return Object.fromEntries(visibleGroups.map((g) => [g.id, String(g.default_share_pct)]));
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Resyncs after a save (router.refresh() hands this row fresh props)
  // — same "compare a values-based key, not object identity" pattern
  // components/projects/tranches-section.tsx uses, so an in-progress
  // edit on some *other* row never gets wiped by this refresh.
  const [prevKey, setPrevKey] = useState(shareKey(payout, shares));
  const currentKey = shareKey(payout, shares);
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setOurPct(payout?.our_pct != null ? String(payout.our_pct) : "");
    setShareByGroupId(
      shares.length > 0
        ? Object.fromEntries(shares.map((s) => [s.group_id, String(s.share_pct)]))
        : Object.fromEntries(visibleGroups.map((g) => [g.id, String(g.default_share_pct)]))
    );
  }

  const amount = tranche.amount ?? 0;
  const ourPctNum = Number(ourPct) || 0;
  const ourCommission = amount * (ourPctNum / 100);
  const shareTotal = visibleGroups.reduce((sum, g) => sum + (Number(shareByGroupId[g.id]) || 0), 0);
  const totalOff = visibleGroups.length > 0 && Math.abs(shareTotal - 100) > 0.01;
  const commissionNotSet = !payout || payout.our_pct == null;

  function setShare(groupId: string, value: string) {
    setShareByGroupId((prev) => ({ ...prev, [groupId]: value }));
    setSaved(false);
  }

  function splitEvenly() {
    const n = visibleGroups.length;
    if (n === 0) return;
    const base = Math.floor((100 / n) * 100) / 100;
    const remainder = Math.round((100 - base * n) * 100) / 100;
    const next: Record<string, string> = {};
    visibleGroups.forEach((g, i) => {
      next[g.id] = i === 0 ? String(Math.round((base + remainder) * 100) / 100) : String(base);
    });
    setShareByGroupId(next);
    setSaved(false);
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (totalOff) {
      setError(t.payoutRow.shareTotalMismatch(shareTotal.toFixed(2)));
      return;
    }
    setIsSaving(true);
    try {
      const shareInputs: PayoutShareInput[] = visibleGroups.map((g) => ({
        groupId: g.id,
        sharePct: Number(shareByGroupId[g.id]) || 0,
      }));
      const result = await upsertTranchePayout(tranche.id, ourPct, payout?.notes ?? "", shareInputs);
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {project ? (
            <Link href={`/projects/${project.id}`} className="truncate text-sm font-medium text-white/85 hover:underline">
              {project.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-white/85">{t.payoutRow.unknownProject}</span>
          )}
          {project?.is_recovery && <RecoveryBadge lang={lang} />}
          <span className="shrink-0 text-xs text-white/50">{t.dashboard.trancheNumber(tranche.tranche_number)}</span>
        </div>
        {commissionNotSet && (
          <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            {t.payoutRow.commissionNotSet}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/40">
        <span className="font-medium text-white/70">{formatMoney(tranche.amount, project?.currency ?? null)}</span>
        <span>{t.payoutRow.paidOutOn(formatDateOnly(tranche.paid_out_on as string, lang))}</span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        <div className="sm:w-40">
          <label className="mb-1 block text-[11px] font-medium text-white/40">{t.payoutRow.ourPctLabel}</label>
          <input
            type="number"
            min={0}
            step="0.0001"
            value={ourPct}
            onChange={(e) => {
              setOurPct(e.target.value);
              setSaved(false);
            }}
            placeholder={t.payoutRow.ourPctPlaceholder}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-white/40">
            {t.payoutRow.ourCommissionLabel}{" "}
            <span className="font-medium text-white/70">{formatMoney(ourCommission, project?.currency ?? null)}</span>
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-white/40">{t.payoutRow.groupSplitLabel}</label>
            <button
              type="button"
              onClick={splitEvenly}
              className="text-[11px] font-medium text-accent-soft transition-colors duration-150 ease-out hover:underline"
            >
              {t.payoutRow.splitEvenly}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {visibleGroups.length === 0 ? (
              <p className="text-xs text-white/35">{t.payoutRow.noGroupsSetUp}</p>
            ) : (
              visibleGroups.map((group) => {
                const sharePct = Number(shareByGroupId[group.id]) || 0;
                const pctOfDeal = (ourPctNum * sharePct) / 100;
                const amountEarned = ourCommission * (sharePct / 100);
                return (
                  <div
                    key={group.id}
                    className="grid grid-cols-2 items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 sm:grid-cols-[1fr_5rem_5rem_6rem_6rem]"
                  >
                    <span className="truncate text-xs text-white/70">
                      {group.name}
                      {!group.active && <span className="ml-1 text-white/35">{t.dashboard.hiddenSuffix}</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={shareByGroupId[group.id] ?? ""}
                        onChange={(e) => setShare(group.id, e.target.value)}
                        className="w-16 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-white outline-none focus:border-accent/40"
                      />
                      <span className="text-xs text-white/40">%</span>
                    </div>
                    <span className="text-xs text-white/40">{t.payoutRow.ofCommission}</span>
                    <span className="text-xs text-white/50">{t.payoutRow.ofDeal(pctOfDeal.toFixed(4))}</span>
                    <span className="text-xs font-medium text-white/80">
                      {formatMoney(amountEarned, project?.currency ?? null)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <p className={`mt-1.5 text-xs font-medium ${totalOff ? "text-red-300" : "text-white/35"}`}>
            {t.payoutRow.totalLabel(shareTotal.toFixed(2))}
            {totalOff && t.payoutRow.mustTotal100Suffix}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? t.common.saving : t.common.save}
        </button>
        {saved && !isSaving && <span className="text-xs text-emerald-300">{t.common.saved}</span>}
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
