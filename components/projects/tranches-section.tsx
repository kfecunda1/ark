"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Plus, Trash2 } from "lucide-react";
import { upsertProjectTranche, deleteProjectTranche } from "@/lib/actions/projects";
import { formatDateOnly, virtualTrancheNumbers } from "@/lib/projects";
import { dateKeyInTimeZone } from "@/lib/format";
import { MoneyInput } from "@/components/money-input";
import { ProjectDocuments, type ProjectDocumentWithUrl } from "@/components/projects/project-documents";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Currency, DocumentTypeRecord, ProjectTranche } from "@/lib/types";

interface TranchesSectionProps {
  projectId: string;
  tranches: ProjectTranche[];
  currency: Currency;
  documents: ProjectDocumentWithUrl[];
  documentTypes: DocumentTypeRecord[];
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface RowProps {
  number: number;
  tranche: ProjectTranche | null;
  currency: Currency;
  removable: boolean;
  disabled: boolean;
  onSave: (amount: string, sentOn: string, notes: string, confirmedOn: string, paidOutOn: string) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  projectId: string;
  tranches: ProjectTranche[];
  documents: ProjectDocumentWithUrl[];
  documentTypes: DocumentTypeRecord[];
  lang: Lang;
}

// Identifies a tranche by its actual saved values rather than object
// identity: a server refresh creates a brand-new ProjectTranche object
// on every render regardless of whether anything in it changed, and
// comparing by reference would then resync (and so discard) an
// in-progress, not-yet-saved edit in some *other* row every time any
// refresh happens anywhere on the page.
function trancheKey(tranche: ProjectTranche | null): string {
  return `${tranche?.amount ?? ""}|${tranche?.sent_on ?? ""}|${tranche?.notes ?? ""}|${tranche?.confirmed_on ?? ""}|${tranche?.paid_out_on ?? ""}`;
}

function statusBadge(sentOn: string, confirmedOn: string, paidOutOn: string, lang: Lang) {
  const t = getDictionary(lang);
  if (paidOutOn) {
    return (
      <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
        {t.tranches.paidOutOnBadge(formatDateOnly(paidOutOn, lang))}
      </span>
    );
  }
  if (confirmedOn) {
    return (
      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        {t.dashboard.confirmedOn(formatDateOnly(confirmedOn, lang))}
      </span>
    );
  }
  if (sentOn) {
    return (
      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        {t.tranches.sentOnAwaitingBadge(formatDateOnly(sentOn, lang))}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/45">
      {t.tranches.notSent}
    </span>
  );
}

function TrancheRow({
  number,
  tranche,
  currency,
  removable,
  disabled,
  onSave,
  onDelete,
  onCancel,
  projectId,
  tranches,
  documents,
  documentTypes,
  lang,
}: RowProps) {
  const t = getDictionary(lang);
  const [amount, setAmount] = useState(tranche?.amount != null ? String(tranche.amount) : "");
  const [sentOn, setSentOn] = useState(tranche?.sent_on ?? "");
  const [notes, setNotes] = useState(tranche?.notes ?? "");
  const [confirmedOn, setConfirmedOn] = useState(tranche?.confirmed_on ?? "");
  const [paidOutOn, setPaidOutOn] = useState(tranche?.paid_out_on ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const docCount = tranche ? documents.filter((d) => d.tranche_id === tranche.id).length : 0;
  const [docsOpen, setDocsOpen] = useState(docCount > 0);

  // Resyncs the fields to the server's actual row once its *values*
  // change (a successful save, or a refresh after someone else's edit)
  // — adjusting state directly during render, React's documented
  // pattern for this, rather than in a useEffect (which would cause an
  // extra render pass and, since it can't tell "the data changed" apart
  // from "the page merely re-rendered", the same discard-other-rows'-
  // drafts problem `trancheKey` above avoids).
  //
  // This is the actual fix for the bug where saving a tranche appeared
  // to do nothing: `useState`'s initial value only runs once, on mount,
  // so without this, the row kept displaying its pre-save local state
  // forever and never picked up the confirmed server value — there was
  // no feedback that anything had happened either way.
  const [prevKey, setPrevKey] = useState(trancheKey(tranche));
  const currentKey = trancheKey(tranche);
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setAmount(tranche?.amount != null ? String(tranche.amount) : "");
    setSentOn(tranche?.sent_on ?? "");
    setNotes(tranche?.notes ?? "");
    setConfirmedOn(tranche?.confirmed_on ?? "");
    setPaidOutOn(tranche?.paid_out_on ?? "");
  }

  function markSentToday() {
    setSentOn(dateKeyInTimeZone(new Date().toISOString()));
  }

  function markConfirmedToday() {
    setBlockedMessage(null);
    setConfirmedOn(dateKeyInTimeZone(new Date().toISOString()));
  }

  function markPaidOutToday() {
    setBlockedMessage(null);
    setPaidOutOn(dateKeyInTimeZone(new Date().toISOString()));
  }

  // The DB's own check constraints (023_tranche_confirmed.sql, 025_
  // payouts.sql) would reject either of these cases anyway, but
  // blocking them here means they never even reach a save — the field
  // itself refuses to go blank while the date one step ahead of it is
  // still sitting on it.
  function handleSentOnChange(value: string) {
    if (!value && confirmedOn) {
      setBlockedMessage(t.tranches.clearConfirmedFirst);
      return;
    }
    setBlockedMessage(null);
    setSentOn(value);
  }

  function handleConfirmedOnChange(value: string) {
    if (!value && paidOutOn) {
      setBlockedMessage(t.tranches.clearPaidOutFirst);
      return;
    }
    setBlockedMessage(null);
    setConfirmedOn(value);
  }

  function handlePaidOutOnChange(value: string) {
    setBlockedMessage(null);
    setPaidOutOn(value);
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-white/55">{t.dashboard.trancheNumber(number)}</p>
        {statusBadge(sentOn, confirmedOn, paidOutOn, lang)}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-white/40">
            {currency}
          </span>
          <MoneyInput
            aria-label={t.tranches.amountAriaLabel}
            placeholder={t.tranches.amountPlaceholder}
            value={amount}
            onChange={setAmount}
            disabled={disabled}
            className={fieldClass}
            style={{ paddingLeft: "3.25rem" }}
          />
        </div>
        <input
          type="date"
          aria-label={t.tranches.sentOnAriaLabel}
          value={sentOn}
          onChange={(e) => handleSentOnChange(e.target.value)}
          disabled={disabled}
          className={fieldClass}
        />
        <input
          type="text"
          placeholder={t.tranches.notesPlaceholder}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled}
          className={fieldClass}
        />
      </div>

      {sentOn && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/40">{t.tranches.confirmedOnFieldLabel}</label>
            <input
              type="date"
              aria-label={t.tranches.confirmedOnFieldLabel}
              value={confirmedOn}
              min={sentOn}
              onChange={(e) => handleConfirmedOnChange(e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </div>
          {confirmedOn && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-white/40">{t.tranches.paidOutOnFieldLabel}</label>
              <input
                type="date"
                aria-label={t.tranches.paidOutOnFieldLabel}
                value={paidOutOn}
                min={confirmedOn}
                onChange={(e) => handlePaidOutOnChange(e.target.value)}
                disabled={disabled}
                className={fieldClass}
              />
            </div>
          )}
        </div>
      )}

      {blockedMessage && <p className="mt-2 text-xs text-amber-300">{blockedMessage}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSave(amount, sentOn, notes, confirmedOn, paidOutOn)}
          disabled={disabled}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.common.save}
        </button>
        {!sentOn && (
          <button
            type="button"
            onClick={markSentToday}
            disabled={disabled}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.tranches.markSentToday}
          </button>
        )}
        {sentOn && !confirmedOn && (
          <button
            type="button"
            onClick={markConfirmedToday}
            disabled={disabled}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.tranches.markConfirmedToday}
          </button>
        )}
        {confirmedOn && !paidOutOn && (
          <button
            type="button"
            onClick={markPaidOutToday}
            disabled={disabled}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.tranches.markPaidOutToday}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            {t.common.cancel}
          </button>
        )}
        {removable && onDelete && (
          <div className="ml-auto flex items-center gap-2">
            {confirmingDelete ? (
              <>
                <span className="text-xs text-amber-300">
                  {docCount > 0 ? t.tranches.documentsWillMove(docCount) : t.tranches.removeTrancheConfirm(number)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete();
                    setConfirmingDelete(false);
                  }}
                  disabled={disabled}
                  className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {disabled ? t.common.removing : t.common.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={disabled}
                  className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                >
                  {t.common.cancel}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={disabled}
                aria-label={t.tranches.removeTrancheAriaLabel(number)}
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.common.remove}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => setDocsOpen((open) => !open)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/60 transition-colors duration-150 ease-out hover:text-white/90"
        >
          {docsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FileText className="h-3.5 w-3.5" />
          {t.searchGroups.document}
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white/50">
            {docCount}
          </span>
        </button>
        {docsOpen && (
          <div className="mt-2">
            <ProjectDocuments
              projectId={projectId}
              documents={documents}
              documentTypes={documentTypes}
              tranches={tranches}
              scope={{ kind: "tranche", number }}
              lang={lang}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function TranchesSection({ projectId, tranches, currency, documents, documentTypes, lang = "en" }: TranchesSectionProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedNumber, setSavedNumber] = useState<number | null>(null);
  const [addingNext, setAddingNext] = useState(false);

  const byNumber = new Map(tranches.map((t) => [t.tranche_number, t]));
  const extraNumbers = virtualTrancheNumbers(tranches).filter((n) => n > 2);
  const nextNumber = Math.max(2, ...extraNumbers) + 1;

  function handleSave(
    trancheNumber: number,
    amount: string,
    sentOn: string,
    notes: string,
    confirmedOn: string,
    paidOutOn: string
  ) {
    setError(null);
    setSavedNumber(null);
    startTransition(async () => {
      try {
        const result = await upsertProjectTranche(
          projectId,
          trancheNumber,
          amount,
          sentOn,
          notes,
          confirmedOn,
          paidOutOn
        );
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setAddingNext(false);
        setSavedNumber(trancheNumber);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  function handleDelete(trancheNumber: number) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteProjectTranche(projectId, trancheNumber);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {[1, 2, ...extraNumbers].map((number) => (
        <div key={number} className="flex flex-col gap-1">
          <TrancheRow
            number={number}
            tranche={byNumber.get(number) ?? null}
            currency={currency}
            removable={number > 2}
            disabled={isPending}
            onSave={(amount, sentOn, notes, confirmedOn, paidOutOn) =>
              handleSave(number, amount, sentOn, notes, confirmedOn, paidOutOn)
            }
            onDelete={number > 2 ? () => handleDelete(number) : undefined}
            projectId={projectId}
            tranches={tranches}
            documents={documents}
            documentTypes={documentTypes}
            lang={lang}
          />
          {savedNumber === number && !isPending && (
            <p className="text-xs text-emerald-300">{t.common.saved}</p>
          )}
        </div>
      ))}

      {addingNext ? (
        <TrancheRow
          number={nextNumber}
          tranche={null}
          currency={currency}
          removable={false}
          disabled={isPending}
          onSave={(amount, sentOn, notes, confirmedOn, paidOutOn) =>
            handleSave(nextNumber, amount, sentOn, notes, confirmedOn, paidOutOn)
          }
          onCancel={() => setAddingNext(false)}
          projectId={projectId}
          tranches={tranches}
          documents={documents}
          documentTypes={documentTypes}
          lang={lang}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingNext(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.tranches.tranchesAfter}
        </button>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
