"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ManageableList } from "@/components/settings/manageable-list";
import { addDocumentTypeGroupMember, removeDocumentTypeGroupMember } from "@/lib/actions/document-type-groups";
import { catalogLabel, getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { DocumentTypeGroupRecord, DocumentTypeRecord } from "@/lib/types";

interface DocumentTypeGroupsManagerProps {
  groups: DocumentTypeGroupRecord[];
  documentTypes: DocumentTypeRecord[];
  membersByGroup: Map<string, string[]>;
  lang?: Lang;
}

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-xs text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

// One group's own member chips + "add a member" control — rendered by
// ManageableList's renderExtra below each document_type_groups row, so
// create/rename/hide (shared with Products/Document Types) and member
// management (unique to groups) live in the same expandable row
// instead of two disconnected UIs.
function GroupMembers({
  group,
  documentTypes,
  members,
  lang,
}: {
  group: DocumentTypeGroupRecord;
  documentTypes: DocumentTypeRecord[];
  members: string[];
  lang: Lang;
}) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [isPending, startTransition] = useTransition();
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [addValue, setAddValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const availableTypes = documentTypes.filter((dt) => !members.includes(dt.name));

  function handleAdd() {
    if (!addValue) return;
    const type = addValue;
    setError(null);
    setPendingType(type);
    startTransition(async () => {
      try {
        const result = await addDocumentTypeGroupMember(group.id, type);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        setAddValue("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingType(null);
      }
    });
  }

  function handleRemove(type: string) {
    setError(null);
    setPendingType(type);
    startTransition(async () => {
      try {
        const result = await removeDocumentTypeGroupMember(group.id, type);
        if (result.error) {
          setError(resolveError(result.error, lang));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
      } finally {
        setPendingType(null);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 pl-7">
      {members.length === 0 && <span className="text-xs text-white/30">{t.documentChecklist.noMembersYet}</span>}
      {members.map((type) => {
        const record = documentTypes.find((dt) => dt.name === type);
        return (
          <span
            key={type}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70"
          >
            {record ? catalogLabel(record, lang) : type}
            <button
              type="button"
              onClick={() => handleRemove(type)}
              disabled={isPending && pendingType === type}
              aria-label={t.documentChecklist.removeMemberAria(type)}
              className="text-white/40 transition-colors duration-150 ease-out hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {availableTypes.length > 0 && (
        <select
          value={addValue}
          disabled={isPending}
          onChange={(e) => {
            setAddValue(e.target.value);
            if (e.target.value) handleAdd();
          }}
          className={selectClass}
        >
          <option value="" className="bg-[#0a0e17]">
            {t.documentChecklist.addMemberPlaceholder}
          </option>
          {availableTypes.map((dt) => (
            <option key={dt.id} value={dt.name} className="bg-[#0a0e17]">
              {catalogLabel(dt, lang)}
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}

export function DocumentTypeGroupsManager({ groups, documentTypes, membersByGroup, lang = "en" }: DocumentTypeGroupsManagerProps) {
  return (
    <ManageableList
      table="document_type_groups"
      items={groups}
      itemLabel="document group"
      withSpanishName
      lang={lang}
      renderExtra={(item) => {
        const group = groups.find((g) => g.id === item.id);
        if (!group) return null;
        return (
          <GroupMembers
            group={group}
            documentTypes={documentTypes}
            members={membersByGroup.get(group.id) ?? []}
            lang={lang}
          />
        );
      }}
    />
  );
}
