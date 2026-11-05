"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { DuplicateWarningBanner } from "@/components/duplicate-warning-banner";
import { disableSubmitButton } from "@/lib/forms";
import {
  createPersonWithId,
  findDuplicatePeople,
  updatePerson,
  type DuplicatePersonMatch,
  type PersonFormState,
} from "@/lib/actions/people";
import type { Person } from "@/lib/types";

interface PersonFormProps {
  mode: "create" | "edit";
  person?: Person;
}

const initialState: PersonFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

// Create mode runs the duplicate check client-side before committing
// (same pattern as components/projects/project-form.tsx) so "Add
// anyway" can resubmit without the user retyping anything. Edit mode
// keeps the plain server-action/useActionState flow, same as every
// other edit form in the app.
export function PersonForm({ mode, person }: PersonFormProps) {
  const router = useRouter();

  const editAction = mode === "edit" && person ? updatePerson.bind(null, person.id) : async () => ({ error: null });
  const [editState, editFormAction, isEditPending] = useActionState(editAction, initialState);

  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicatePersonMatch[] | null>(null);
  const lastFormDataRef = useRef<FormData | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    disableSubmitButton(submitButtonRef);
    e.preventDefault();
    setCreateError(null);
    setDuplicateMatches(null);
    const formData = new FormData(e.currentTarget);
    lastFormDataRef.current = formData;
    await proceedWithCreate(formData, false);
  }

  async function proceedWithCreate(formData: FormData, skipDuplicateCheck: boolean) {
    setIsCreating(true);

    if (!skipDuplicateCheck) {
      const firstName = formData.get("first_name")?.toString().trim() ?? "";
      const lastName = formData.get("last_name")?.toString().trim() ?? "";
      const email = formData.get("email")?.toString().trim() ?? "";
      const matches = await findDuplicatePeople({ firstName, lastName, email });
      if (matches.length > 0) {
        setDuplicateMatches(matches);
        setIsCreating(false);
        return;
      }
    }

    const result = await createPersonWithId(formData);
    if (result.error || !result.id) {
      setCreateError(result.error ?? "Failed to create contact.");
      setIsCreating(false);
      return;
    }

    router.push(`/people/${result.id}`);
  }

  function handleAddAnyway() {
    setDuplicateMatches(null);
    if (lastFormDataRef.current) {
      proceedWithCreate(lastFormDataRef.current, true);
    }
  }

  const formProps =
    mode === "edit"
      ? { action: editFormAction, onSubmit: () => disableSubmitButton(submitButtonRef) }
      : { onSubmit: handleCreateSubmit };
  const error = mode === "edit" ? editState?.error : createError;
  const isPending = mode === "edit" ? isEditPending : isCreating;

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <GlassCard interactive={false} className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="first_name">
            First Name *
          </label>
          <input
            id="first_name"
            name="first_name"
            required
            defaultValue={person?.first_name ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="last_name">
            Last Name
          </label>
          <input id="last_name" name="last_name" defaultValue={person?.last_name ?? ""} className={fieldClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" defaultValue={person?.phone ?? ""} className={fieldClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={person?.email ?? ""} className={fieldClass} />
        </div>
      </GlassCard>

      {duplicateMatches && duplicateMatches.length > 0 && (
        <DuplicateWarningBanner
          heading="A contact with this same name or email already exists:"
          matches={duplicateMatches.map((m) => ({ id: m.id, href: `/people/${m.id}`, label: m.label, meta: m.meta }))}
          onAddAnyway={handleAddAnyway}
        />
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          ref={submitButtonRef}
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === "edit" ? (isEditPending ? "Saving…" : "Save changes") : isCreating ? "Creating…" : "Create contact"}
        </button>
        <Link
          href={mode === "edit" && person ? `/people/${person.id}` : "/people"}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
