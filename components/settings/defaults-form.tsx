"use client";

import { useState } from "react";
import { updateAppSettings } from "@/lib/actions/app-settings";
import { CURRENCIES } from "@/lib/projects";
import type { AppSettings, Currency } from "@/lib/types";

interface DefaultsFormProps {
  settings: AppSettings;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function DefaultsForm({ settings }: DefaultsFormProps) {
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>(settings.default_currency);
  const [stuckAfterDays, setStuckAfterDays] = useState(String(settings.stuck_after_days));
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const days = Number(stuckAfterDays);
    if (!Number.isInteger(days) || days <= 0) {
      setError('"Stuck after" must be a whole number of days greater than 0.');
      return;
    }

    setIsPending(true);
    try {
      const result = await updateAppSettings(defaultCurrency, days);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-5">
      <div>
        <label className={labelClass} htmlFor="default_currency">
          Default Currency for New Projects
        </label>
        <select
          id="default_currency"
          value={defaultCurrency}
          onChange={(e) => {
            setDefaultCurrency(e.target.value as Currency);
            setSuccess(false);
          }}
          className={fieldClass}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency} className="bg-[#0a0e17]">
              {currency}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="stuck_after_days">
          Stuck After (days)
        </label>
        <input
          id="stuck_after_days"
          type="number"
          min={1}
          step={1}
          value={stuckAfterDays}
          onChange={(e) => {
            setStuckAfterDays(e.target.value);
            setSuccess(false);
          }}
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">
          Projects with no activity for this many days show up as &quot;stuck&quot; on the Dashboard.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {success && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Saved.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
