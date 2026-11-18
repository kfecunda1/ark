"use client";

import { useState } from "react";
import { connectTelegramWebhook, getTelegramWebhookStatus, type TelegramWebhookStatus } from "@/lib/actions/telegram-admin";

export function TelegramBotPanel() {
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
        setError(result.error);
        return;
      }
      setStatus(result.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
        setError(result.error);
        return;
      }
      setConnected(true);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
          {isConnecting ? "Connecting…" : "Connect webhook"}
        </button>
        <button
          type="button"
          onClick={refreshStatus}
          disabled={isChecking}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChecking ? "Checking…" : "Check status"}
        </button>
      </div>

      <p className="text-xs text-white/35">
        Points the bot at this site&apos;s own <code>/api/telegram/inbox</code> address. The bot token is never shown here.
      </p>

      {connected && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Webhook connected.
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {status && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-sm text-white/70">
          <p>
            URL: <span className="text-white/50">{status.url || "not set"}</span>
          </p>
          <p>
            Pending updates: <span className="text-white/50">{status.pendingUpdateCount ?? "—"}</span>
          </p>
          {status.lastErrorMessage && <p className="mt-1 text-rose-300">Last error: {status.lastErrorMessage}</p>}
        </div>
      )}
    </div>
  );
}
