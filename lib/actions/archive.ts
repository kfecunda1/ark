"use server";

import { toggleContactArchived } from "@/lib/actions/contacts";
import { togglePersonArchived } from "@/lib/actions/people";

export type ArchivableEntityType = "receiver" | "person";

// The single server action components/archive-toggle-button.tsx calls
// itself, so a Server Component page only ever needs to pass it plain
// data (entityType/entityId/archived) as props — same reason
// lib/actions/contact-person.ts exists: a Server Component wrapping a
// Server Action in a new inline arrow function produces a plain
// closure, which isn't serializable across the server/client boundary.
export async function setArchived(
  entityType: ArchivableEntityType,
  entityId: string,
  archived: boolean
): Promise<{ error: string | null }> {
  if (entityType === "receiver") {
    return toggleContactArchived(entityId, archived);
  }
  return togglePersonArchived(entityId, archived);
}
