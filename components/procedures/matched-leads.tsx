"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { matchProcedureToLead, unmatchProcedureFromLead } from "@/lib/actions/procedures";
import { StageBadge } from "@/components/leads/badges";
import { BUSINESS_LINE_LABELS } from "@/lib/leads";
import type { BusinessLine, LeadStage } from "@/lib/types";

export interface LeadOption {
  id: string;
  business_line: BusinessLine;
  product_type: string;
  stage: LeadStage;
  primary_contact_name: string;
  counterparty_contact_name: string | null;
}

function leadLabel(lead: LeadOption): string {
  return lead.counterparty_contact_name
    ? `${lead.primary_contact_name} — ${lead.counterparty_contact_name}`
    : lead.primary_contact_name;
}

interface MatchedLeadsProps {
  procedureId: string;
  matchedLeads: LeadOption[];
  candidateLeads: LeadOption[];
  canAddMatches: boolean;
}

export function MatchedLeads({ procedureId, matchedLeads, candidateLeads, canAddMatches }: MatchedLeadsProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LeadOption | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? candidateLeads.filter(
          (lead) =>
            lead.primary_contact_name.toLowerCase().includes(q) ||
            (lead.counterparty_contact_name ?? "").toLowerCase().includes(q) ||
            lead.product_type.toLowerCase().includes(q) ||
            BUSINESS_LINE_LABELS[lead.business_line].toLowerCase().includes(q)
        )
      : candidateLeads;
    return pool.slice(0, 20);
  }, [candidateLeads, query]);

  function handleAdd() {
    if (!selected) return;
    setError(null);
    const leadId = selected.id;
    setPendingLeadId(leadId);
    startTransition(async () => {
      const result = await matchProcedureToLead(procedureId, leadId);
      setPendingLeadId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSelected(null);
      setQuery("");
      router.refresh();
    });
  }

  function handleRemove(leadId: string) {
    setError(null);
    setPendingLeadId(leadId);
    startTransition(async () => {
      const result = await unmatchProcedureFromLead(procedureId, leadId);
      setPendingLeadId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {matchedLeads.length === 0 ? (
        <p className="text-sm text-white/40">Not matched to any leads yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {matchedLeads.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-3"
            >
              <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1">
                <div className="text-sm text-white/85 hover:text-white">{leadLabel(lead)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-white/40">
                    {BUSINESS_LINE_LABELS[lead.business_line]} · {lead.product_type}
                  </span>
                  <StageBadge stage={lead.stage} />
                </div>
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(lead.id)}
                disabled={isPending && pendingLeadId === lead.id}
                className="shrink-0 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending && pendingLeadId === lead.id ? "Removing…" : "Unmatch"}
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMatches && (
        <>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={selected ? leadLabel(selected) : query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 100)}
              placeholder="Search by contact, business line, or product…"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-2.5 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]"
            />

            {open && !selected && (
              <ul className="absolute z-10 mt-1.5 max-h-80 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-white/35">No matching leads.</li>
                )}
                {filtered.map((lead) => (
                  <li
                    key={lead.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelected(lead);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="cursor-pointer px-3 py-2 transition-colors duration-100 ease-out hover:bg-white/[0.06]"
                  >
                    <div className="text-sm text-white/75">{leadLabel(lead)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-white/40">
                        {BUSINESS_LINE_LABELS[lead.business_line]} · {lead.product_type}
                      </span>
                      <StageBadge stage={lead.stage} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={!selected || isPending}
              onClick={handleAdd}
              className="rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && pendingLeadId === selected?.id ? "Matching…" : "Add match"}
            </button>
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
