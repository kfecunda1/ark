import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth";
import { getAllProducts } from "@/lib/products";
import { getAllDocumentTypes } from "@/lib/document-types";
import { versionedFileName } from "@/lib/storage";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import { TemplatesBrowser, type TemplateCardData } from "@/components/templates/templates-browser";
import type { Template, TemplateProduct, TemplateVersion } from "@/lib/types";

interface TemplatesPageProps {
  searchParams: Promise<{ documentType?: string; product?: string; highlight?: string; q?: string }>;
}

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const params = await searchParams;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();
  const isAdmin = await isCurrentUserAdmin();

  const [{ data: templatesData }, products, documentTypes] = await Promise.all([
    supabase.from("templates").select("*").order("sort_order").order("name"),
    getAllProducts(),
    getAllDocumentTypes(),
  ]);

  // RLS lets every registered user SELECT every template regardless of
  // `active` (writes, not reads, are the admin-gated half) — a non-
  // admin's own "no hidden templates" rule is enforced here in the app,
  // same as hidden products/document_types staying out of a non-admin-
  // relevant list.
  const allTemplates = (templatesData as Template[] | null) ?? [];
  const templates = isAdmin ? allTemplates : allTemplates.filter((tpl) => tpl.active);
  const templateIds = templates.map((tpl) => tpl.id);

  const [{ data: productsData }, { data: versionsData }] =
    templateIds.length > 0
      ? await Promise.all([
          supabase.from("template_products").select("*").in("template_id", templateIds),
          supabase.from("template_versions").select("*").in("template_id", templateIds).order("version_number", { ascending: false }),
        ])
      : [{ data: [] as TemplateProduct[] }, { data: [] as TemplateVersion[] }];

  const productsByTemplate = new Map<string, string[]>();
  for (const row of (productsData as TemplateProduct[] | null) ?? []) {
    productsByTemplate.set(row.template_id, [...(productsByTemplate.get(row.template_id) ?? []), row.product]);
  }

  const versionsByTemplate = new Map<string, TemplateVersion[]>();
  for (const row of (versionsData as TemplateVersion[] | null) ?? []) {
    versionsByTemplate.set(row.template_id, [...(versionsByTemplate.get(row.template_id) ?? []), row]);
  }

  const userIds = [
    ...new Set(
      [...templates.map((tpl) => tpl.created_by), ...((versionsData as TemplateVersion[] | null) ?? []).map((v) => v.uploaded_by)].filter(
        (id): id is string => Boolean(id)
      )
    ),
  ];
  let nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    nameById = Object.fromEntries(
      ((profilesData as { id: string; full_name: string | null; email: string | null }[] | null) ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || t.templates.unknownUser,
      ])
    );
  }

  const allVersions = (versionsData as TemplateVersion[] | null) ?? [];
  const signedUrlById = new Map<string, string | null>();
  await Promise.all(
    allVersions.map(async (v) => {
      const { data } = await supabase.storage
        .from("templates")
        .createSignedUrl(v.file_path, 3600, { download: versionedFileName(v.file_name, v.version_number) });
      signedUrlById.set(v.id, data?.signedUrl ?? null);
    })
  );

  const cards: TemplateCardData[] = templates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    documentType: tpl.document_type,
    active: tpl.active,
    products: productsByTemplate.get(tpl.id) ?? [],
    versions: (versionsByTemplate.get(tpl.id) ?? []).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      fileName: v.file_name,
      notes: v.notes,
      uploadedAt: v.uploaded_at,
      uploadedByName: v.uploaded_by ? nameById[v.uploaded_by] ?? t.templates.unknownUser : t.templates.unknownUser,
      signedUrl: signedUrlById.get(v.id) ?? null,
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.nav.templates}</h1>
        <p className="mt-1 text-sm text-white/45">{t.templates.subtitle}</p>
      </div>

      <TemplatesBrowser
        templates={cards}
        products={products}
        documentTypes={documentTypes}
        isAdmin={isAdmin}
        initialDocumentType={params.documentType}
        initialProduct={params.product}
        initialHighlight={params.highlight}
        initialQuery={params.q}
        lang={lang}
      />
    </div>
  );
}
