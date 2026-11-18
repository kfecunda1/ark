"use client";

import { useState } from "react";
import { updateOwnFullName, updateOwnTelegramId } from "@/lib/actions/profile";

interface MyProfileFormProps {
  fullName: string | null;
  telegramUserId: number | null;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function MyProfileForm({ fullName, telegramUserId }: MyProfileFormProps) {
  const [value, setValue] = useState(fullName ?? "");
  const [telegramId, setTelegramId] = useState(telegramUserId != null ? String(telegramUserId) : "");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsPending(true);
    try {
      const nameResult = await updateOwnFullName(value);
      if (nameResult.error) {
        setError(nameResult.error);
        return;
      }
      const telegramResult = await updateOwnTelegramId(telegramId);
      if (telegramResult.error) {
        setError(telegramResult.error);
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
        <label className={labelClass} htmlFor="display_name">
          Display Name
        </label>
        <input
          id="display_name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSuccess(false);
          }}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="telegram_user_id">
          Telegram Id
        </label>
        <input
          id="telegram_user_id"
          value={telegramId}
          onChange={(e) => {
            setTelegramId(e.target.value);
            setSuccess(false);
          }}
          placeholder="e.g. 123456789"
          inputMode="numeric"
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">Get it from @userinfobot.</p>
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
