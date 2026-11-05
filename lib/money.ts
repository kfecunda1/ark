// Money formatting, shared by every place an amount is displayed
// (Total Face Value, tranches) or typed into a form field. Fixed
// "en-US" locale, same reasoning as lib/format.ts's date helpers: so
// the exact same text comes out of the server (SSR) and the browser.
import { LOCALE } from "@/lib/format";

/**
 * For display: "USD 10,000,000" or, with cents, "EUR 2,500,000.50".
 * Decimals are shown only when the amount actually has cents.
 * `amount == null` renders as "—"; pass no currency to format a bare
 * number (e.g. a CSV preview, which this app doesn't currently have,
 * or a context with no single currency to prefix).
 */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return "—";
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${currency} ${formatted}` : formatted;
}

/**
 * Adds thousands separators to a plain numeric string *while it's
 * still being typed* — unlike formatMoney above, this never rounds or
 * otherwise reshapes a value that's mid-edit, so a trailing "." or a
 * single typed decimal digit survives untouched.
 */
export function formatAmountForInput(plain: string): string {
  if (!plain) return "";
  const [intPart, decPart] = plain.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") || "0";
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

/**
 * Strips a typed or pasted amount down to a plain numeric string: only
 * digits and a single decimal point, capped at 2 fraction digits (cents)
 * and no leading zeros — so MoneyInput's onChange always hands callers
 * something `Number()` parses cleanly, regardless of commas, currency
 * symbols, or spaces in what was typed/pasted.
 */
export function parseAmountInput(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    const intPart = cleaned.slice(0, firstDot);
    const decPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    cleaned = `${intPart}.${decPart}`;
  }
  return cleaned.replace(/^0+(?=\d)/, "");
}

/**
 * Server-side counterpart to the above: parses a form field's raw text
 * (plain, comma-formatted, or pasted-with-commas — this is the actual
 * trust boundary, so it doesn't assume the client already cleaned it
 * up) into the number to store, or null when empty/invalid.
 */
export function parseMoneyFormValue(raw: string | undefined | null): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const num = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}
