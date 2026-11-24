"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { TemplateCard } from "@/components/templates/template-card";
import { TemplateForm } from "@/components/templates/template-form";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, Product } from "@/lib/types";

export interface TemplateVersionCardData {
  id: string;
  versionNumber: number;
  fileName: string;
  notes: string | null;
  uploadedAt: string;
  uploadedByName: string;
  signedUrl: string | null;
}

export interface TemplateCardData {
  id: string;
  name: string;
  description: string | null;
  documentType: string | null;
  active: boolean;
  products: string[];
  versions: TemplateVersionCardData[];
}

interface TemplatesBrowserProps {
  templates: TemplateCardData[];
  products: Product[];
  documentTypes: DocumentTypeRecord[];
  isAdmin: boolean;
  initialDocumentType?: string;
  initialProduct?: string;
  initialHighlight?: string;
  initialQuery?: string;
  lang?: Lang;
}

const fieldClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

export function TemplatesBrowser({
  templates,
  products,
  documentTypes,
  isAdmin,
  initialDocumentType,
  initialProduct,
  initialHighlight,
  initialQuery,
  lang = "en",
}: TemplatesBrowserProps) {
  const router = useRouter();
  const t = getDictionary(lang);

  const [query, setQuery] = useState(initialQuery ?? "");
  const [documentTypeFilter, setDocumentTypeFilter] = useState(initialDocumentType ?? "");
  const [productFilter, setProductFilter] = useState(initialProduct ?? "");
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    if (!initialHighlight) return;
    const el = document.getElementById(`template-${initialHighlight}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialHighlight]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (documentTypeFilter === "__other__" && tpl.documentType !== null) return false;
      if (documentTypeFilter && documentTypeFilter !== "__other__" && tpl.documentType !== documentTypeFilter) return false;
      if (productFilter && !tpl.products.includes(productFilter)) return false;
      if (q && !`${tpl.name} ${tpl.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, query, documentTypeFilter, productFilter]);

  const groups = useMemo(() => {
    const result: { key: string; label: string; items: TemplateCardData[] }[] = [];
    for (const dtype of documentTypes) {
      const items = filtered.filter((tpl) => tpl.documentType === dtype.name);
      if (items.length > 0) result.push({ key: dtype.name, label: catalogLabel(dtype, lang), items });
    }
    const other = filtered.filter((tpl) => tpl.documentType === null);
    if (other.length > 0) result.push({ key: "__other__", label: t.templates.otherGroup, items: other });
    return result;
  }, [filtered, documentTypes, lang, t]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.templates.searchPlaceholder}
            className={`${fieldClass} w-full pl-9`}
          />
        </div>
        <select value={documentTypeFilter} onChange={(e) => setDocumentTypeFilter(e.target.value)} className={fieldClass}>
          <option value="" className="bg-[#0a0e17]">
            {t.templates.allDocumentTypes}
          </option>
          {documentTypes.map((dtype) => (
            <option key={dtype.id} value={dtype.name} className="bg-[#0a0e17]">
              {catalogLabel(dtype, lang)}
            </option>
          ))}
          <option value="__other__" className="bg-[#0a0e17]">
            {t.templates.otherGroup}
          </option>
        </select>
        <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className={fieldClass}>
          <option value="" className="bg-[#0a0e17]">
            {t.templates.allProducts}
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.name} className="bg-[#0a0e17]">
              {p.name}
            </option>
          ))}
        </select>
        {isAdmin && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            {t.templates.newTemplate}
          </button>
        )}
      </div>

      {showCreateForm && (
        <div className="mb-6">
          <TemplateForm
            mode="create"
            products={products}
            documentTypes={documentTypes}
            onDone={() => {
              setShowCreateForm(false);
              router.refresh();
            }}
            onCancel={() => setShowCreateForm(false)}
            lang={lang}
          />
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/35">
          {templates.length === 0 ? t.templates.noTemplatesYet : t.templates.noMatchingTemplates}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 text-xs font-medium tracking-wide text-white/35 uppercase">{group.label}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {group.items.map((tpl) => (
                  <div key={tpl.id} id={`template-${tpl.id}`}>
                    <TemplateCard
                      template={tpl}
                      products={products}
                      documentTypes={documentTypes}
                      isAdmin={isAdmin}
                      highlighted={initialHighlight === tpl.id}
                      lang={lang}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
