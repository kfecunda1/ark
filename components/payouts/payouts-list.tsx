"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PayoutRow } from "@/components/payouts/payout-row";
import { toCsv } from "@/lib/csv";
import { formatMoney } from "@/lib/money";
import { CURRENCIES } from "@/lib/projects";
import type { PayoutGroup, Project, ProjectTranche, TranchePayout, TranchePayoutShare } from "@/lib/types";

type ProjectSummary = Pick<Project, "id" | "name" | "currency" | "is_recovery">;

interface PayoutsListProps {
  tranches: ProjectTranche[];
  projects: ProjectSummary[];
  groups: PayoutGroup[];
  payouts: TranchePayout[];
  shares: TranchePayoutShare[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40";

function hasCommission(payout: TranchePayout | undefined): boolean {
  return payout != null && payout.our_pct != null;
}

export function PayoutsList({ tranches, projects, groups, payouts, shares }: PayoutsListProps) {
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const payoutByTrancheId = useMemo(() => new Map(payouts.map((p) => [p.tranche_id, p])), [payouts]);
  const sharesByPayoutId = useMemo(() => {
    const map = new Map<string, TranchePayoutShare[]>();
    for (const share of shares) {
      map.set(share.tranche_payout_id, [...(map.get(share.tranche_payout_id) ?? []), share]);
    }
    return map;
  }, [shares]);

  const years = useMemo(
    () => [...new Set(tranches.map((t) => (t.paid_out_on as string).slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    [tranches]
  );

  const filtered = useMemo(() => {
    return tranches.filter((t) => {
      const paidOutOn = t.paid_out_on as string;
      if (year !== "all" && paidOutOn.slice(0, 4) !== year) return false;
      if (month !== "all" && paidOutOn.slice(5, 7) !== month) return false;
      return true;
    });
  }, [tranches, year, month]);

  // "Commission not set" tranches always sort first, newest paid-out
  // first within each of the two groups.
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aSet = hasCommission(payoutByTrancheId.get(a.id));
      const bSet = hasCommission(payoutByTrancheId.get(b.id));
      if (aSet !== bSet) return aSet ? 1 : -1;
      return (b.paid_out_on as string).localeCompare(a.paid_out_on as string);
    });
  }, [filtered, payoutByTrancheId]);

  // Totals: per group, per currency — only tranches with commission
  // actually set contribute (an unset one is $0 earned so far, not an
  // unknown to guess at).
  const totals = useMemo(() => {
    const byGroupAndCurrency = new Map<string, Map<string, number>>();
    for (const t of filtered) {
      const payout = payoutByTrancheId.get(t.id);
      if (!hasCommission(payout)) continue;
      const project = projectById.get(t.project_id);
      if (!project) continue;
      const ourCommission = (t.amount ?? 0) * (payout!.our_pct! / 100);
      const trancheShares = sharesByPayoutId.get(payout!.id) ?? [];
      for (const share of trancheShares) {
        const earned = ourCommission * (share.share_pct / 100);
        const byCurrency = byGroupAndCurrency.get(share.group_id) ?? new Map<string, number>();
        byCurrency.set(project.currency, (byCurrency.get(project.currency) ?? 0) + earned);
        byGroupAndCurrency.set(share.group_id, byCurrency);
      }
    }
    return byGroupAndCurrency;
  }, [filtered, payoutByTrancheId, projectById, sharesByPayoutId]);

  const groupsInTotals = groups.filter((g) => g.active || totals.has(g.id));

  function downloadCsv() {
    const groupColumns = groups.filter((g) => g.active || shares.some((s) => s.group_id === g.id));

    const rows = sorted.map((t) => {
      const project = projectById.get(t.project_id);
      const payout = payoutByTrancheId.get(t.id);
      const ourPct = payout?.our_pct ?? null;
      const ourCommission = ourPct != null ? (t.amount ?? 0) * (ourPct / 100) : null;
      const trancheShares = payout ? sharesByPayoutId.get(payout.id) ?? [] : [];
      const shareByGroupId = new Map(trancheShares.map((s) => [s.group_id, s.share_pct]));

      const row: Record<string, unknown> = {
        Project: project?.name ?? "Unknown project",
        Tranche: t.tranche_number,
        Amount: t.amount,
        Currency: project?.currency ?? "",
        "Paid Out On": t.paid_out_on,
        "Our %": ourPct,
        "Our Commission": ourCommission,
      };

      for (const group of groupColumns) {
        const sharePct = shareByGroupId.get(group.id) ?? null;
        row[`${group.name} Share %`] = sharePct;
        row[`${group.name} % of Deal`] = ourPct != null && sharePct != null ? (ourPct * sharePct) / 100 : null;
        row[`${group.name} Amount`] =
          ourCommission != null && sharePct != null ? ourCommission * (sharePct / 100) : null;
      }

      return row;
    });

    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const periodLabel = year === "all" ? "all-time" : month === "all" ? year : `${year}-${month}`;
    link.href = url;
    link.download = `ARK-payouts-${periodLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
          <option value="all" className="bg-[#0a0e17]">
            All years
          </option>
          {years.map((y) => (
            <option key={y} value={y} className="bg-[#0a0e17]">
              {y}
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
          <option value="all" className="bg-[#0a0e17]">
            All months
          </option>
          {MONTHS.map((label, i) => (
            <option key={label} value={String(i + 1).padStart(2, "0")} className="bg-[#0a0e17]">
              {label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={downloadCsv}
          disabled={sorted.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <GlassCard interactive={false} className="p-6">
        <h2 className="mb-4 text-sm font-medium text-white/70">Totals</h2>
        {groupsInTotals.length === 0 ? (
          <p className="text-sm text-white/35">No commission recorded yet for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <th className="py-2 pr-4 font-medium">Group</th>
                  {CURRENCIES.map((c) => (
                    <th key={c} className="py-2 pr-4 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupsInTotals.map((group) => (
                  <tr key={group.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 pr-4 text-white/80">
                      {group.name}
                      {!group.active && <span className="ml-1 text-xs text-white/35">(hidden)</span>}
                    </td>
                    {CURRENCIES.map((c) => (
                      <td key={c} className="py-2 pr-4 text-white/70">
                        {formatMoney(totals.get(group.id)?.get(c) ?? 0, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="flex flex-col gap-3">
        {sorted.length === 0 ? (
          <p className="text-sm text-white/35">No paid-out tranches for this period.</p>
        ) : (
          sorted.map((tranche) => (
            <PayoutRow
              key={tranche.id}
              tranche={tranche}
              project={projectById.get(tranche.project_id)}
              allGroups={groups}
              payout={payoutByTrancheId.get(tranche.id)}
              shares={payoutByTrancheId.get(tranche.id) ? sharesByPayoutId.get(payoutByTrancheId.get(tranche.id)!.id) ?? [] : []}
            />
          ))
        )}
      </div>
    </div>
  );
}
