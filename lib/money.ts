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

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
// Short scale (thousand, million, billion, trillion) — index == how
// many groups-of-3 the digits are shifted left by.
const SCALES = ["", "thousand", "million", "billion", "trillion"];

const CURRENCY_WORDS: Record<string, { singular: string; plural: string }> = {
  USD: { singular: "US dollar", plural: "US dollars" },
  EUR: { singular: "euro", plural: "euros" },
};

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
    }
  }
  return parts.join(" ");
}

function integerToWords(n: number): string {
  if (n === 0) return "zero";
  const groups: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const scale = SCALES[i];
    parts.push(scale ? `${threeDigitsToWords(groups[i])} ${scale}` : threeDigitsToWords(groups[i]));
  }
  return parts.join(" ");
}

/**
 * Spells out a money amount in English, short scale, e.g.
 * amountInWords(10000000, "USD") -> "Ten million US dollars"
 * amountInWords(2500000.5, "EUR") -> "Two million five hundred thousand euros and fifty cents"
 *
 * Test cases (integer dollars/cents only — this doesn't round further
 * than the 2 decimals money already has):
 *   amountInWords(0, "USD")           -> "Zero US dollars"
 *   amountInWords(1, "USD")           -> "One US dollar"
 *   amountInWords(15, "USD")          -> "Fifteen US dollars"
 *   amountInWords(100, "USD")         -> "One hundred US dollars"
 *   amountInWords(1001, "USD")        -> "One thousand one US dollars"
 *   amountInWords(10000000, "USD")    -> "Ten million US dollars"
 *   amountInWords(2500000.5, "EUR")   -> "Two million five hundred thousand euros and fifty cents"
 *   amountInWords(1000000000, "USD")  -> "One billion US dollars"
 *
 * Returns "" for null/undefined/negative/non-finite amounts, or a
 * currency with no known words — callers use that to render nothing.
 */
export function amountInWords(amount: number | null | undefined, currency: string): string {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return "";
  const words = CURRENCY_WORDS[currency];
  if (!words) return "";

  const rounded = Math.round(amount * 100) / 100;
  const dollars = Math.floor(rounded);
  const cents = Math.round((rounded - dollars) * 100);

  let result = `${integerToWords(dollars)} ${dollars === 1 ? words.singular : words.plural}`;
  if (cents > 0) {
    result += ` and ${integerToWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
  }

  return result.charAt(0).toUpperCase() + result.slice(1);
}
