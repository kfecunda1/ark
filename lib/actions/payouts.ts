"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Admin-only RLS on tranche_payouts/tranche_payout_shares (supabase/
// migrations/025_payouts.sql) is the real gate here — these actions
// don't re-check admin-ness themselves, same as every other action in
// this app that relies on RLS rather than an app-level check. Neither
// table is ever activity-logged, by design: commission figures must
// never end up in activity_log.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export interface PayoutShareInput {
  groupId: string;
  sharePct: number;
}

// Replaces the full set of group shares for one tranche's payout in a
// single call — simpler and just as safe as diffing against what was
// there before, since this is always the whole, currently-visible
// split being saved, never a partial edit.
export async function upsertTranchePayout(
  trancheId: string,
  ourPctRaw: string,
  notesRaw: string,
  shares: PayoutShareInput[]
): Promise<{ error: string | null }> {
  const trimmedPct = ourPctRaw.trim();
  const ourPct = trimmedPct ? Number(trimmedPct) : null;
  if (trimmedPct && (ourPct === null || !Number.isFinite(ourPct) || ourPct < 0)) {
    return { error: "Our % must be a number, 0 or greater." };
  }

  for (const share of shares) {
    if (!Number.isFinite(share.sharePct) || share.sharePct < 0 || share.sharePct > 100) {
      return { error: "Each group's share must be a number between 0 and 100." };
    }
  }
  const shareTotal = shares.reduce((sum, s) => sum + s.sharePct, 0);
  if (shares.length > 0 && Math.abs(shareTotal - 100) > 0.01) {
    return { error: `Group shares must total 100% — currently ${shareTotal.toFixed(2)}%.` };
  }

  try {
    const supabase = await createClient();

    const { data: payout, error: upsertError } = await supabase
      .from("tranche_payouts")
      .upsert({ tranche_id: trancheId, our_pct: ourPct, notes: notesRaw.trim() || null }, { onConflict: "tranche_id" })
      .select("id")
      .single();

    if (upsertError) {
      return { error: upsertError.message };
    }

    const payoutId = (payout as { id: string }).id;

    const { error: deleteError } = await supabase
      .from("tranche_payout_shares")
      .delete()
      .eq("tranche_payout_id", payoutId);
    if (deleteError) {
      return { error: deleteError.message };
    }

    if (shares.length > 0) {
      const { error: insertError } = await supabase
        .from("tranche_payout_shares")
        .insert(shares.map((s) => ({ tranche_payout_id: payoutId, group_id: s.groupId, share_pct: s.sharePct })));
      if (insertError) {
        return { error: insertError.message };
      }
    }

    revalidatePath("/payouts");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
