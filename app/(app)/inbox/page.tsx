import { GlassCard } from "@/components/glass-card";
import { InboxList } from "@/components/inbox/inbox-list";
import { createClient } from "@/lib/supabase/server";
import { getActiveDocumentTypes } from "@/lib/document-types";
import type { InboxItem } from "@/lib/types";

export default async function InboxPage() {
  const supabase = await createClient();

  const [{ data: itemsData }, { data: profilesData }, { data: projectsData }, { data: contactsData }, documentTypes] =
    await Promise.all([
      supabase.from("inbox_items").select("*").order("received_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("projects").select("id, name").is("archived_at", null).order("name"),
      supabase.from("contacts").select("id, full_name").is("archived_at", null).order("full_name"),
      getActiveDocumentTypes(),
    ]);

  const items = (itemsData as InboxItem[] | null) ?? [];
  const profiles = (profilesData as { id: string; full_name: string | null; email: string | null }[] | null) ?? [];
  const projects = (projectsData as { id: string; name: string }[] | null) ?? [];
  const contacts = (contactsData as { id: string; full_name: string }[] | null) ?? [];

  const senderNameById = Object.fromEntries(
    profiles.map((p) => [p.id, p.full_name?.trim() || p.email || "Unknown user"])
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
      ? supabase.from("projects").select("id, name").in("id", filedProjectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    filedContactIds.length > 0
      ? supabase.from("contacts").select("id, full_name").in("id", filedContactIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const projectNameById = Object.fromEntries([
    ...projects.map((p): [string, string] => [p.id, p.name]),
    ...((filedProjectsData as { id: string; name: string }[] | null) ?? []).map((p): [string, string] => [p.id, p.name]),
  ]);
  const contactNameById = Object.fromEntries([
    ...contacts.map((c): [string, string] => [c.id, c.full_name]),
    ...((filedContactsData as { id: string; full_name: string }[] | null) ?? []).map((c): [string, string] => [
      c.id,
      c.full_name,
    ]),
  ]);

  const storagePaths = items.map((i) => i.storage_path).filter((p): p is string => Boolean(p));
  let signedUrlByPath: Record<string, string> = {};
  if (storagePaths.length > 0) {
    const { data: signedUrls } = await supabase.storage.from("inbox").createSignedUrls(storagePaths, 3600);
    signedUrlByPath = Object.fromEntries(
      (signedUrls ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl as string])
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Inbox</h1>
        <p className="mt-1 text-sm text-white/45">Messages and files forwarded from Telegram.</p>
      </div>

      <GlassCard interactive={false} className="p-6">
        <InboxList
          items={items}
          senderNameById={senderNameById}
          projectOptions={projects.map((p) => ({ id: p.id, label: p.name }))}
          contactOptions={contacts.map((c) => ({ id: c.id, label: c.full_name }))}
          projectNameById={projectNameById}
          contactNameById={contactNameById}
          signedUrlByPath={signedUrlByPath}
          documentTypes={documentTypes}
        />
      </GlassCard>
    </div>
  );
}
