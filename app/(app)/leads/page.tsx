import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Plus, Users } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { LeadFilters } from "@/components/leads/lead-filters";
import { StageBadge } from "@/components/leads/badges";
import { createClient } from "@/lib/supabase/server";
import {
  BUSINESS_LINE_LABELS,
  STUCK_THRESHOLD_DAYS,
  formatDateOnly,
  isFollowUpDue,
  isStuckDeal,
} from "@/lib/leads";
import type { Lead } from "@/lib/types";

const CLOSED_STAGES = ["closed_won", "closed_lost"];

interface LeadsPageProps {
  searchParams: Promise<{
    business_line?: string;
    stage?: string;
    sort?: string;
    archived?: string;
    closed?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const sort = params.sort === "stage_updated_at" ? "stage_updated_at" : "follow_up_date";
  const showArchived = params.archived === "true";
  const showClosed = params.closed === "true";

  const supabase = await createClient();
  let query = supabase.from("leads").select("*").eq("archived", showArchived);

  if (params.business_line) {
    query = query.eq("business_line", params.business_line);
  }
  if (params.stage) {
    // An explicit stage filter (e.g. the Dashboard's "Closed Won this
    // month" link) always wins over the Closed toggle's default
    // inclusion/exclusion below.
    query = query.eq("stage", params.stage);
  } else if (showClosed) {
    query = query.in("stage", CLOSED_STAGES);
  } else {
    query = query.not("stage", "in", `(${CLOSED_STAGES.join(",")})`);
  }

  query =
    sort === "follow_up_date"
      ? query.order("follow_up_date", { ascending: true, nullsFirst: false })
      : query.order("stage_updated_at", { ascending: true });

  const { data: leads, error } = await query;

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );

  const title = showClosed && showArchived
    ? "Closed & Archived Leads"
    : showClosed
      ? "Closed Leads"
      : showArchived
        ? "Archived Leads"
        : "Leads";
  const subtitle = showClosed && showArchived
    ? "Archived leads that are closed won or closed lost."
    : showClosed
      ? "Leads that are closed won or closed lost."
      : showArchived
        ? "Leads that have been archived."
        : "Track and manage incoming leads.";
  const emptyTitle = showClosed && showArchived
    ? "No closed, archived leads"
    : showClosed
      ? "No closed leads"
      : showArchived
        ? "No archived leads"
        : "No leads yet";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/45">{subtitle}</p>
        </div>
        <Link
          href="/leads/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400"
        >
          <Plus className="h-4 w-4" />
          New Lead
        </Link>
      </div>

      <div className="mb-4">
        <Suspense>
          <LeadFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load leads: {error.message}
        </GlassCard>
      )}

      {!error && (!leads || leads.length === 0) && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Users className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">{emptyTitle}</p>
          <p className="max-w-xs text-xs text-white/35">
            {params.business_line || params.stage
              ? "No leads match the current filters."
              : showClosed
                ? "Leads you move to Closed Won or Closed Lost will show up here."
                : showArchived
                  ? "Leads you archive will show up here."
                  : "New leads will show up here once your pipeline is connected."}
          </p>
        </GlassCard>
      )}

      {!error && leads && leads.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <th className="px-4 py-3 font-medium">Business Line</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Procedure Type</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {(leads as Lead[]).map((lead) => {
                  const stuck = isStuckDeal(lead.stage, lead.stage_updated_at);
                  const followUpDue = isFollowUpDue(lead.follow_up_date);

                  return (
                    <ClickableRow
                      key={lead.id}
                      href={`/leads/${lead.id}`}
                      className={`border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03] ${
                        stuck ? "border-l-2 border-l-amber-500/50 bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-white/80 group-hover:text-white">
                        {BUSINESS_LINE_LABELS[lead.business_line]}
                      </td>
                      <td className="px-4 py-3 text-white/70 group-hover:text-white">{lead.product_type}</td>
                      <td className="px-4 py-3 text-white/70 group-hover:text-white">{lead.procedure_type}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StageBadge stage={lead.stage} />
                          {stuck && (
                            <span title={`No stage change in over ${STUCK_THRESHOLD_DAYS} days`}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {(lead.primary_contact_id && contactNameById.get(lead.primary_contact_id)) || "—"}
                      </td>
                      <td
                        className={`px-4 py-3 ${followUpDue ? "font-medium text-rose-300" : "text-white/50"}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {lead.follow_up_date ? formatDateOnly(lead.follow_up_date) : "—"}
                          {followUpDue && (
                            <span
                              title="Follow-up due"
                              className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400"
                            />
                          )}
                        </span>
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {(leads as Lead[]).map((lead) => {
              const stuck = isStuckDeal(lead.stage, lead.stage_updated_at);
              const followUpDue = isFollowUpDue(lead.follow_up_date);

              return (
                <ClickableCard
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className={stuck ? "border-l-2 border-l-amber-500/50 bg-amber-500/[0.04]" : ""}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-white/85">
                      {BUSINESS_LINE_LABELS[lead.business_line]}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <StageBadge stage={lead.stage} />
                      {stuck && (
                        <span title={`No stage change in over ${STUCK_THRESHOLD_DAYS} days`}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Product Type
                      </dt>
                      <dd className="mt-0.5 text-white/70">{lead.product_type}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Procedure Type
                      </dt>
                      <dd className="mt-0.5 text-white/70">{lead.procedure_type}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Contact</dt>
                      <dd className="mt-0.5 text-white/70">
                        {(lead.primary_contact_id && contactNameById.get(lead.primary_contact_id)) || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">
                        Follow-up
                      </dt>
                      <dd
                        className={`mt-0.5 inline-flex items-center gap-1.5 ${followUpDue ? "font-medium text-rose-300" : "text-white/50"}`}
                      >
                        {lead.follow_up_date ? formatDateOnly(lead.follow_up_date) : "—"}
                        {followUpDue && (
                          <span
                            title="Follow-up due"
                            className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400"
                          />
                        )}
                      </dd>
                    </div>
                  </dl>
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
