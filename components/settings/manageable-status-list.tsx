"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import { moveCatalogItem, setCatalogItemActive } from "@/lib/actions/catalog";
import { addStatus, updateStatus } from "@/lib/actions/statuses";
import { STATUS_DOT_COLORS } from "@/components/projects/badges";
import type { StatusColor, StatusRecord } from "@/lib/types";

interface ManageableStatusListProps {
  statuses: StatusRecord[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

const KINDS: { value: "open" | "completed" | "lost"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" },
  { value: "lost", label: "Lost" },
];

const COLORS: StatusColor[] = ["accent", "cyan", "teal", "silver", "sky", "emerald", "amber", "rose"];

function ColorSelect({ value, onChange }: { value: StatusColor; onChange: (color: StatusColor) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as StatusColor)} className={selectClass}>
      {COLORS.map((color) => (
        <option key={color} value={color} className="bg-[#0a0e17]">
          {color}
        </option>
      ))}
    </select>
  );
}

// Settings → Statuses (admin only) — Add, rename, choose kind and
// color, hide/show, reorder. Same add/hide/reorder shape as
// components/settings/manageable-list.tsx (products/document types),
// but with two extra fields (kind, color) neither of those has, so
// this is its own component rather than ManageableList with optional
// props bolted on.
export function ManageableStatusList({ statuses }: ManageableStatusListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"open" | "completed" | "lost">("open");
  const [newColor, setNewColor] = useState<StatusColor>("accent");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingKind, setEditingKind] = useState<"open" | "completed" | "lost">("open");
  const [editingColor, setEditingColor] = useState<StatusColor>("accent");

  const sorted = [...statuses].sort((a, b) => a.sort_order - b.sort_order);

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addStatus(trimmed, newKind, newColor);
        if (result.error) {
          setError(result.error);
          return;
        }
        setNewName("");
        setNewKind("open");
        setNewColor("accent");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function startEditing(status: StatusRecord) {
    setEditingId(status.id);
    setEditingName(status.name);
    setEditingKind(status.kind);
    setEditingColor(status.color);
    setError(null);
  }

  function handleSaveEdit() {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) return;
    const id = editingId;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await updateStatus(id, trimmed, editingKind, editingColor);
        if (result.error) {
          setError(result.error);
          return;
        }
        setEditingId(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleToggleActive(status: StatusRecord) {
    setError(null);
    setBusyId(status.id);
    startTransition(async () => {
      try {
        const result = await setCatalogItemActive("statuses", status.id, !status.active);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleMove(status: StatusRecord, direction: "up" | "down") {
    setError(null);
    setBusyId(status.id);
    startTransition(async () => {
      try {
        const result = await moveCatalogItem("statuses", sorted, status.id, direction);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.length === 0 && <p className="text-sm text-white/35">No statuses yet.</p>}

      {sorted.map((status, index) => (
        <div
          key={status.id}
          className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 ${
            status.active ? "" : "opacity-50"
          }`}
        >
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => handleMove(status, "up")}
              disabled={index === 0 || isPending}
              aria-label={`Move ${status.name} up`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleMove(status, "down")}
              disabled={index === sorted.length - 1 || isPending}
              aria-label={`Move ${status.name} down`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {editingId === status.id ? (
            <>
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className={`${fieldClass} min-w-[8rem] flex-1`}
                autoFocus
              />
              <select
                value={editingKind}
                onChange={(e) => setEditingKind(e.target.value as "open" | "completed" | "lost")}
                className={selectClass}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value} className="bg-[#0a0e17]">
                    {k.label}
                  </option>
                ))}
              </select>
              <ColorSelect value={editingColor} onChange={setEditingColor} />
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isPending && busyId === status.id}
                aria-label="Save"
                className="rounded-md p-1.5 text-emerald-300 transition-colors duration-150 ease-out hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                disabled={isPending}
                aria-label="Cancel"
                className="rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_COLORS[status.color]}`} />
              <span className="min-w-[6rem] flex-1 text-sm text-white/85">{status.name}</span>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50 capitalize">
                {status.kind}
              </span>
              {!status.active && (
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                  Hidden
                </span>
              )}
              <button
                type="button"
                onClick={() => startEditing(status)}
                aria-label={`Edit ${status.name}`}
                className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleActive(status)}
                disabled={isPending && busyId === status.id}
                className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.active ? "Hide" : "Show"}
              </button>
            </>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a status…"
          className={`${fieldClass} min-w-[8rem] flex-1`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as "open" | "completed" | "lost")}
          className={selectClass}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value} className="bg-[#0a0e17]">
              {k.label}
            </option>
          ))}
        </select>
        <ColorSelect value={newColor} onChange={setNewColor} />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending || !newName.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
    </div>
  );
}
