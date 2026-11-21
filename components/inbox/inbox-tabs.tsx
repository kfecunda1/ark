"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  FileText,
  Forward,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { EntityOption } from "@/components/entity-picker";
import { FileIntoPanel, type FileIntoDestination } from "@/components/inbox/file-into-panel";
import { BulkFilePanel } from "@/components/inbox/bulk-file-panel";
import { dismissInboxItem, deleteInboxItem, renameInboxItem } from "@/lib/actions/inbox";
import { getDocumentKind } from "@/lib/storage";
import { isTooLargeForTelegram } from "@/lib/inbox";
import { formatDateTime, relativeTime, truncate } from "@/lib/format";
import type { DocumentTypeRecord, InboxItem } from "@/lib/types";

interface InboxTabsProps {
  items: InboxItem[];
  userNameById: Record<string, string>;
  projectOptions: EntityOption[];
  contactOptions: EntityOption[];
  projectNameById: Record<string, string>;
  contactNameById: Record<string, string>;
  signedUrlByPath: Record<string, string>;
  documentTypes: DocumentTypeRecord[];
  filedOpenUrlByItemId: Record<string, string>;
  filedTrancheNumberByItemId: Record<string, number>;
  isAdmin: boolean;
  suggestionsByItemId: Record<string, FileIntoDestination[]>;
  suggestedDocTypeByItemId: Record<string, string>;
}

type Tab = "to_file" | "filed" | "dismissed";

const KIND_LABELS: Record<InboxItem["kind"], string> = {
  text: "Text",
  document: "Document",
  photo: "Photo",
  video: "Video",
};

// A filed item's own "title" for the Filed/Dismissed lists — its file
// name, or (filed as a Note) a snippet of the text it was.
function itemLabel(item: InboxItem): string {
  if (item.file_name) return item.file_name;
  if (item.text_or_caption) return truncate(item.text_or_caption, 60);
  return "(no content)";
}

function destinationLabel(
  item: InboxItem,
  projectNameById: Record<string, string>,
  contactNameById: Record<string, string>,
  trancheNumber: number | undefined
): { label: string; href: string } | null {
  if (!item.filed_to_type || !item.filed_to_id) return null;
  if (item.filed_to_type === "project") {
    const name = projectNameById[item.filed_to_id] ?? "Project";
    return {
      label: trancheNumber != null ? `${name} · Tranche ${trancheNumber}` : name,
      href: `/projects/${item.filed_to_id}`,
    };
  }
  const name = contactNameById[item.filed_to_id] ?? "Receiver";
  return { label: name, href: `/receivers/${item.filed_to_id}` };
}

function FilePreview({ item, signedUrl }: { item: InboxItem; signedUrl: string | null }) {
  const [playing, setPlaying] = useState(false);

  if (isTooLargeForTelegram(item)) {
    return (
      <p className="mt-1.5 text-xs text-amber-300">
        Too large for Telegram — upload it in ARK directly{item.file_name ? ` (${item.file_name})` : ""}.
      </p>
    );
  }

  if (!item.storage_path) {
    // Not too large, but no file either — either a plain text message
    // (nothing to preview, expected) or a genuine download failure
    // (rare; say so rather than showing nothing).
    if (item.kind === "text") return null;
    return <p className="mt-1.5 text-xs text-white/35">File unavailable.</p>;
  }

  const kind = getDocumentKind(item.file_name ?? "");
  if (kind === "image" && signedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={signedUrl} alt="" className="mt-2 h-24 w-24 rounded-lg object-cover" />
    );
  }
  if (kind === "video" && signedUrl) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Hide" : "Play"} video
        </button>
        {playing && <video controls autoPlay src={signedUrl} className="mt-2 max-h-72 w-full rounded-lg bg-black" />}
      </div>
    );
  }
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/50">
      <FileText className="h-3.5 w-3.5" />
      {item.file_name}
      {signedUrl && (
        <a
          href={signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent-soft hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          View
        </a>
      )}
    </p>
  );
}

const TABS: { value: Tab; label: string }[] = [
  { value: "to_file", label: "To file" },
  { value: "filed", label: "Filed" },
  { value: "dismissed", label: "Dismissed" },
];

