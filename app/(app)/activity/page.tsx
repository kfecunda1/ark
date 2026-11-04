import Link from "next/link";
import { Suspense } from "react";
import { History } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityActionBadge, ActivityEntityBadge } from "@/components/activity/badges";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVITY_FILTER_ENTITY_TYPES,
  ACTIVITY_FILTER_LABELS,
  activityDetailChips,
  activityHref,
  activityTarget,
  formatActivityTime,
  groupActivityByDay,
  parseActivityFilter,
  targetKey,
  type ActivityTarget,
} from "@/lib/activity";
import type { ActivityLog } from "@/lib/types";

// How far back the page reaches in one load. The log grows with every
// edit, so this is capped rather than paginated — the digest is what
// nobody should have to scroll for, and older history stays queryable.
const ROW_LIMIT = 250;

interface ActivityPageProps {
  searchParams: Promise<{ type?: string }>;
}

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const params = await searchParams;
  const filter = parseActivityFilter(params.type);

  const supabase = await createClient();

  let query = supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (filter) {
    query = query.in("entity_type", ACTIVITY_FILTER_ENTITY_TYPES[filter]);
  }

  const { data, error } = await query;
  const rows = (data as ActivityLog[] | null) ?? [];

  // Which referenced records still exist, so a row only links somewhere
  // that will actually render (a record deleted after the fact, or a
  // document whose owner has since gone, must not link into a 404).
  const idsByTable: Record<ActivityTarget["table"], Set<string>> = {
    leads: new Set(),
    procedures: new Set(),
    contacts: new Set(),
  };
  for (const row of rows) {
    const target = activityTarget(row);
    if (target) idsByTable[target.table].add(target.id);
  }

  const [leadsRes, proceduresRes, contactsRes] = await Promise.all(
    (["leads", "procedures", "contacts"] as const).map((table) => {
      const ids = [...idsByTable[table]];
      return ids.length > 0
        ? supabase.from(table).select("id").in("id", ids)
        : Promise.resolve({ data: [] as { id: string }[] });
    })
  );

  const existing = new Set<string>();
  for (const [table, res] of [
    ["leads", leadsRes],
    ["procedures", proceduresRes],
    ["contacts", contactsRes],
  ] as const) {
    for (const record of ((res.data as { id: string }[] | null) ?? [])) {
      existing.add(targetKey(table, record.id));
    }
  }

  const dayGroups = groupActivityByDay(rows);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Activity</h1>
        <p className="mt-1 text-sm text-white/45">
          Everything created, updated, and deleted across the CRM, newest first.
        </p>
      </div>

      <div className="mb-4">
        <Suspense>
          <ActivityFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load activity: {error.message}
        </GlassCard>
      )}

      {!error && rows.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <History className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">
            {filter ? "No matching activity" : "No activity yet"}
          </p>
          <p className="max-w-xs text-xs text-white/35">
            {filter
              ? `Nothing has happened to ${ACTIVITY_FILTER_LABELS[filter].toLowerCase()} yet.`
              : "Changes to leads, procedures, contacts and documents will show up here."}
          </p>
        </GlassCard>
      )}

      {!error &&
        dayGroups.map((group) => (
          <section key={group.dayKey} className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">
              {group.heading}
            </h2>

            <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Record</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const href = activityHref(row, existing);
                    const chips = activityDetailChips(row);

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03]"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-white/50">
                          {formatActivityTime(row.created_at)}
                        </td>
                        <td className="px-4 py-3 text-white/70">{row.actor_label ?? "—"}</td>
                        <td className="px-4 py-3">
                          <ActivityActionBadge action={row.action} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <ActivityEntityBadge entityType={row.entity_type} />
                            {href ? (
                              <Link
                                href={href}
                                className="text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
                              >
                                {row.summary || "—"}
                              </Link>
                            ) : (
                              <span className="text-white/60">{row.summary || "—"}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-white/50">
                          {chips.length > 0 ? chips.join(" · ") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GlassCard>

            <div className="flex flex-col gap-3 md:hidden">
              {group.rows.map((row) => {
                const href = activityHref(row, existing);
                const chips = activityDetailChips(row);

                return (
                  <GlassCard key={row.id} interactive={false} className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ActivityActionBadge action={row.action} />
                        <ActivityEntityBadge entityType={row.entity_type} />
                      </div>
                      <span className="shrink-0 text-xs text-white/40">
                        {formatActivityTime(row.created_at)}
                      </span>
                    </div>

                    {href ? (
                      <Link
                        href={href}
                        className="text-sm font-medium text-white/85 underline decoration-white/20 underline-offset-2 hover:text-white"
                      >
                        {row.summary || "—"}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-white/60">{row.summary || "—"}</p>
                    )}

                    {chips.length > 0 && <p className="mt-1 text-xs text-white/45">{chips.join(" · ")}</p>}

                    <p className="mt-2 text-xs text-white/35">{row.actor_label ?? "—"}</p>
                  </GlassCard>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
