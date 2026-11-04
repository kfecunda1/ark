import type { ProcedureSource, ProcedureStatus } from "@/lib/types";

export const SOURCES: ProcedureSource[] = ["whatsapp", "telegram", "document", "link"];
export const STATUSES: ProcedureStatus[] = ["unmatched", "matched", "archived"];

export const SOURCE_LABELS: Record<ProcedureSource, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  document: "Document",
  link: "Link",
};

export const STATUS_LABELS: Record<ProcedureStatus, string> = {
  unmatched: "Unmatched",
  matched: "Matched",
  archived: "Archived",
};

export function truncate(value: string, maxLength = 140): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
