import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Inbox, Paperclip, Plus, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { ClickableRow } from "@/components/clickable-row";
import { ClickableCard } from "@/components/clickable-card";
import { ProcedureFilters } from "@/components/procedures/procedure-filters";
import { PossibleDuplicateBadge, ProcedureSourceBadge, ProcedureStatusBadge } from "@/components/procedures/badges";
import { DeleteProcedureButton } from "@/components/procedures/delete-procedure-button";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_LINE_LABELS } from "@/lib/leads";
import { formatDateTime, truncate } from "@/lib/procedures";
import type { Procedure } from "@/lib/types";

interface ProceduresPageProps {
  searchParams: Promise<{ area?: string; status?: string; q?: string }>;
}

export default async function ProceduresPage({ searchParams }: ProceduresPageProps) {
  const params = await searchParams;

  const supabase = await createClient();
  let query = supabase.from("procedures").select("*").order("created_at", { ascending: false });

  if (params.area) {
    query = query.eq("area", params.area);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  let procedures = (data as Procedure[] | null) ?? [];

  const searchTerm = params.q?.trim().toLowerCase();
  if (searchTerm) {
    procedures = procedures.filter(
      (procedure) =>
        procedure.title?.toLowerCase().includes(searchTerm) ||
        procedure.raw_content.toLowerCase().includes(searchTerm)
    );
  }

  const { data: contactsData } = await supabase.from("contacts").select("id, full_name");
  const contactNameById = new Map(
    ((contactsData as { id: string; full_name: string }[] | null) ?? []).map((c) => [c.id, c.full_name])
  );

  const { data: documentProcedureIds } = await supabase.from("procedure_documents").select("procedure_id");
  const procedureIdsWithDocuments = new Set(
    ((documentProcedureIds as { procedure_id: string }[] | null) ?? []).map((d) => d.procedure_id)
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Procedures</h1>
          <p className="mt-1 text-sm text-white/45">
            Raw intake from WhatsApp, Telegram, documents, and links — triage before matching to a lead.
          </p>
        </div>
        <Link
          href="/procedures/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400"
        >
          <Plus className="h-4 w-4" />
          Add Procedure
        </Link>
      </div>

      <div className="mb-4">
        <Suspense>
          <ProcedureFilters />
        </Suspense>
      </div>

      {error && (
        <GlassCard interactive={false} className="p-6 text-sm text-rose-300">
          Failed to load procedures: {error.message}
        </GlassCard>
      )}

      {!error && procedures.length === 0 && (
        <GlassCard
          interactive={false}
          className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
            <Inbox className="h-5 w-5 text-white/40" />
          </div>
          <p className="text-sm font-medium text-white/70">No procedures yet</p>
          <p className="max-w-xs text-xs text-white/35">
            {params.area || params.status || params.q
              ? "No procedures match the current filters."
              : "Incoming offers and requests will show up here before they're matched to a lead."}
          </p>
        </GlassCard>
      )}

      {!error && procedures.length > 0 && (
        <>
          <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs tracking-wide text-white/40 uppercase">
                  <th className="px-4 py-3 font-medium">Source / Area</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {procedures.map((procedure) => {
                  const unmatched = procedure.status === "unmatched";

                  return (
                    <ClickableRow
                      key={procedure.id}
                      href={`/procedures/${procedure.id}`}
                      className={`border-b border-white/[0.04] transition-colors duration-150 ease-out last:border-0 hover:bg-white/[0.03] ${
                        unmatched ? "border-l-2 border-l-amber-500/60 bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProcedureSourceBadge source={procedure.source} />
                          <span className="text-xs text-white/50">
                            {procedure.area ? BUSINESS_LINE_LABELS[procedure.area] : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProcedureStatusBadge status={procedure.status} />
                          {unmatched && (
                            <span title="Needs triage">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/70 group-hover:text-white">
                        {(procedure.contact_id && contactNameById.get(procedure.contact_id)) || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-white/70 group-hover:text-white">
                          <span className="max-w-md truncate font-medium text-white/85">
                            {procedure.title || truncate(procedure.raw_content, 100)}
                          </span>
                          {procedure.intended_as_lead && (
                            <span
                              title="Flagged as a lead via Telegram"
                              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-fuchsia-300"
                            >
                              <Sparkles className="h-3 w-3" />
                              Lead
                            </span>
                          )}
                          {procedure.possible_duplicate && <PossibleDuplicateBadge />}
                          {procedureIdsWithDocuments.has(procedure.id) && (
                            <span title="Has attached documents">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-white/35" />
                            </span>
                          )}
                        </div>
                        <span className="mt-0.5 block text-xs text-white/35" title="Created">
                          {formatDateTime(procedure.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DeleteProcedureButton procedureId={procedure.id} compact />
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>

          <div className="flex flex-col gap-3 md:hidden">
            {procedures.map((procedure) => {
              const unmatched = procedure.status === "unmatched";

              return (
                <ClickableCard
                  key={procedure.id}
                  href={`/procedures/${procedure.id}`}
                  className={unmatched ? "border-l-2 border-l-amber-500/60 bg-amber-500/[0.04]" : ""}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ProcedureSourceBadge source={procedure.source} />
                      <span className="text-xs text-white/50">
                        {procedure.area ? BUSINESS_LINE_LABELS[procedure.area] : "—"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ProcedureStatusBadge status={procedure.status} />
                      {unmatched && (
                        <span title="Needs triage">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white/85">
                      {procedure.title || truncate(procedure.raw_content, 100)}
                    </span>
                    {procedure.intended_as_lead && (
                      <span
                        title="Flagged as a lead via Telegram"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-fuchsia-300"
                      >
                        <Sparkles className="h-3 w-3" />
                        Lead
                      </span>
                    )}
                    {procedure.possible_duplicate && <PossibleDuplicateBadge />}
                    {procedureIdsWithDocuments.has(procedure.id) && (
                      <span title="Has attached documents">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-white/35" />
                      </span>
                    )}
                  </div>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Contact</dt>
                      <dd className="mt-0.5 text-white/70">
                        {(procedure.contact_id && contactNameById.get(procedure.contact_id)) || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium tracking-wide text-white/35 uppercase">Created</dt>
                      <dd className="mt-0.5 text-white/50">{formatDateTime(procedure.created_at)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex justify-end border-t border-white/[0.06] pt-3">
                    <DeleteProcedureButton procedureId={procedure.id} compact />
                  </div>
                </ClickableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
