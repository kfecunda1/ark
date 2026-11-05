"use server";

import { updateContactPerson } from "@/lib/actions/contacts";
import { updateProjectContactPerson } from "@/lib/actions/projects";

export type ContactPersonEntityType = "receiver" | "project";

// The single server action components/contact-person-select.tsx calls
// itself, so a Server Component page only ever needs to pass it plain
// data (entityType/entityId) as props — never a closure over
// updateContactPerson/updateProjectContactPerson, which isn't
// serializable across the server/client boundary (a Server Component
// wrapping a Server Action in a new inline arrow function produces a
// plain function, not a passable Server Action reference).
export async function setContactPerson(
  entityType: ContactPersonEntityType,
  entityId: string,
  personId: string | null
): Promise<{ error: string | null }> {
  if (entityType === "receiver") {
    return updateContactPerson(entityId, personId);
  }
  return updateProjectContactPerson(entityId, personId);
}
