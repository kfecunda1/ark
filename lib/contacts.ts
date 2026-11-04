import type { Contact } from "@/lib/types";

export function contactDetail(contact: Pick<Contact, "phone" | "email">): string | null {
  return contact.phone || contact.email || null;
}

export function contactLabel(contact: Pick<Contact, "full_name" | "phone" | "email">): string {
  const detail = contactDetail(contact);
  return detail ? `${contact.full_name} — ${detail}` : contact.full_name;
}
