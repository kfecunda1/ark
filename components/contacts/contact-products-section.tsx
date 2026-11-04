"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { upsertContactProduct, deleteContactProduct } from "@/lib/actions/contacts";
import { PRODUCT_TYPES } from "@/lib/products";
import type { ContactProduct, ProductType } from "@/lib/types";

interface ContactProductsSectionProps {
  contactId: string;
  products: ContactProduct[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

interface RowProps {
  product: ContactProduct | null;
  productType: ProductType;
  availableProductTypes: ProductType[];
  disabled: boolean;
  onSave: (productType: ProductType, ratio: string, notes: string) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

function ProductRow({ product, productType, availableProductTypes, disabled, onSave, onDelete, onCancel }: RowProps) {
  const [selectedType, setSelectedType] = useState<ProductType>(productType);
  const [ratio, setRatio] = useState(product?.ratio ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as ProductType)}
          // An existing row's product is fixed — the options list below
          // only ever offers its own current value — so disabling here
          // too is just for clarity, not what actually prevents a change.
          disabled={disabled}
          className={fieldClass}
        >
          {(product ? [product.product_type] : availableProductTypes).map((p) => (
            <option key={p} value={p} className="bg-[#0a0e17]">
              {p}
            </option>
          ))}
        </select>
        <input
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          placeholder='Ratio, e.g. "2%" or "70/30"'
          disabled={disabled}
          className={fieldClass}
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          disabled={disabled}
          className={fieldClass}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave(selectedType, ratio, notes)}
          disabled={disabled}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Cancel
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function ContactProductsSection({ contactId, products }: ContactProductsSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const usedTypes = new Set(products.map((p) => p.product_type));
  const availableTypes = PRODUCT_TYPES.filter((p) => !usedTypes.has(p));

  function handleSave(productType: ProductType, ratio: string, notes: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await upsertContactProduct(contactId, productType, ratio, notes);
        if (result.error) {
          setError(result.error);
          return;
        }
        setAdding(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function handleDelete(productId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteContactProduct(contactId, productId);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {products.length === 0 && !adding && <p className="text-sm text-white/35">No products yet.</p>}

      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={product}
          productType={product.product_type}
          availableProductTypes={availableTypes}
          disabled={isPending}
          onSave={(productType, ratio, notes) => handleSave(productType, ratio, notes)}
          onDelete={() => handleDelete(product.id)}
        />
      ))}

      {adding && availableTypes.length > 0 && (
        <ProductRow
          product={null}
          productType={availableTypes[0]}
          availableProductTypes={availableTypes}
          disabled={isPending}
          onSave={(productType, ratio, notes) => handleSave(productType, ratio, notes)}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={availableTypes.length === 0}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Product
        </button>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
