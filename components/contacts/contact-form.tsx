"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { CapabilityFields } from "@/components/contacts/capability-fields";
import { createContact, updateContact, type ContactFormState } from "@/lib/actions/contacts";
import { disableSubmitButton } from "@/lib/forms";
import type { Contact, ContactCapability } from "@/lib/types";

interface ContactFormProps {
  mode: "create" | "edit";
  contact?: Contact;
  capabilities?: ContactCapability[];
  existingTags?: string[];
}

const initialState: ContactFormState = { error: null };

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function ContactForm({ mode, contact, capabilities = [], existingTags = [] }: ContactFormProps) {
  const action = mode === "edit" && contact ? updateContact.bind(null, contact.id) : createContact;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <form
      action={formAction}
      onSubmit={() => disableSubmitButton(submitButtonRef)}
      className="flex flex-col gap-6"
    >
      <GlassCard interactive={false} className="flex flex-col gap-5 p-6">
        <div>
          <label className={labelClass} htmlFor="full_name">
            Full Name *
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            defaultValue={contact?.full_name ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" defaultValue={contact?.phone ?? ""} className={fieldClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={contact?.email ?? ""}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={contact?.notes ?? ""}
            placeholder='Free-text capability detail, e.g. "Prefers 30-day settlement, EU banks only"'
            className={fieldClass}
          />
        </div>
      </GlassCard>

      <GlassCard interactive={false} className="p-6">
        <p className={labelClass}>Capabilities</p>
        <CapabilityFields initialCapabilities={capabilities} existingTags={existingTags} />
      </GlassCard>

      {state?.error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          ref={submitButtonRef}
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Create contact"}
        </button>
        <Link
          href={mode === "edit" && contact ? `/contacts/${contact.id}` : "/contacts"}
          className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
