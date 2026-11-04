// Fixed locale + timezone for every date/time string the app renders, so
// the exact same text comes out of the Node server (SSR) and the
// browser (hydration) no matter what locale or OS timezone either
// machine is actually set to.
//
// Locale alone isn't enough: `toLocaleString(locale, { ...date and time
// fields... })` lets Intl pick the connector between the date and time
// parts ("Nov 4, 2026 at 10:38 AM" vs "Nov 4, 2026, 10:38 AM"), and that
// connector pattern has changed between ICU/CLDR versions — so the same
// "en-US" locale can render differently on Node's bundled ICU vs a
// browser's, which is exactly the hydration mismatch this file exists to
// prevent. formatDateTime below sidesteps it by formatting the date part
// and time part separately and joining them with our own literal string,
// so there's no Intl-chosen connector left to disagree about.
export const LOCALE = "en-US";
export const TIME_ZONE = "America/Curacao";

export function truncate(value: string, maxLength = 140): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

// For a real instant in time (a timestamptz column — created_at,
// updated_at, last_activity_at, …). Renders as "Nov 4, 2026, 10:38 AM",
// always in the fixed timezone above, regardless of where it runs.
// "YYYY-MM-DD" for a real instant, as a calendar day *in the fixed
// timezone above* — not the runtime's own local timezone, which is what
// plain Date getters (getFullYear/getMonth/getDate) would use instead.
// en-CA is just a formatting trick (it happens to render as yyyy-mm-dd
// natively); the date it computes is still pinned by `timeZone`.
export function dateKeyInTimeZone(value: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  const datePart = date.toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timePart = date.toLocaleTimeString(LOCALE, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}
