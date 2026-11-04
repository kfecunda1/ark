"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyWalletButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail (e.g. insecure origin, permissions) — no
      // fallback needed, the address is still visible to copy manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy wallet address"
      className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
