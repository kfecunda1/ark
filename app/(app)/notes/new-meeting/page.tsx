import { MeetingForm } from "@/components/notes/meeting-form";
import { newActionItemKey, type ActionItemEntry } from "@/components/notes/action-items-editor";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { hasDisplayNickname, projectDisplayName, receiverDisplayName } from "@/lib/display-name";
import { getActiveDocumentTypes } from "@/lib/document-types";
import { personLabel } from "@/lib/people";
import { suggestActionItemsFromText } from "@/lib/meeting-action-items";
import { dateKeyInTimeZone } from "@/lib/format";
import { getCurrentUserLanguage } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n";
import type { Contact, InboxItem, Person, Project } from "@/lib/types";

interface NewMeetingPageProps {
  searchParams: Promise<{ fromInboxItem?: string }>;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

export default async function NewMeetingPage({ searchParams }: NewMeetingPageProps) {
  const { fromInboxItem } = await searchParams;
  const lang = await getCurrentUserLanguage();
  const t = getDictionary(lang);
  const supabase = await createClient();

  const [{ data: peopleData }, { data: contactsData }, { data: projectsData }, { data: opportunitiesData }, documentTypes] =
    await Promise.all([
      supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("first_name"),
      supabase.from("contacts").select("id, full_name, nickname, archived_at"),
      supabase.from("projects").select("id, name, nickname"),
      supabase.from("opportunities").select("id, title"),
      getActiveDocumentTypes(),
    ]);

  const people = ((peopleData as Pick<Person, "id" | "first_name" | "last_name">[] | null) ?? []).map((p) => ({
    id: p.id,
    label: personLabel(p),
  }));
  const contacts = (contactsData as Contact[] | null) ?? [];
  const contactOptions = contacts
    .filter((contact) => !contact.archived_at)
    .map((contact) => ({
      id: contact.id,
      label: receiverDisplayName(contact) + (contact.archived_at ? ` (${t.common.archived})` : ""),
      sublabel: hasDisplayNickname(contact.nickname) ? contactLabel(contact) : undefined,
    }));
  const projects = (projectsData as Pick<Project, "id" | "name" | "nickname">[] | null) ?? [];
  const projectOptions = projects.map((project) => ({
    id: project.id,
    label: projectDisplayName(project),
    sublabel: hasDisplayNickname(project.nickname) ? project.name : undefined,
  }));
  const opportunities = (opportunitiesData as { id: string; title: string }[] | null) ?? [];
  const opportunityOptions = opportunities.map((o) => ({ id: o.id, label: o.title }));

  let defaultTitle: string | undefined;
  let defaultSummary: string | undefined;
  let defaultActionItems: ActionItemEntry[] = [];

  if (fromInboxItem) {
    const { data: itemData } = await supabase.from("inbox_items").select("*").eq("id", fromInboxItem).maybeSingle();
    const item = itemData as InboxItem | null;
    if (item) {
      const text = item.text_or_caption?.trim() ?? "";
      defaultTitle = (text ? firstLine(text) : item.file_name) || undefined;
      defaultSummary = text || undefined;
      defaultActionItems = suggestActionItemsFromText(text).map((itemText) => ({
        key: newActionItemKey(),
        text: itemText,
        dueDate: "",
      }));
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.meetingForm.newMeetingTitle}</h1>
        <p className="mt-1 text-sm text-white/45">{t.meetingForm.newMeetingSubtitle}</p>
      </div>
      <MeetingForm
        mode="create"
        people={people}
        projects={projectOptions}
        contacts={contactOptions}
        opportunities={opportunityOptions}
        documentTypes={documentTypes}
        defaultTitle={defaultTitle}
        defaultSummary={defaultSummary}
        defaultMeetingDate={dateKeyInTimeZone(new Date().toISOString())}
        defaultActionItems={defaultActionItems}
        fromInboxItemId={fromInboxItem}
        lang={lang}
      />
    </div>
  );
}
