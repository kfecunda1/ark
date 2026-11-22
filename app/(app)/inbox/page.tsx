import { GlassCard } from "@/components/glass-card";
import { InboxTabs } from "@/components/inbox/inbox-tabs";
import { createClient } from "@/lib/supabase/server";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { isCurrentUserAdmin } from "@/lib/auth";
import { buildInboxSuggestions, suggestDocumentType } from "@/lib/inbox-suggestions";
import { hasDisplayNickname, projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { InboxItem } from "@/lib/types";

export default async function InboxPage() {
  const supabase = await createClient();
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);

  const [
    { data: itemsData },
    { data: profilesData },
    { data: projectsData },
    { data: contactsData },
    { data: peopleData },
    { data: receiverIntermediariesData },
    { data: projectIntermediariesData },
    documentTypes,
    isAdmin,
  ] = await Promise.all([
    supabase.from("inbox_items").select("*").order("received_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("projects").select("id, name, nickname").is("archived_at", null).order("name"),
    supabase.from("contacts").select("id, full_name, nickname").is("archived_at", null).order("full_name"),
    supabase.from("people").select("id, first_name, last_name").is("archived_at", null),
    supabase.from("receiver_intermediaries").select("person_id, receiver_id"),
    supabase.from("project_intermediaries").select("person_id, project_id"),
    getActiveDocumentTypes(),
    isCurrentUserAdmin(),
  ]);

  const items = (itemsData as InboxItem[] | null) ?? [];
  const profiles = (profilesData as { id: string; full_name: string | null; email: string | null }[] | null) ?? [];
  const projects = (projectsData as { id: string; name: string; nickname: string | null }[] | null) ?? [];
  const contacts = (contactsData as { id: string; full_name: string; nickname: string | null }[] | null) ?? [];
  const people = (peopleData as { id: string; first_name: string; last_name: string | null }[] | null) ?? [];
  const receiverIntermediaries =
    (receiverIntermediariesData as { person_id: string; receiver_id: string }[] | null) ?? [];
  const projectIntermediaries =
    (projectIntermediariesData as { person_id: string; project_id: string }[] | null) ?? [];

  // Suggested filing destination/document type for every "To file"
  // item — pure read-only matching (lib/inbox-suggestions.ts); filed
  // and dismissed items never need one.
  const toFileItems = items.filter((i) => i.status === "new");
  const suggestionsByItemId: Record<string, { type: "project" | "contact"; id: string; label: string }[]> = {};
  const suggestedDocTypeByItemId: Record<string, string> = {};
  for (const item of toFileItems) {
    suggestionsByItemId[item.id] = buildInboxSuggestions(item, {
      projects,
      contacts,
      people,
      receiverIntermediaries,
      projectIntermediaries,
    });
    const docType = suggestDocumentType(item, documentTypes);
    if (docType) suggestedDocTypeByItemId[item.id] = docType;
  }

  // Covers both the original sender (profile_id) and whoever actually
  // filed an item (filed_by) — both are just profile ids.
  const userNameById = Object.fromEntries(
    profiles.map((p) => [p.id, p.full_name?.trim() || p.email || t.inbox.unknownUser])
  );

  // A filed item's destination may not be in the active projects/
  // contacts lists above (archived since, or just not re-fetched) — so
  // its "Filed to: X" label gets its own lookup rather than assuming
  // it's already covered.
  const filedProjectIds = items
    .filter((i) => i.filed_to_type === "project" && i.filed_to_id)
    .map((i) => i.filed_to_id as string);
  const filedContactIds = items
    .filter((i) => i.filed_to_type === "contact" && i.filed_to_id)
    .map((i) => i.filed_to_id as string);

  const [{ data: filedProjectsData }, { data: filedContactsData }] = await Promise.all([
    filedProjectIds.length > 0
      ? supabase.from("projects").select("id, name, nickname").in("id", filedProjectIds)
      : Promise.resolve({ data: [] as { id: string; name: string; nickname: string | null }[] }),
    filedContactIds.length > 0
      ? supabase.from("contacts").select("id, full_name, nickname").in("id", filedContactIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; nickname: string | null }[] }),
  ]);

  const projectNameById = Object.fromEntries([
    ...projects.map((p): [string, string] => [p.id, projectDisplayName(p)]),
    ...((filedProjectsData as { id: string; name: string; nickname: string | null }[] | null) ?? []).map(
      (p): [string, string] => [p.id, projectDisplayName(p)]
    ),
  ]);
  const contactNameById = Object.fromEntries([
    ...contacts.map((c): [string, string] => [c.id, receiverDisplayName(c)]),
    ...((filedContactsData as { id: string; full_name: string; nickname: string | null }[] | null) ?? []).map(
      (c): [string, string] => [c.id, receiverDisplayName(c)]
    ),
  ]);

  // Signed URLs for files still sitting in the inbox bucket — only
  // "To file" items ever have one (filing clears storage_path).
  const inboxStoragePaths = items.map((i) => i.storage_path).filter((p): p is string => Boolean(p));
  let inboxSignedUrlByPath: Record<string, string> = {};
  if (inboxStoragePaths.length > 0) {
    const { data: signedUrls } = await supabase.storage.from("inbox").createSignedUrls(inboxStoragePaths, 3600);
    inboxSignedUrlByPath = Object.fromEntries(
      (signedUrls ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl as string])
    );
  }

  // The "Filed" tab's own "open the filed document" link and "Tranche
  // N" label — resolved via filed_document_id (027_inbox_view.sql),
  // which table it's in implied by filed_to_type. Keyed by inbox item
  // id (not the document's own id) since that's how the UI looks it
  // up, one item at a time.
  const filedProjectDocItems = items.filter((i) => i.filed_to_type === "project" && i.filed_document_id);
  const filedContactDocItems = items.filter((i) => i.filed_to_type === "contact" && i.filed_document_id);

  const [{ data: projectDocsData }, { data: contactDocsData }] = await Promise.all([
    filedProjectDocItems.length > 0
      ? supabase
          .from("project_documents")
          .select("id, file_path, tranche_id")
          .in("id", filedProjectDocItems.map((i) => i.filed_document_id as string))
      : Promise.resolve({ data: [] as { id: string; file_path: string | null; tranche_id: string | null }[] }),
    filedContactDocItems.length > 0
      ? supabase
          .from("contact_documents")
          .select("id, file_path")
          .in("id", filedContactDocItems.map((i) => i.filed_document_id as string))
      : Promise.resolve({ data: [] as { id: string; file_path: string | null }[] }),
  ]);

  const projectDocsById = new Map(
    ((projectDocsData as { id: string; file_path: string | null; tranche_id: string | null }[] | null) ?? []).map(
      (d) => [d.id, d]
    )
  );
  const contactDocsById = new Map(
    ((contactDocsData as { id: string; file_path: string | null }[] | null) ?? []).map((d) => [d.id, d])
  );

  const trancheIds = [...projectDocsById.values()].map((d) => d.tranche_id).filter((id): id is string => Boolean(id));
  const { data: tranchesData } =
    trancheIds.length > 0
      ? await supabase.from("project_tranches").select("id, tranche_number").in("id", trancheIds)
      : { data: [] as { id: string; tranche_number: number }[] };
  const trancheNumberById = Object.fromEntries(
    ((tranchesData as { id: string; tranche_number: number }[] | null) ?? []).map((t) => [t.id, t.tranche_number])
  );

  const projectDocPaths = [...projectDocsById.values()].map((d) => d.file_path).filter((p): p is string => Boolean(p));
  const contactDocPaths = [...contactDocsById.values()].map((d) => d.file_path).filter((p): p is string => Boolean(p));

  const [{ data: projectDocSignedUrls }, { data: contactDocSignedUrls }] = await Promise.all([
    projectDocPaths.length > 0
      ? supabase.storage.from("project-documents").createSignedUrls(projectDocPaths, 3600)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    contactDocPaths.length > 0
      ? supabase.storage.from("contact-documents").createSignedUrls(contactDocPaths, 3600)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const projectDocUrlByPath: Record<string, string> = Object.fromEntries(
    (projectDocSignedUrls ?? [])
      .filter((s): s is { path: string; signedUrl: string } => Boolean(s.path) && Boolean(s.signedUrl))
      .map((s) => [s.path, s.signedUrl])
  );
  const contactDocUrlByPath: Record<string, string> = Object.fromEntries(
    (contactDocSignedUrls ?? [])
      .filter((s): s is { path: string; signedUrl: string } => Boolean(s.path) && Boolean(s.signedUrl))
      .map((s) => [s.path, s.signedUrl])
  );

  const filedOpenUrlByItemId: Record<string, string> = {};
  const filedTrancheNumberByItemId: Record<string, number> = {};
  for (const item of filedProjectDocItems) {
    const doc = projectDocsById.get(item.filed_document_id as string);
    if (doc?.file_path && projectDocUrlByPath[doc.file_path]) {
      filedOpenUrlByItemId[item.id] = projectDocUrlByPath[doc.file_path];
    }
    if (doc?.tranche_id && trancheNumberById[doc.tranche_id] != null) {
      filedTrancheNumberByItemId[item.id] = trancheNumberById[doc.tranche_id];
    }
  }
  for (const item of filedContactDocItems) {
    const doc = contactDocsById.get(item.filed_document_id as string);
    if (doc?.file_path && contactDocUrlByPath[doc.file_path]) {
      filedOpenUrlByItemId[item.id] = contactDocUrlByPath[doc.file_path];
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.inbox.title}</h1>
        <p className="mt-1 text-sm text-white/45">{t.inbox.subtitle}</p>
      </div>

      <GlassCard interactive={false} className="p-6">
        <InboxTabs
          items={items}
          userNameById={userNameById}
          projectOptions={projects.map((p) => ({
            id: p.id,
            label: projectDisplayName(p),
            sublabel: hasDisplayNickname(p.nickname) ? p.name : undefined,
          }))}
          contactOptions={contacts.map((c) => ({
            id: c.id,
            label: receiverDisplayName(c),
            sublabel: hasDisplayNickname(c.nickname) ? c.full_name : undefined,
          }))}
          projectNameById={projectNameById}
          contactNameById={contactNameById}
          signedUrlByPath={inboxSignedUrlByPath}
          documentTypes={documentTypes}
          filedOpenUrlByItemId={filedOpenUrlByItemId}
          filedTrancheNumberByItemId={filedTrancheNumberByItemId}
          isAdmin={isAdmin}
          suggestionsByItemId={suggestionsByItemId}
          suggestedDocTypeByItemId={suggestedDocTypeByItemId}
          lang={lang}
        />
      </GlassCard>
    </div>
  );
}