export function InboxTabs({
  items,
  userNameById,
  projectOptions,
  contactOptions,
  projectNameById,
  contactNameById,
  signedUrlByPath,
  documentTypes,
  filedOpenUrlByItemId,
  filedTrancheNumberByItemId,
  isAdmin,
  suggestionsByItemId,
  suggestedDocTypeByItemId,
}: InboxTabsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("to_file");
  const [filingId, setFilingId] = useState<string | null>(null);
  const [prefillByItemId, setPrefillByItemId] = useState<Record<string, FileIntoDestination>>({});
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filedConfirmation, setFiledConfirmation] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Bulk selection — "to_file" tab only (see toggleSelectAll/toggleSelected
  // below and the bulk bar rendered above the item list).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFiling, setBulkFiling] = useState(false);
  const [bulkDismissConfirm, setBulkDismissConfirm] = useState(false);
  const [isBulkDismissing, setIsBulkDismissing] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Auto-dismiss the "Filed to …" confirmation after a few seconds
  // rather than leaving it sitting there indefinitely.
  useEffect(() => {
    if (!filedConfirmation) return;
    const timeout = setTimeout(() => setFiledConfirmation(null), 5000);
    return () => clearTimeout(timeout);
  }, [filedConfirmation]);

  const toFileItems = items.filter((i) => i.status === "new");
  // Newest *filed* first — distinct from received_at (when the
  // Telegram message arrived), which is all the base query orders by.
  const filedItems = items
    .filter((i) => i.status === "filed")
    .sort((a, b) => (b.filed_at ?? "").localeCompare(a.filed_at ?? ""));
  const dismissedItems = items.filter((i) => i.status === "dismissed");

  // Filtering against the *current* toFileItems (not the raw id set)
  // means a selection surviving a single-item file/dismiss elsewhere
  // just quietly drops that item instead of pointing at a stale row.
  const selectedItems = toFileItems.filter((i) => selectedIds.has(i.id));

  function toggleSelected(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = toFileItems.length > 0 && toFileItems.every((i) => prev.has(i.id));
      return allSelected ? new Set() : new Set(toFileItems.map((i) => i.id));
    });
  }

  async function handleBulkDismiss() {
    setBulkError(null);
    setIsBulkDismissing(true);
    const targets = selectedItems;
    const failures: string[] = [];
    for (const item of targets) {
      const result = await dismissInboxItem(item.id, true);
      if (result.error) {
        failures.push(`${itemLabel(item)}: ${result.error}`);
      }
    }
    setIsBulkDismissing(false);
    setBulkDismissConfirm(false);
    setSelectedIds(new Set());
    if (failures.length > 0) {
      setBulkError(`${failures.length} item(s) failed to dismiss:\n${failures.join("\n")}`);
    }
    router.refresh();
  }

  function removeFromBulkSelection(itemId: string) {
    const next = new Set(selectedIds);
    next.delete(itemId);
    setSelectedIds(next);
    if (next.size === 0) setBulkFiling(false);
  }

  function openSuggestion(itemId: string, suggestion: FileIntoDestination) {
    setPrefillByItemId((prev) => ({ ...prev, [itemId]: suggestion }));
    setFilingId(itemId);
  }

  const searchLower = search.trim().toLowerCase();
  const filteredFiledItems =
    searchLower === ""
      ? filedItems
      : filedItems.filter((item) => {
          const dest = destinationLabel(item, projectNameById, contactNameById, filedTrancheNumberByItemId[item.id]);
          return (
            itemLabel(item).toLowerCase().includes(searchLower) ||
            (dest?.label.toLowerCase().includes(searchLower) ?? false)
          );
        });

  function handleDismiss(itemId: string, dismissed: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await dismissInboxItem(itemId, dismissed);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(itemId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteInboxItem(itemId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmingDeleteId(null);
      router.refresh();
    });
  }

  function handleFiled(destination: string) {
    setFilingId(null);
    setFiledConfirmation(`Filed to ${destination}`);
    router.refresh();
  }

  function DeleteButton({ itemId }: { itemId: string }) {
    if (confirmingDeleteId === itemId) {
      return (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-amber-300">Delete?</span>
          <button
            type="button"
            onClick={() => handleDelete(itemId)}
            disabled={isPending}
            className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Deleting…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDeleteId(null)}
            disabled={isPending}
            className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
          >
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setConfirmingDeleteId(itemId)}
        aria-label="Delete item"
        className="inline-flex items-center gap-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:text-rose-200"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    );
  }

  // A "To file" item's inline rename, before it's filed — same
  // "display name only, extension preserved" rule as the Documents
  // sections' own rename (components/projects/project-documents.tsx,
  // components/receivers/receiver-documents.tsx), via lib/storage.ts's
  // withPreservedExtension (applied server-side in renameInboxItem).
  // Never activity-logged — see that action's own comment.
  function RenameControl({ item }: { item: InboxItem }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(item.file_name ?? "");
    const [isSaving, setIsSaving] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    if (!item.file_name) return null;

    async function save() {
      setLocalError(null);
      setIsSaving(true);
      try {
        const result = await renameInboxItem(item.id, value);
        if (result.error) {
          setLocalError(result.error);
          return;
        }
        setEditing(false);
        router.refresh();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setIsSaving(false);
      }
    }

    if (!editing) {
      return (
        <button
          type="button"
          onClick={() => {
            setValue(item.file_name ?? "");
            setLocalError(null);
            setEditing(true);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </button>
      );
    }

    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isSaving}
          className="min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          aria-label="Save name"
          className="inline-flex items-center rounded-md bg-accent px-1.5 py-1 text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={isSaving}
          aria-label="Cancel rename"
          className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-1 text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {localError && <span className="text-xs text-rose-300">{localError}</span>}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
        {TABS.map((t) => {
          const count = t.value === "to_file" ? toFileItems.length : t.value === "filed" ? filedItems.length : dismissedItems.length;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setTab(t.value);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
                tab === t.value ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {tab === "to_file" && (
        <div className="flex flex-col gap-3">
          {filedConfirmation && (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {filedConfirmation}
            </p>
          )}

          {toFileItems.length > 0 && (
            <label className="flex w-fit items-center gap-2 text-xs font-medium text-white/50">
              <input
                type="checkbox"
                checked={toFileItems.length > 0 && selectedItems.length === toFileItems.length}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.04] accent-accent"
              />
              Select all
            </label>
          )}

          {bulkError && <p className="whitespace-pre-wrap text-xs text-rose-300">{bulkError}</p>}

          {selectedItems.length > 0 &&
            (bulkFiling ? (
              <BulkFilePanel
                items={selectedItems}
                projectOptions={projectOptions}
                contactOptions={contactOptions}
                documentTypes={documentTypes}
                onRemoveItem={removeFromBulkSelection}
                onDone={() => {
                  setBulkFiling(false);
                  setSelectedIds(new Set());
                }}
                onCancel={() => setBulkFiling(false)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/25 bg-accent/10 px-3.5 py-2.5">
                <span className="text-xs font-medium text-white/80">{selectedItems.length} selected</span>
                <button
                  type="button"
                  onClick={() => setBulkFiling(true)}
                  className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
                >
                  File {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"} into…
                </button>
                {bulkDismissConfirm ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs text-amber-300">Dismiss {selectedItems.length}?</span>
                    <button
                      type="button"
                      onClick={handleBulkDismiss}
                      disabled={isBulkDismissing}
                      className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBulkDismissing ? "Dismissing…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkDismissConfirm(false)}
                      disabled={isBulkDismissing}
                      className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBulkDismissConfirm(true)}
                    className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                  >
                    Dismiss {selectedItems.length}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-auto text-xs font-medium text-white/40 transition-colors duration-150 ease-out hover:text-white/70"
                >
                  Clear selection
                </button>
              </div>
            ))}

          {toFileItems.length === 0 ? (
            <p className="text-sm text-white/35">Nothing to file.</p>
          ) : (
            toFileItems.map((item) => {
              const senderName = item.profile_id ? userNameById[item.profile_id] ?? "Unknown user" : "Unknown user";
              const signedUrl = item.storage_path ? signedUrlByPath[item.storage_path] ?? null : null;
              const suggestions = suggestionsByItemId[item.id] ?? [];
              const prefill = prefillByItemId[item.id] ?? null;

              return (
                <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        aria-label="Select item"
                        className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.04] accent-accent"
                      />
                      <span className="font-medium text-white/70">{senderName}</span>
                      <span title={formatDateTime(item.received_at)}>{relativeTime(item.received_at)}</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/50">
                        {KIND_LABELS[item.kind]}
                      </span>
                      {item.forwarded_from && (
                        <span className="inline-flex items-center gap-1">
                          <Forward className="h-3 w-3" />
                          Forwarded from {item.forwarded_from}
                        </span>
                      )}
                    </div>
                  </div>

                  {item.text_or_caption && (
                    <p className="mt-2 text-sm whitespace-pre-wrap text-white/85">{item.text_or_caption}</p>
                  )}
                  <FilePreview item={item} signedUrl={signedUrl} />

                  {suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {suggestions.map((s) => (
                        <button
                          key={`${s.type}-${s.id}`}
                          type="button"
                          onClick={() => openSuggestion(item.id, s)}
                          className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-soft transition-colors duration-150 ease-out hover:bg-accent/20"
                        >
                          Suggested: {s.label} — File here
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setFilingId(filingId === item.id ? null : item.id)}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
                    >
                      {filingId === item.id ? "Close" : "File into…"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismiss(item.id, true)}
                      disabled={isPending}
                      className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                    <RenameControl item={item} />
                    <span className="ml-auto">
                      <DeleteButton itemId={item.id} />
                    </span>
                  </div>

                  {filingId === item.id && (
                    <div className="mt-3">
                      <FileIntoPanel
                        key={`${item.id}-${prefill?.type ?? "none"}-${prefill?.id ?? "none"}`}
                        itemId={item.id}
                        hasFile={Boolean(item.storage_path)}
                        projectOptions={projectOptions}
                        contactOptions={contactOptions}
                        documentTypes={documentTypes}
                        initialDestination={prefill}
                        initialDocumentType={suggestedDocTypeByItemId[item.id] ?? null}
                        onFiled={handleFiled}
                        onCancel={() => setFilingId(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "filed" && (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by file name or destination…"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-9 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40"
            />
          </div>

          {filteredFiledItems.length === 0 ? (
            <p className="text-sm text-white/35">
              {filedItems.length === 0 ? "Nothing filed yet." : "No filed items match that search."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredFiledItems.map((item) => {
                const dest = destinationLabel(item, projectNameById, contactNameById, filedTrancheNumberByItemId[item.id]);
                const openUrl = filedOpenUrlByItemId[item.id];
                const filedByName = item.filed_by ? userNameById[item.filed_by] ?? "Unknown user" : "Unknown user";
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-white/80">{itemLabel(item)}</span>
                    {dest ? (
                      <Link href={dest.href} className="shrink-0 text-xs text-accent-soft hover:underline">
                        {dest.label}
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-white/35">—</span>
                    )}
                    <span className="shrink-0 text-xs text-white/40">by {filedByName}</span>
                    <span className="shrink-0 text-xs text-white/40">
                      {item.filed_at ? formatDateTime(item.filed_at) : "—"}
                    </span>
                    {openUrl ? (
                      <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-soft hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-white/35">—</span>
                    )}
                    {isAdmin && (
                      <span className="ml-auto shrink-0">
                        <DeleteButton itemId={item.id} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "dismissed" && (
        <div className="flex flex-col gap-2">
          {dismissedItems.length === 0 ? (
            <p className="text-sm text-white/35">Nothing dismissed.</p>
          ) : (
            dismissedItems.map((item) => {
              const senderName = item.profile_id ? userNameById[item.profile_id] ?? "Unknown user" : "Unknown user";
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-white/80">{itemLabel(item)}</span>
                  <span className="shrink-0 text-xs text-white/40">from {senderName}</span>
                  <span className="shrink-0 text-xs text-white/40">{formatDateTime(item.received_at)}</span>
                  <button
                    type="button"
                    onClick={() => handleDismiss(item.id, false)}
                    disabled={isPending}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-white/60 transition-colors duration-150 ease-out hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore to To file
                  </button>
                  <span className="shrink-0">
                    <DeleteButton itemId={item.id} />
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
