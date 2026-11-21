"use client";

import { useState } from "react";
import { updateOwnFullName, updateOwnTelegramId, updateOwnBriefingPrefs } from "@/lib/actions/profile";
import { sendTestBriefing } from "@/lib/actions/morning-briefing";

interface MyProfileFormProps {
  fullName: string | null;
  telegramUserId: number | null;
  briefingEnabled: boolean;
  briefingWeekdaysOnly: boolean;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function MyProfileForm({ fullName, telegramUserId, briefingEnabled, briefingWeekdaysOnly }: MyProfileFormProps) {
  const [value, setValue] = useState(fullName ?? "");
  const [telegramId, setTelegramId] = useState(telegramUserId != null ? String(telegramUserId) : "");
  const [briefingOn, setBriefingOn] = useState(briefingEnabled);
  const [weekdaysOnly, setWeekdaysOnly] = useState(briefingWeekdaysOnly);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

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
      const briefingResult = await updateOwnBriefingPrefs(briefingOn, weekdaysOnly);
      if (briefingResult.error) {
        setError(briefingResult.error);
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleSendTest() {
    setTestError(null);
    setTestSent(false);
    setIsSendingTest(true);
    try {
      const result = await sendTestBriefing();
      if (result.error) {
        setTestError(result.error);
        return;
      }
      setTestSent(true);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSendingTest(false);
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

        <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <label className="flex items-center gap-2.5 text-sm text-white/80">
            <input
              type="checkbox"
              checked={briefingOn}
              onChange={(e) => {
                setBriefingOn(e.target.checked);
                setSuccess(false);
              }}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.03] accent-accent"
            />
            Morning briefing
          </label>
          <label className="flex items-center gap-2.5 pl-6 text-sm text-white/60">
            <input
              type="checkbox"
              checked={weekdaysOnly}
              disabled={!briefingOn}
              onChange={(e) => {
                setWeekdaysOnly(e.target.checked);
                setSuccess(false);
              }}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.03] accent-accent disabled:opacity-40"
            />
            Weekdays only
          </label>
          <p className="pl-0 text-xs text-white/35">
            Sent every morning to your Telegram, if an Id is set above.
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

      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-5">
        <button
          type="button"
          onClick={handleSendTest}
          disabled={isSendingTest || telegramUserId == null}
          className="w-fit rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSendingTest ? "Sending…" : "Send me a test briefing now"}
        </button>
        {telegramUserId == null && (
          <p className="text-xs text-white/35">Add and save a Telegram Id above first.</p>
        )}
        {testError && <p className="text-xs text-red-300">{testError}</p>}
        {testSent && <p className="text-xs text-emerald-300">Sent — check Telegram.</p>}
      </div>
    </div>
  );
}
