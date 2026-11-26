"use client";

import { useState } from "react";
import type { EntityOption } from "@/components/entity-picker";
import { EntityPicker } from "@/components/entity-picker";
import { QuickCreatePanel } from "@/components/inbox/quick-create-panel";
import { ProductOptionsPicker } from "@/components/projects/product-options-picker";
import { createProjectWithId, findSimilarProjects } from "@/lib/actions/projects";
import { quickCreateContact } from "@/lib/actions/contacts";
import { projectDisplayName } from "@/lib/display-name";
import type { SimilarMatch } from "@/lib/dedup";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Currency, Product } from "@/lib/types";

interface ProjectQuickCreateFieldsProps {
  initialName: string;
  contacts: EntityOption[];
  products: Product[];
  defaultCurrency: Currency;
  onCreated: (option: EntityOption) => void;
  onUseExisting: (match: SimilarMatch) => void;
  onCancel: () => void;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function ProjectQuickCreateFields({
  initialName,
  contacts,
  products,
  defaultCurrency,
  onCreated,
  onUseExisting,
  onCancel,
  lang = "en",
}: ProjectQuickCreateFieldsProps) {
  const t = getDictionary(lang);
  const [name, setName] = useState(initialName);
  const [nickname, setNickname] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([""]);
  const [matchedContact, setMatchedContact] = useState<EntityOption | null>(null);

  async function handleCreate(): Promise<{ error: string | null }> {
    const chosenProducts = productOptions.filter(Boolean);
    if (chosenProducts.length === 0) {
      return { error: t.inboxQuickCreate.productRequired };
    }

    const formData = new FormData();
    formData.set("name", name.trim());
    if (nickname.trim()) formData.set("nickname", nickname.trim());
    formData.set("stage", "new");
    formData.set("currency", defaultCurrency);
    formData.set("priority", "medium");
    if (matchedContact) formData.set("matched_contact_id", matchedContact.id);
    for (const product of chosenProducts) formData.append("product_options", product);

    const result = await createProjectWithId(formData);
    if (result.error || !result.id) {
      return { error: resolveError(result.error, lang) ?? t.inboxQuickCreate.failedToCreateProject };
    }

    onCreated({ id: result.id, label: projectDisplayName({ name: name.trim(), nickname: nickname.trim() || null }) });
    return { error: null };
  }

  return (
    <QuickCreatePanel
      name={name}
      onNameChange={setName}
      nameLabel={t.projectForm.nameLabel}
      checkSimilar={(value) => findSimilarProjects(value, nickname.trim() || null)}
      onUseExisting={onUseExisting}
      onCreate={handleCreate}
      onCancel={onCancel}
      createLabel={t.inboxQuickCreate.createProject}
      creatingLabel={t.common.creating}
      lang={lang}
    >
      <div>
        <label className={labelClass}>{t.common.nicknameLabel}</label>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass}>{t.projectForm.productsLabel}</label>
        <ProductOptionsPicker products={products} value={productOptions} onChange={setProductOptions} lang={lang} />
      </div>

      <EntityPicker
        name="quick_create_matched_contact_id"
        label={t.projectForm.matchedWithLabel}
        options={contacts}
        entityNoun={lang === "es" ? "receptor" : "receiver"}
        entityNounPlural={lang === "es" ? "receptores" : "receivers"}
        lang={lang}
        onSelect={setMatchedContact}
        onQuickCreate={async (value) => {
          const result = await quickCreateContact({ full_name: value });
          return {
            option: result.contact ? { id: result.contact.id, label: result.contact.full_name } : null,
            error: resolveError(result.error, lang),
          };
        }}
      />
    </QuickCreatePanel>
  );
}
