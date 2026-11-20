"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import { moveCatalogItem, setCatalogItemActive } from "@/lib/actions/catalog";
import { addPayoutGroup, updatePayoutGroup } from "@/lib/actions/payout-groups";
import type { PayoutGroup } from "@/lib/types";

interface ManageablePayoutGroupListProps {
  groups: PayoutGroup[];
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const shareFieldClass =
  "w-20 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// Settings → Groups (admin only) — add, rename, set default share %,
// hide/show, reorder. Same add/hide/reorder shape as ManageableList
// (products/document types) and ManageableStatusList, but with its own
// numeric field (default_share_pct) neither of those has.
export function ManageablePayoutGroupList({ groups }: ManageablePayoutGroupListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newShare, setNewShare] = useState("20");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingShare, setEditingShare] = useState("");

  const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const activeDefaultTotal = sorted.filter((g) => g.active).reduce((sum, g) => sum + g.default_share_pct, 0);
  const totalIsOff = Math.round(activeDefaultTotal * 100) !== 10000;

  function handleAdd() {
    const trimmed = newName.trim();
    const share = Number(newShare);
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addPayoutGroup(trimmed, share);
        if (result.error) {
          setError(result.error);
          return;
        }
        setNewName("");
        setNewShare("20");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function startEditing(group: PayoutGroup) {
    setEditingId(group.id);
    setEditingName(group.name);
    setEditingShare(String(group.default_share_pct));
    setError(null);
  }

  function handleSaveEdit() {
    if (!editingId) return;
    const trimmed = editingName.trim();
    const share = Number(editingShare);
    if (!trimmed) return;
    const id = editingId;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await updatePayoutGroup(id, trimmed, share);
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

  function handleToggleActive(group: PayoutGroup) {
    setError(null);
    setBusyId(group.id);
    startTransition(async () => {
      try {
        const result = await setCatalogItemActive("payout_groups", group.id, !group.active);
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

  function handleMove(group: PayoutGroup, direction: "up" | "down") {
    setError(null);
    setBusyId(group.id);
    startTransition(async () => {
      try {
        const result = await moveCatalogItem("payout_groups", sorted, group.id, direction);
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
      {totalIsOff && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Visible groups&apos; default shares total {activeDefaultTotal}%, not 100% — a new split pre-filled from
          these won&apos;t add up either.
        </p>
      )}

      {sorted.length === 0 && <p className="text-sm text-white/35">No groups yet.</p>}

      {sorted.map((group, index) => (
        <div
          key={group.id}
          className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 ${
            group.active ? "" : "opacity-50"
          }`}
        >
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => handleMove(group, "up")}
              disabled={index === 0 || isPending}
              aria-label={`Move ${group.name} up`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleMove(group, "down")}
              disabled={index === sorted.length - 1 || isPending}
              aria-label={`Move ${group.name} down`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {editingId === group.id ? (
            <>
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className={`${fieldClass} min-w-[8rem] flex-1`}
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={editingShare}
                  onChange={(e) => setEditingShare(e.target.value)}
                  className={shareFieldClass}
                />
                <span className="text-sm text-white/40">%</span>
              </div>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isPending && busyId === group.id}
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
              <span className="min-w-[6rem] flex-1 text-sm text-white/85">{group.name}</span>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50">
                {group.default_share_pct}% default
              </span>
              {!group.active && (
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                  Hidden
                </span>
              )}
              <button
                type="button"
                onClick={() => startEditing(group)}
                aria-label={`Edit ${group.name}`}
                className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleActive(group)}
                disabled={isPending && busyId === group.id}
                className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {group.active ? "Hide" : "Show"}
              </button>
            </>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a group…"
          className={`${fieldClass} min-w-[8rem] flex-1`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={newShare}
            onChange={(e) => setNewShare(e.target.value)}
            className={shareFieldClass}
          />
          <span className="text-sm text-white/40">%</span>
        </div>
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
