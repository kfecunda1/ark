"use client";

import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { formatAmountForInput, parseAmountInput } from "@/lib/money";

type PassthroughProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange"
>;

interface MoneyInputProps extends PassthroughProps {
  // Uncontrolled: read once on mount (project-form's total_face_value,
  // which the form reads back out of FormData on submit — same pattern
  // as every other field on that form).
  defaultValue?: number | string | null;
  // Controlled: the parent owns the plain (comma-free) value and can
  // resync it — e.g. tranches-section.tsx putting the server's
  // confirmed amount back after a save.
  value?: string;
  onChange?: (plainValue: string) => void;
}

function countSignificant(text: string): number {
  return (text.match(/[0-9.]/g) ?? []).length;
}

// Where, in `text`, the `count`-th digit/decimal-point character ends —
// used to put the cursor back where the user was typing after the
// value is reformatted with new commas inserted or removed around it.
function positionAfterSignificant(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[0-9.]/.test(text[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return text.length;
}

/**
 * A text input that formats a money amount with thousands separators
 * while the user types (and on paste), but exposes/submits the plain
 * numeric value. Used for Total Face Value and tranche amounts.
 */
export function MoneyInput({ defaultValue, value, onChange, ...inputProps }: MoneyInputProps) {
  const toPlain = (v: number | string | null | undefined) => (v == null ? "" : String(v));
  const [plain, setPlain] = useState(() => toPlain(value !== undefined ? value : defaultValue));

  // Controlled mode: resync internal state when the parent's value
  // actually changes (not merely re-renders) — the same render-time
  // reset trick tranches-section.tsx uses for its own fields, so a
  // confirmed server value can replace in-progress local state without
  // an extra render pass.
  const [lastExternalValue, setLastExternalValue] = useState(value);
  if (value !== undefined && value !== lastExternalValue) {
    setLastExternalValue(value);
    setPlain(value);
  }

  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const cursor = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = countSignificant(input.value.slice(0, cursor));

    const nextPlain = parseAmountInput(input.value);
    const formatted = formatAmountForInput(nextPlain);

    // Mutate the DOM value directly so the cursor lands in the right
    // place synchronously — React's controlled `value` below will then
    // match what's already there, so it won't disturb the selection.
    input.value = formatted;
    const pos = positionAfterSignificant(formatted, digitsBeforeCursor);
    input.setSelectionRange(pos, pos);

    setPlain(nextPlain);
    onChange?.(nextPlain);
  }

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={formatAmountForInput(plain)}
      onChange={handleChange}
    />
  );
}
