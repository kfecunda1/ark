"use client";

import { useRef, useState } from "react";
import type { EntityOption } from "@/components/entity-picker";
import { QuickCreatePanel } from "@/components/inbox/quick-create-panel";
import { ProductFields } from "@/components/receivers/product-fields";
import { createContactWithId, findSimilarContacts } from "@/lib/actions/contacts";
import { receiverDisplayName } from "@/lib/display-name";
import type { SimilarMatch } from "@/lib/dedup";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";
import type { Product } from "@/lib/types";

interface ReceiverQuickCreateFieldsProps {
  initialName: string;
  products: Product[];
  onCreated: (option: EntityOption) => void;
  onUseExisting: (match: SimilarMatch) => void;
  onCancel: () => void;
  lang?: Lang;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function ReceiverQuickCreateFields({
  initialName,
  products,
  onCreated,
  onUseExisting,
  onCancel,
  lang = "en",
}: ReceiverQuickCreateFieldsProps) {
  const t = getDictionary(lang);
  const [name, setName] = useState(initialName);
  const [nickname, setNickname] = useState("");
  // ProductFields (components/receivers/product-fields.tsx) renders
  // its own repeated product_type_row/product_ratio/product_recovery_
  // ratio/product_notes inputs, built for a real <form> submission —
  // this quick-create panel has no <form> of its own, so they're read
  // straight off this wrapper instead, same as any uncontrolled field.
  const productsWrapperRef = useRef<HTMLDivElement>(null);

  async function handleCreate(): Promise<{ error: string | null }> {
    const formData = new FormData();
    formData.set("full_name", name.trim());
    if (nickname.trim()) formData.set("nickname", nickname.trim());

    const fields = productsWrapperRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[name='product_type_row'], [name='product_ratio'], [name='product_recovery_ratio'], [name='product_notes']"
    );
    fields?.forEach((input) => formData.append(input.name, input.value));

    const result = await createContactWithId(formData);
    if (result.error || !result.id) {
      return { error: resolveError(result.error, lang) ?? t.inboxQuickCreate.failedToCreateReceiver };
    }

    onCreated({ id: result.id, label: receiverDisplayName({ full_name: name.trim(), nickname: nickname.trim() || null }) });
    return { error: null };
  }

  return (
    <QuickCreatePanel
      name={name}
      onNameChange={setName}
      nameLabel={t.receiverForm.fullNameLabel}
      checkSimilar={(value) => findSimilarContacts(value, nickname.trim() || null)}
      onUseExisting={onUseExisting}
      onCreate={handleCreate}
      onCancel={onCancel}
      createLabel={t.inboxQuickCreate.createReceiver}
      creatingLabel={t.common.creating}
      lang={lang}
    >
      <div>
        <label className={labelClass}>{t.common.nicknameLabel}</label>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={fieldClass} />
      </div>

      <div ref={productsWrapperRef}>
        <label className={labelClass}>{t.receiverForm.productsRatiosLabel}</label>
        <ProductFields products={products} lang={lang} />
      </div>
    </QuickCreatePanel>
  );
}
