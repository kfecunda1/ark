import type { Contact } from "@/lib/types";

export function contactLabel(contact: Pick<Contact, "full_name">): string {
  return contact.full_name;
}
