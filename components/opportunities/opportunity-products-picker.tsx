"use client";

import { Plus, X } from "lucide-react";
import { getDictionary, type Lang } from "@/lib/i18n";
import type { Product } from "@/lib/types";

const MAX_OPTIONS = 3;

interface OpportunityProductsPickerProps {
  // All products (not just active) — an option an opportunity already
  // has must keep showing even if it's since been hidden, same as
  // components/projects/product-options-picker.tsx.
  products: Product[];
  value: string[];
  onChange: (value: string[]) => void;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// The create/edit form's 0-3 product picker — unlike components/
// projects/product-options-picker.tsx (projects require 1-3), an
// opportunity is allowed to carry no product guess at all yet, so a
// row can always be removed down to zero and none is `required`.
export function OpportunityProductsPicker({ products, value, onChange, lang = "en" }: OpportunityProductsPickerProps) {
  const t = getDictionary(lang);
  const used = new Set(value.filter(Boolean));
  const available = products.filter((p) => p.active && !used.has(p.name));

  function updateRow(index: number, product: string) {
    const next = [...value];
    next[index] = product;
    onChange(next);
  }

  function addRow() {
    const next = available[0];
    if (!next || value.length >= MAX_OPTIONS) return;
    onChange([...value, next.name]);
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.map((selected, index) => {
        const optionsForRow = products.filter((p) => p.name === selected || (p.active && !used.has(p.name)));

        return (
          <div key={index} className="flex items-center gap-2">
            <select
              name="product_options"
              value={selected}
              onChange={(e) => updateRow(index, e.target.value)}
              className={fieldClass}
            >
              <option value="" disabled className="bg-[#0a0e17]">
                {t.productOptions.select}
              </option>
              {optionsForRow.map((product) => (
                <option key={product.id} value={product.name} className="bg-[#0a0e17]">
                  {product.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeRow(index)}
              aria-label={t.productOptions.removeOption}
              className="shrink-0 rounded-md p-2 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      {value.length < MAX_OPTIONS && (
        <button
          type="button"
          onClick={addRow}
          disabled={available.length === 0}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.productOptions.addProduct}
        </button>
      )}
    </div>
  );
}
