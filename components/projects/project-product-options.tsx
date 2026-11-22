"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectFinalProduct, updateProjectRatioReal } from "@/lib/actions/projects";
import { getContactProductRatios } from "@/lib/actions/contacts";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

interface ProjectProductOptionsProps {
  projectId: string;
  options: string[];
  finalProduct: string | null;
  matchedContactId: string | null;
  isRecovery: boolean;
  lang?: Lang;
}

type Message =
  | { tone: "filled"; text: string }
  | { tone: "differs"; contactName: string; productType: string; theirRatio: string; currentRatio: string }
  | { tone: "missing"; contactName: string; productType: string; isRecovery: boolean };

// The detail page's chips for a project's product options — "Choose as
// final" while nothing's decided, "Rejected" + "Make final instead" for
// every option once one has been, and "Undo choice" to go back to Not
// decided. Adding/removing options themselves only ever happens through
// the Edit form (components/projects/product-options-picker.tsx); this
// only ever changes which existing option (if any) is final.
export function ProjectProductOptions({
  projectId,
  options,
  finalProduct,
  matchedContactId,
  isRecovery,
  lang = "en",
}: ProjectProductOptionsProps) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [infoRatios, setInfoRatios] = useState<Record<string, string | null> | null>(null);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);

  const optionsKey = options.join(",");

  // While nothing's decided yet, show the matched contact's ratio per
  // option as plain information — never written anywhere, just a hint
  // for whichever option gets chosen.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (finalProduct || !matchedContactId || options.length === 0) {
        if (!cancelled) setInfoRatios(null);
        return;
      }
      const ratios = await getContactProductRatios(matchedContactId, options, isRecovery);
      if (!cancelled) setInfoRatios(ratios);
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsKey stands in for options (array identity isn't stable across renders)
  }, [finalProduct, matchedContactId, optionsKey, isRecovery]);

  function applyFinal(product: string | null) {
    setError(null);
    setMessage(null);
    setBusyProduct(product);
    startTransition(async () => {
      try {
        const result = await setProjectFinalProduct(projectId, product);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        if (result.autoFill) {
          const { filled, differs, contactName, productType, theirRatio, currentRatio, isRecovery } = result.autoFill;
          if (filled) {
            setMessage({ tone: "filled", text: t.matchedReceiver.ratioFilled(contactName, productType) });
          } else if (differs) {
            setMessage({ tone: "differs", contactName, productType, theirRatio: theirRatio!, currentRatio: currentRatio ?? "" });
          } else {
            setMessage({ tone: "missing", contactName, productType, isRecovery });
          }
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setBusyProduct(null);
      }
    });
  }

  // The only way ratio_real is overwritten once it already holds a
  // different value — never automatically.
  function useTheirRatio() {
    if (message?.tone !== "differs") return;
    const { theirRatio } = message;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectRatioReal(projectId, theirRatio);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setMessage(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isFinal = finalProduct === option;
          const isRejected = finalProduct !== null && !isFinal;
          return (
            <div
              key={option}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                isFinal
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                  : isRejected
                    ? "border-white/10 bg-white/[0.03] text-white/35"
                    : "border-white/10 bg-white/[0.06] text-white/80"
              }`}
            >
              <span className={isRejected ? "line-through" : ""}>{option}</span>
              {isRejected && (
                <span className="text-[11px] font-medium tracking-wide text-white/30 uppercase">{t.productOptions.rejected}</span>
              )}
              {!finalProduct && (
                <button
                  type="button"
                  onClick={() => applyFinal(option)}
                  disabled={isPending}
                  className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending && busyProduct === option ? t.productOptions.choosing : t.productOptions.chooseAsFinal}
                </button>
              )}
              {isRejected && (
                <button
                  type="button"
                  onClick={() => applyFinal(option)}
                  disabled={isPending}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending && busyProduct === option ? t.productOptions.choosing : t.productOptions.makeFinalInstead}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-white/60">
        {t.productOptions.finalProductLabel}{" "}
        {finalProduct ? (
          <span className="font-medium text-emerald-300">{finalProduct}</span>
        ) : (
          <span className="text-white/40">{t.productOptions.notDecided}</span>
        )}
        {finalProduct && (
          <button
            type="button"
            onClick={() => applyFinal(null)}
            disabled={isPending}
            className="ml-2 text-xs font-medium text-white/40 underline decoration-white/20 underline-offset-2 transition-colors duration-150 ease-out hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.productOptions.undoChoice}
          </button>
        )}
      </p>

      {infoRatios && Object.keys(infoRatios).length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
          <p className="text-xs text-white/50">
            {t.productOptions.infoRatiosHint(
              isRecovery ? t.matchedReceiver.recoveryRatioNoun : t.matchedReceiver.ratioNoun
            )}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {Object.entries(infoRatios).map(([product, ratio]) => (
              <li key={product} className="text-xs text-white/70">
                {product}: {ratio ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message?.tone === "filled" && <p className="text-xs text-emerald-300">{message.text}</p>}
      {message?.tone === "differs" && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-200">
            {t.matchedReceiver.ratioDiffers(message.contactName, message.productType, message.theirRatio, message.currentRatio)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={useTheirRatio}
              disabled={isPending}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.matchedReceiver.useRatio(message.theirRatio)}
            </button>
            <button
              type="button"
              onClick={() => setMessage(null)}
              disabled={isPending}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.matchedReceiver.keepRatio(message.currentRatio)}
            </button>
          </div>
        </div>
      )}

      {message?.tone === "missing" && (
        <p className="text-xs text-amber-300">
          {t.matchedReceiver.noRatioSet(
            message.contactName,
            message.isRecovery ? t.matchedReceiver.recoveryRatioNoun : t.matchedReceiver.ratioNoun,
            message.productType
          )}
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
