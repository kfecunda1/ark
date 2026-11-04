import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Layers } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { PriorityBadge, StageBadge } from "@/components/leads/badges";
import { createClient } from "@/lib/supabase/server";
import {
  BUSINESS_LINES,
  BUSINESS_LINE_LABELS,
  STAGES,
  STAGE_LABELS,
  daysSince,
  followUpLabel,
  formatDateOnly,
  isFollowUpDue,
  isStuckDeal,
  parseDateOnly,
} from "@/lib/leads";
import type { BusinessLine, Lead, LeadStage } from "@/lib/types";

const STAGE_BAR_COLORS: Record<LeadStage, string> = {
  new: "bg-sky-500/70",
  in_progress: "bg-amber-500/70",
  closed_won: "bg-emerald-500/70",
  closed_lost: "bg-rose-500/70",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").select("*").eq("archived", false);
  const leads = (data as Lead[] | null) ?? [];

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );
  function contactName(lead: Lead): string {
    return (lead.primary_contact_id && contactNameById.get(lead.primary_contact_id)) || "Unknown contact";
  }

  const openLeads = leads.filter((lead) => lead.stage !== "closed_won" && lead.stage !== "closed_lost");

  const stuckLeads = leads
    .filter((lead) => isStuckDeal(lead.stage, lead.stage_updated_at))
    .sort((a, b) => daysSince(b.stage_updated_at) - daysSince(a.stage_updated_at));

  const followUpLeads = leads
    .filter((lead) => isFollowUpDue(lead.follow_up_date))
    .sort(
      (a, b) => parseDateOnly(a.follow_up_date!).getTime() - parseDateOnly(b.follow_up_date!).getTime()
    );

  const now = new Date();
  const closedWonThisMonth = leads.filter((lead) => {
    if (lead.stage !== "closed_won") return false;
    const changed = new Date(lead.stage_updated_at);
    return changed.getFullYear() === now.getFullYear() && changed.getMonth() === now.getMonth();
  }).length;

  const stageCounts = STAGES.reduce(
    (acc, stage) => {
      acc[stage] = leads.filter((lead) => lead.stage === stage).length;
      return acc;
    },
    {} as Record<LeadStage, number>
  );
  const maxStageCount = Math.max(1, ...STAGES.map((stage) => stageCounts[stage]));

  const businessLineCounts = BUSINESS_LINES.reduce(
    (acc, line) => {
      acc[line] = openLeads.filter((lead) => lead.business_line === line).length;
      return acc;
    },
    {} as Record<BusinessLine, number>
  );
  const maxLineCount = Math.max(1, ...BUSINESS_LINES.map((line) => businessLineCounts[line]));

  const STATS = [
    {
      label: "Total Open Leads",
      value: openLeads.length,
      icon: Layers,
      tone: "text-white",
      href: "/leads",
    },
    {
      label: "Stuck Deals",
      value: stuckLeads.length,
      icon: AlertTriangle,
      tone: stuckLeads.length > 0 ? "text-amber-300" : "text-white",
      href: "#stuck-deals",
    },
    {
      label: "Follow-ups Due",
      value: followUpLeads.length,
      icon: CalendarClock,
      tone: followUpLeads.length > 0 ? "text-rose-300" : "text-white",
      href: "#follow-ups-due",
    },
    {
      label: "Closed Won This Month",
      value: closedWonThisMonth,
      icon: CheckCircle2,
      tone: "text-emerald-300",
      href: "/leads?stage=closed_won",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-white/45">Overview of your pipeline at a glance.</p>
      </div>

      {error && (
        <GlassCard interactive={false} className="mb-6 p-6 text-sm text-rose-300">
          Failed to load leads: {error.message}
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block">
            <GlassCard className="p-6">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-white/45">{stat.label}</p>
                <stat.icon className={`h-4 w-4 ${stat.tone}`} />
              </div>
              <p className={`mt-3 text-3xl font-semibold tracking-tight ${stat.tone}`}>
                {error ? "—" : stat.value}
              </p>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">Leads by Stage</h2>
          {leads.length === 0 ? (
            <p className="text-sm text-white/35">No leads yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {STAGES.map((stage) => {
                const count = stageCounts[stage];
                const width = count === 0 ? 0 : Math.max(4, (count / maxStageCount) * 100);
                return (
                  <Link
                    key={stage}
                    href={`/leads?stage=${stage}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-28 shrink-0 text-sm text-white/60 group-hover:text-white/90">
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className={`block h-full rounded-full transition-all duration-300 ease-out ${STAGE_BAR_COLORS[stage]}`}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm font-medium text-white/80">
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <GlassCard interactive={false} className="p-6" id="stuck-deals">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Stuck Deals
          </h2>
          {stuckLeads.length === 0 ? (
            <p className="text-sm text-white/35">No stuck deals right now.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {stuckLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/85">{contactName(lead)}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {BUSINESS_LINE_LABELS[lead.business_line]} · <StageBadge stage={lead.stage} />
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium whitespace-nowrap text-amber-300">
                    {daysSince(lead.stage_updated_at)}d stuck
                  </span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard interactive={false} className="p-6" id="follow-ups-due">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/70">
            <CalendarClock className="h-4 w-4 text-rose-400" />
            Follow-ups Due
          </h2>
          {followUpLeads.length === 0 ? (
            <p className="text-sm text-white/35">No follow-ups due.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {followUpLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/85">{contactName(lead)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40">
                      {BUSINESS_LINE_LABELS[lead.business_line]}
                      <PriorityBadge priority={lead.priority} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium whitespace-nowrap text-rose-300">
                      {followUpLabel(lead.follow_up_date!)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      {formatDateOnly(lead.follow_up_date!)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard interactive={false} className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white/70">Open Leads by Business Line</h2>
          {openLeads.length === 0 ? (
            <p className="text-sm text-white/35">No open leads.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {BUSINESS_LINES.map((line) => {
                const count = businessLineCounts[line];
                const width = count === 0 ? 0 : Math.max(4, (count / maxLineCount) * 100);
                return (
                  <Link
                    key={line}
                    href={`/leads?business_line=${line}`}
                    className="group flex items-center gap-4 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                  >
                    <span className="w-14 shrink-0 text-sm text-white/60 group-hover:text-white/90">
                      {BUSINESS_LINE_LABELS[line]}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-indigo-500/70 transition-all duration-300 ease-out"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm font-medium text-white/80">
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
