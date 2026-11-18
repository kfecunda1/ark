"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Forward, Pause, Play, Trash2 } from "lucide-react";
import type { EntityOption } from "@/components/entity-picker";
import { FileIntoPanel } from "@/components/inbox/file-into-panel";
import { dismissInboxItem, deleteInboxItem } from "@/lib/actions/inbox";
import { getDocumentKind } from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import type { DocumentTypeRecord, InboxItem } from "@/lib/types";

interface InboxListProps {
  items: InboxItem[];
  senderNameById: Record<string, string>;
  projectOptions: EntityOption[];
  contactOptions: EntityOption[];
  projectNameById: Record<string, string>;
  contactNameById: Record<string, string>;
  signedUrlByPath: Record<string, string>;
  documentTypes: DocumentTypeRecord[];
}

const KIND_LABELS: Record<InboxItem["kind"], string> = {
  text: "Text",
  document: "Document",
  photo: "Photo",
  video: "Video",
};

function FilePreview({ item, signedUrl }: { item: InboxItem; signedUrl: string | null }) {
  const [playing, setPlaying] = useState(false);

  if (!item.storage_path) {
    if (item.kind === "text") return null;
    return (
      <p className="mt-1.5 text-xs text-amber-300">
        Too large for Telegram — upload it in ARK directly{item.file_name ? ` (${item.file_name})` : ""}.
      </p>
    );
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

function statusBadge(item: InboxItem, projectNameById: Record<string, string>, contactNameById: Record<string, string>) {
  if (item.status === "dismissed") {
    return (
      <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/45">
        Dismissed
      </span>
    );
  }
  if (item.status === "filed" && item.filed_to_type && item.filed_to_id) {
    const label =
      item.filed_to_type === "project"
        ? projectNameById[item.filed_to_id] ?? "Project"
        : contactNameById[item.filed_to_id] ?? "Receiver";
    const href = item.filed_to_type === "project" ? `/projects/${item.filed_to_id}` : `/receivers/${item.filed_to_id}`;
    return (
      <Link
        href={href}
        className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
      >
        Filed to {label}
      </Link>
    );
  }
  return null;
}

export function InboxList({
  items,
  senderNameById,
  projectOptions,
  contactOptions,
  projectNameById,
  contactNameById,
  signedUrlByPath,
  documentTypes,
}: InboxListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filingId, setFilingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (items.length === 0) {
    return <p className="text-sm text-white/35">Nothing in the Inbox yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {items.map((item) => {
        const senderName = item.profile_id ? senderNameById[item.profile_id] ?? "Unknown user" : "Unknown user";
        const signedUrl = item.storage_path ? signedUrlByPath[item.storage_path] ?? null : null;
        const badge = statusBadge(item, projectNameById, contactNameById);
        const hasFile = Boolean(item.storage_path);

        return (
          <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
                <span className="font-medium text-white/70">{senderName}</span>
                <span>{formatDateTime(item.received_at)}</span>
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
              {badge}
            </div>

            {item.text_or_caption && <p className="mt-2 text-sm whitespace-pre-wrap text-white/85">{item.text_or_caption}</p>}
            <FilePreview item={item} signedUrl={signedUrl} />

            <div className="mt-3 flex items-center gap-3">
              {item.status === "new" && (
                <>
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
                </>
              )}

              {confirmingDeleteId === item.id ? (
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-amber-300">Delete this item?</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
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
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDeleteId(item.id)}
                  aria-label="Delete item"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-300 transition-colors duration-150 ease-out hover:text-rose-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>

            {filingId === item.id && (
              <div className="mt-3">
                <FileIntoPanel
                  itemId={item.id}
                  hasFile={hasFile}
                  projectOptions={projectOptions}
                  contactOptions={contactOptions}
                  documentTypes={documentTypes}
                  onFiled={() => {
                    setFilingId(null);
                    router.refresh();
                  }}
                  onCancel={() => setFilingId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
