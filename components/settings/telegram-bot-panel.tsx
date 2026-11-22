"use client";

import { useState } from "react";
import { connectTelegramWebhook, getTelegramWebhookStatus, type TelegramWebhookStatus } from "@/lib/actions/telegram-admin";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

export function TelegramBotPanel({ lang = "en" }: { lang?: Lang } = {}) {
  const t = getDictionary(lang);
  const [status, setStatus] = useState<TelegramWebhookStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  async function refreshStatus() {
    setIsChecking(true);
    setError(null);
    try {
      const result = await getTelegramWebhookStatus();
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      setStatus(result.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsChecking(false);
    }
  }

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);
    setConnected(false);
    try {
      const result = await connectTelegramWebhook();
      if (result.error) {
        setError(resolveError(result.error, lang));
        return;
      }
      setConnected(true);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleConnect}
          disabled={isConnecting}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isConnecting ? t.settingsTelegram.connecting : t.settingsTelegram.connectWebhook}
        </button>
        <button
          type="button"
          onClick={refreshStatus}
          disabled={isChecking}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChecking ? t.settingsTelegram.checking : t.settingsTelegram.checkStatus}
        </button>
      </div>

      <p className="text-xs text-white/35">{t.settingsTelegram.hint}</p>

      {connected && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {t.settingsTelegram.webhookConnected}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {status && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-sm text-white/70">
          <p>
            {t.settingsTelegram.urlLabel} <span className="text-white/50">{status.url || t.settingsTelegram.notSet}</span>
          </p>
          <p>
            {t.settingsTelegram.pendingUpdatesLabel} <span className="text-white/50">{status.pendingUpdateCount ?? "—"}</span>
          </p>
          {status.lastErrorMessage && (
            <p className="mt-1 text-rose-300">{t.settingsTelegram.lastErrorLabel(status.lastErrorMessage)}</p>
          )}
        </div>
      )}
    </div>
  );
}
