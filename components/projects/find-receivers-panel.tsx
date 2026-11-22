"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { findMatchingReceivers, type FindMatchingReceiversResult, type ReceiverMatch } from "@/lib/actions/matching";
import { useMatchAndAutoFill } from "@/lib/use-match-and-autofill";
import { truncate } from "@/lib/format";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

interface FindReceiversPanelProps {
  projectId: string;
  hasMatch: boolean;
  // Opened on first render when the project page was reached via
  // /projects/[id]?findReceivers=true — the Dashboard's "Not matched"
  // card and the Projects list's own "Find receivers" link both land
  // here (components/projects/projects-list-view.tsx).
  defaultOpen?: boolean;
  lang?: Lang;
}

function matchingProductsLabel(r: ReceiverMatch, t: ReturnType<typeof getDictionary>): string {
  return r.matchingProducts
    .map((m) => `${m.product}${m.isFinal ? ` (${t.findReceivers.final})` : ""} · ${m.ratio ? m.ratio : t.findReceivers.noRatio}`)
    .join("  ·  ");
}

export function FindReceiversPanel({ projectId, hasMatch, defaultOpen = false, lang = "en" }: FindReceiversPanelProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(defaultOpen);
  const [data, setData] = useState<FindMatchingReceiversResult | null>(null);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [justMatched, setJustMatched] = useState<string | null>(null);

  const { match, resolveDiffers, isPending, error, differs, clearError } = useMatchAndAutoFill((receiverLabel) => {
    setOpen(false);
    setJustMatched(t.findReceivers.matchedWith(receiverLabel));
    router.refresh();
  }, lang);

  useEffect(() => {
    if (!open) return;
    findMatchingReceivers(projectId).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [open, projectId]);

  function toggleOpen() {
    clearError();
    if (!open) {
      // Reset before the effect above re-fetches, so a reopen never
      // flashes the previous list while the fresh one loads.
      setLoading(true);
      setData(null);
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!justMatched) return;
    const timeout = setTimeout(() => setJustMatched(null), 5000);
    return () => clearTimeout(timeout);
  }, [justMatched]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.receivers.filter((r) => {
      if (productFilter && !r.matchingProducts.some((m) => m.product === productFilter)) return false;
      if (!q) return true;
      return r.fullName.toLowerCase().includes(q) || (r.notes ?? "").toLowerCase().includes(q);
    });
  }, [data, search, productFilter]);

  const relevantLabel = data?.finalProduct ?? data?.productOptions.join(t.findReceivers.or) ?? t.findReceivers.thisProduct;
  const showChips = Boolean(data && !data.finalProduct && data.productOptions.length > 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleOpen}
          className={
            hasMatch
              ? "inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
              : "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
          }
        >
          <Search className={hasMatch ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {open ? t.common.close : t.findReceivers.title}
        </button>
        {justMatched && <p className="text-xs text-emerald-300">{justMatched}</p>}
      </div>

      {open && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3.5">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.findReceivers.loading}
            </p>
          )}

          {!loading && data?.error && <p className="text-sm text-rose-300">{resolveError(data.error, lang)}</p>}

          {!loading && data && !data.error && (
            <>
              {differs && (
                <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
                  <p className="text-xs text-amber-200">
                    {t.matchedReceiver.ratioDiffers(differs.contactName, differs.productType, differs.theirRatio, differs.currentRatio || "—")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resolveDiffers("use")}
                      disabled={isPending}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t.matchedReceiver.useRatio(differs.theirRatio)}
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveDiffers("keep")}
                      disabled={isPending}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t.matchedReceiver.keepRatio(differs.currentRatio || t.findReceivers.current)}
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}

              {data.receivers.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-white/50">{t.findReceivers.noneOffer(relevantLabel)}</p>
                  <Link href="/receivers/new" className="w-fit text-xs font-medium text-accent-soft hover:underline">
                    {t.findReceivers.addReceiver}
                  </Link>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t.findReceivers.searchPlaceholder}
                        className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] py-1.5 pr-7 pl-7 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          aria-label={t.findReceivers.clearSearch}
                          className="absolute top-1/2 right-2 -translate-y-1/2 text-white/30 hover:text-white/70"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {showChips && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setProductFilter(null)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ease-out ${
                          productFilter === null
                            ? "border-accent/40 bg-accent/15 text-accent-soft"
                            : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
                        }`}
                      >
                        {t.findReceivers.all}
                      </button>
                      {data.productOptions.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setProductFilter(p)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ease-out ${
                            productFilter === p
                              ? "border-accent/40 bg-accent/15 text-accent-soft"
                              : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {filtered.length === 0 ? (
                    <p className="text-sm text-white/35">{t.findReceivers.noMatchYourSearch}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {filtered.map((r) => (
                        <div key={r.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Link
                              href={`/receivers/${r.id}`}
                              className="text-sm font-medium text-white hover:underline"
                            >
                              {r.fullName}
                            </Link>
                            <button
                              type="button"
                              onClick={() => match(projectId, r.id, r.fullName)}
                              disabled={isPending}
                              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isPending ? t.findReceivers.matching : t.findReceivers.match}
                            </button>
                          </div>
                          <p className="mt-1.5 text-xs text-white/50">{matchingProductsLabel(r, t)}</p>
                          {r.notes && <p className="mt-1 text-xs text-white/35">{truncate(r.notes, 100)}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-white/35">
                            <span>
                              {r.documentTypesOnFile.length > 0
                                ? r.documentTypesOnFile.map((docType) => `${docType} ✓`).join("  ·  ")
                                : t.findReceivers.noDocumentsOnFile}
                            </span>
                            <span>{t.findReceivers.intermediaryCount(r.intermediaryCount)}</span>
                            <span>{t.findReceivers.openMatchedProjectCount(r.openMatchedProjectCount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
