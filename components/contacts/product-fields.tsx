"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ContactProduct, Product, ProductType } from "@/lib/types";

interface ProductRow {
  key: string;
  id: string | null;
  product_type: ProductType | "";
  ratio: string;
  recovery_ratio: string;
  notes: string;
}

interface ProductFieldsProps {
  initialProducts?: ContactProduct[];
  // All products (not just active) — see the matching comment on
  // ProjectForm: an existing row's own product must keep showing even
  // if it's since been hidden; only the "available to add" pool is
  // active-only.
  products: Product[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

export function ProductFields({ initialProducts = [], products }: ProductFieldsProps) {
  const [rows, setRows] = useState<ProductRow[]>(
    initialProducts.map((p) => ({
      key: p.id,
      id: p.id,
      product_type: p.product_type,
      ratio: p.ratio ?? "",
      recovery_ratio: p.recovery_ratio ?? "",
      notes: p.notes ?? "",
    }))
  );

  const usedProducts = new Set(rows.map((r) => r.product_type).filter(Boolean));
  const availableProducts = products.filter((p) => p.active && !usedProducts.has(p.name));

  function addRow() {
    const next = availableProducts[0];
    if (!next) return;
    setRows((prev) => [
      ...prev,
      { key: crypto.randomUUID(), id: null, product_type: next.name, ratio: "", recovery_ratio: "", notes: "" },
    ]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function updateRow(key: string, patch: Partial<ProductRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        // A row's own current product stays selectable even though it's
        // "used" (and even if it's since been hidden) — only other
        // rows' active, unused choices are offered alongside it.
        const optionsForRow = products.filter(
          (p) => p.name === row.product_type || (p.active && !usedProducts.has(p.name))
        );

        return (
          <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.5fr_auto] sm:items-start">
            <input type="hidden" name="product_id" value={row.id ?? ""} />
            <select
              name="product_type_row"
              value={row.product_type}
              onChange={(e) => updateRow(row.key, { product_type: e.target.value as ProductType })}
              className={fieldClass}
            >
              <option value="" disabled className="bg-[#0a0e17]">
                Select…
              </option>
              {optionsForRow.map((product) => (
                <option key={product.id} value={product.name} className="bg-[#0a0e17]">
                  {product.name}
                </option>
              ))}
            </select>
            <input
              name="product_ratio"
              value={row.ratio}
              onChange={(e) => updateRow(row.key, { ratio: e.target.value })}
              placeholder='Ratio, e.g. "2%" or "70/30"'
              className={fieldClass}
            />
            <input
              name="product_recovery_ratio"
              value={row.recovery_ratio}
              onChange={(e) => updateRow(row.key, { recovery_ratio: e.target.value })}
              placeholder='Recovery ratio, e.g. "2%" or "70/30"'
              className={fieldClass}
            />
            <input
              name="product_notes"
              value={row.notes}
              onChange={(e) => updateRow(row.key, { notes: e.target.value })}
              placeholder="Notes"
              className={fieldClass}
            />
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              aria-label="Remove product"
              className="shrink-0 justify-self-start rounded-md p-2 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        disabled={availableProducts.length === 0}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Product
      </button>
    </div>
  );
}
