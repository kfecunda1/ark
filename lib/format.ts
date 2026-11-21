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

// "2 h ago" style — the Inbox's "To file" cards (components/inbox/
// inbox-tabs.tsx) pair this with formatDateTime(value) as a title=
// tooltip for the full date. Computed from the caller's own clock
// (Date.now()), not a fixed timezone like the helpers above — a
// relative duration reads the same regardless of timezone, so there's
// nothing for this one to pin. Deliberately coarse (whole minutes/
// hours/days/weeks) rather than to-the-second, which both reads better
// and keeps the gap between a server-rendered value and the moment the
// client hydrates too small to ever visibly disagree.
export function relativeTime(value: string): string {
  const diffSec = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay} d ago`;
  const diffWeek = Math.round(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} w ago`;
  return formatDateTime(value);
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
