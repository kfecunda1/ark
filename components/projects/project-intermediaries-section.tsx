"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectIntermediary, removeProjectIntermediary, moveProjectIntermediary } from "@/lib/actions/intermediaries";
import { quickCreatePerson } from "@/lib/actions/people";
import { personLabel } from "@/lib/people";
import {
  IntermediaryChainEditor,
  type IntermediaryChainEntry,
  type IntermediaryPickerOption,
} from "@/components/projects/intermediary-chain-editor";

interface ProjectIntermediariesSectionProps {
  projectId: string;
  entries: IntermediaryChainEntry[];
  receiverLabel: string | null;
  pickerOptions: IntermediaryPickerOption[];
}

// The detail page's own immediate add/remove/reorder for a project's
// intermediary chain — every action persists right away (unlike the
// create/edit form's identical-looking editor, which only stages
// changes locally until the form is saved). See components/projects/
// intermediary-chain-editor.tsx, shared by both.
export function ProjectIntermediariesSection({
  projectId,
  entries,
  receiverLabel,
  pickerOptions,
}: ProjectIntermediariesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <IntermediaryChainEditor
      entries={entries}
      receiverLabel={receiverLabel}
      pickerOptions={pickerOptions}
      disabled={isPending}
      error={error}
      onQuickCreate={async (name) => {
        const result = await quickCreatePerson({ name });
        if (result.error || !result.person) {
          return { option: null, error: result.error ?? "Could not create contact." };
        }
        return { option: { id: result.person.id, label: personLabel(result.person) }, error: null };
      }}
      onAdd={(option) => run(() => addProjectIntermediary(projectId, option.id))}
      onRemove={(personId) => run(() => removeProjectIntermediary(projectId, personId))}
      onMoveUp={(personId) => run(() => moveProjectIntermediary(projectId, personId, "up"))}
      onMoveDown={(personId) => run(() => moveProjectIntermediary(projectId, personId, "down"))}
    />
  );
}
