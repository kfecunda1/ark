"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import {
  addCatalogItem,
  moveCatalogItem,
  renameCatalogItem,
  setCatalogItemActive,
  type CatalogTable,
} from "@/lib/actions/catalog";

interface CatalogItem {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

interface ManageableListProps {
  table: CatalogTable;
  items: CatalogItem[];
  itemLabel: string;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// Shared by the Settings page's Products and Document Types sections —
// both tables are the same shape (name/active/sort_order), so this is
// one admin list UI with Add, Rename, Hide/Show, and Up/Down reorder,
// parameterized by which table to write to.
export function ManageableList({ table, items, itemLabel }: ManageableListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addCatalogItem(table, trimmed);
        if (result.error) {
          setError(result.error);
          return;
        }
        setNewName("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function startEditing(item: CatalogItem) {
    setEditingId(item.id);
    setEditingName(item.name);
    setError(null);
  }

  function handleRename() {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) return;
    const id = editingId;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await renameCatalogItem(table, id, trimmed);
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

  function handleToggleActive(item: CatalogItem) {
    setError(null);
    setBusyId(item.id);
    startTransition(async () => {
      try {
        const result = await setCatalogItemActive(table, item.id, !item.active);
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

  function handleMove(item: CatalogItem, direction: "up" | "down") {
    setError(null);
    setBusyId(item.id);
    startTransition(async () => {
      try {
        const result = await moveCatalogItem(table, sorted, item.id, direction);
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
      {sorted.length === 0 && <p className="text-sm text-white/35">No {itemLabel}s yet.</p>}

      {sorted.map((item, index) => (
        <div
          key={item.id}
          className={`flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 ${
            item.active ? "" : "opacity-50"
          }`}
        >
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => handleMove(item, "up")}
              disabled={index === 0 || isPending}
              aria-label={`Move ${item.name} up`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleMove(item, "down")}
              disabled={index === sorted.length - 1 || isPending}
              aria-label={`Move ${item.name} down`}
              className="rounded p-0.5 text-white/40 transition-colors duration-150 ease-out hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {editingId === item.id ? (
            <>
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className={`${fieldClass} flex-1`}
                autoFocus
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={isPending && busyId === item.id}
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
              <span className="flex-1 text-sm text-white/85">{item.name}</span>
              {!item.active && (
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                  Hidden
                </span>
              )}
              <button
                type="button"
                onClick={() => startEditing(item)}
                aria-label={`Rename ${item.name}`}
                className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white/80"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleActive(item)}
                disabled={isPending && busyId === item.id}
                className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.active ? "Hide" : "Show"}
              </button>
            </>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`Add a ${itemLabel}…`}
          className={`${fieldClass} flex-1`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
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
