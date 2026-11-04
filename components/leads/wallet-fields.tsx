"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { LeadWallet } from "@/lib/types";

interface WalletRow {
  key: string;
  id: string | null;
  address: string;
  label: string;
}

interface WalletFieldsProps {
  initialWallets?: LeadWallet[];
  labelSuggestions?: string[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-white/20 focus:bg-white/[0.06]";

export function WalletFields({ initialWallets = [], labelSuggestions = [] }: WalletFieldsProps) {
  const [rows, setRows] = useState<WalletRow[]>(
    initialWallets.map((w) => ({ key: w.id, id: w.id, address: w.wallet_address, label: w.label ?? "" }))
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  function addRow() {
    setRows((prev) => [...prev, { key: crypto.randomUUID(), id: null, address: "", label: "" }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function updateAddress(key: string, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, address: value } : row)));
  }

  function updateLabel(key: string, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, label: value } : row)));
  }

  function suggestionsFor(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return labelSuggestions.slice(0, 8);
    return labelSuggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const suggestions = openKey === row.key ? suggestionsFor(row.label) : [];

        return (
          <div
            key={row.key}
            className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 sm:flex-row sm:items-center"
          >
            <input type="hidden" name="wallet_id" value={row.id ?? ""} />
            <div className="relative flex-1">
              <input
                name="wallet_label"
                value={row.label}
                onChange={(e) => {
                  updateLabel(row.key, e.target.value);
                  setOpenKey(row.key);
                }}
                onFocus={() => setOpenKey(row.key)}
                onBlur={() => setTimeout(() => setOpenKey((k) => (k === row.key ? null : k)), 120)}
                placeholder="Label (optional)"
                autoComplete="off"
                className={fieldClass}
              />

              {suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0f1420] py-1 shadow-xl">
                  {suggestions.map((option) => (
                    <li
                      key={option}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        updateLabel(row.key, option);
                        setOpenKey(null);
                      }}
                      className="cursor-pointer px-3 py-2 text-sm text-white/75 transition-colors duration-100 ease-out hover:bg-white/[0.06] hover:text-white"
                    >
                      {option}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-1 items-center gap-2">
              <input
                name="wallet_address"
                value={row.address}
                onChange={(e) => updateAddress(row.key, e.target.value)}
                placeholder="Wallet address"
                className={fieldClass}
              />
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label="Remove wallet"
                className="shrink-0 rounded-md p-2 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Wallet
      </button>
    </div>
  );
}
