"use client";

import { useState } from "react";
import type { EntityOption } from "@/components/entity-picker";
import { EntityPicker } from "@/components/entity-picker";
import { QuickCreatePanel } from "@/components/inbox/quick-create-panel";
import { quickCreateOpportunity, findSimilarOpportunities } from "@/lib/actions/opportunities";
import { quickCreatePerson } from "@/lib/actions/people";
import type { SimilarMatch } from "@/lib/dedup";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

interface OpportunityQuickCreateFieldsProps {
  initialName: string;
  people: EntityOption[];
  onCreated: (option: EntityOption) => void;
  onUseExisting: (match: SimilarMatch) => void;
  onCancel: () => void;
  lang?: Lang;
}

export function OpportunityQuickCreateFields({
  initialName,
  people,
  onCreated,
  onUseExisting,
  onCancel,
  lang = "en",
}: OpportunityQuickCreateFieldsProps) {
  const t = getDictionary(lang);
  const [title, setTitle] = useState(initialName);
  const [intermediary, setIntermediary] = useState<EntityOption | null>(null);

  async function handleCreate(): Promise<{ error: string | null }> {
    const result = await quickCreateOpportunity({ title: title.trim(), intermediaryPersonId: intermediary?.id ?? null });
    if (result.error || !result.opportunity) {
      return { error: resolveError(result.error, lang) ?? t.opportunityForm.failedToCreate };
    }

    onCreated({ id: result.opportunity.id, label: result.opportunity.title });
    return { error: null };
  }

  return (
    <QuickCreatePanel
      name={title}
      onNameChange={setTitle}
      nameLabel={t.opportunityForm.titleLabel}
      checkSimilar={(value) => findSimilarOpportunities(value)}
      onUseExisting={onUseExisting}
      onCreate={handleCreate}
      onCancel={onCancel}
      createLabel={t.inboxQuickCreate.createOpportunity}
      creatingLabel={t.common.creating}
      lang={lang}
    >
      <EntityPicker
        name="quick_create_intermediary"
        label={t.opportunityForm.intermediaryLabel}
        options={people}
        entityNoun={lang === "es" ? "contacto" : "contact"}
        entityNounPlural={lang === "es" ? "contactos" : "contacts"}
        lang={lang}
        onSelect={setIntermediary}
        onQuickCreate={async (name) => {
          const result = await quickCreatePerson({ name });
          return {
            option: result.person
              ? { id: result.person.id, label: [result.person.first_name, result.person.last_name].filter(Boolean).join(" ") }
              : null,
            error: resolveError(result.error, lang),
          };
        }}
      />
    </QuickCreatePanel>
  );
}
