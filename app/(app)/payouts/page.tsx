import { redirect } from "next/navigation";
import { isCurrentUserAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAllPayoutGroups } from "@/lib/payout-groups";
import { PayoutsList } from "@/components/payouts/payouts-list";
import type { Project, ProjectTranche, TranchePayout, TranchePayoutShare } from "@/lib/types";

type ProjectSummary = Pick<Project, "id" | "name" | "currency" | "is_recovery">;

export default async function PayoutsPage() {
  // Admin-only route — everyone else is bounced server-side, before
  // any payout data is even queried (which RLS would refuse them
  // anyway, but this also avoids the page existing in a half-rendered
  // "no access" state for a member who navigates here directly).
  if (!(await isCurrentUserAdmin())) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const [{ data: tranchesData }, groups] = await Promise.all([
    supabase
      .from("project_tranches")
      .select("*")
      .not("paid_out_on", "is", null)
      .order("paid_out_on", { ascending: false }),
    getAllPayoutGroups(),
  ]);

  const tranches = (tranchesData as ProjectTranche[] | null) ?? [];
  const projectIds = [...new Set(tranches.map((t) => t.project_id))];
  const trancheIds = tranches.map((t) => t.id);

  const [{ data: projectsData }, { data: payoutsData }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id, name, currency, is_recovery").in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectSummary[] }),
    trancheIds.length > 0
      ? supabase.from("tranche_payouts").select("*").in("tranche_id", trancheIds)
      : Promise.resolve({ data: [] as TranchePayout[] }),
  ]);

  const projects = (projectsData as ProjectSummary[] | null) ?? [];
  const payouts = (payoutsData as TranchePayout[] | null) ?? [];
  const payoutIds = payouts.map((p) => p.id);

  const { data: sharesData } =
    payoutIds.length > 0
      ? await supabase.from("tranche_payout_shares").select("*").in("tranche_payout_id", payoutIds)
      : { data: [] as TranchePayoutShare[] };
  const shares = (sharesData as TranchePayoutShare[] | null) ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Payouts</h1>
        <p className="mt-1 text-sm text-white/45">Commission on paid-out tranches.</p>
      </div>

      <PayoutsList tranches={tranches} projects={projects} groups={groups} payouts={payouts} shares={shares} />
    </div>
  );
}
