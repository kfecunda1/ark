import type { Person } from "@/lib/types";

export function personLabel(person: Pick<Person, "first_name" | "last_name">): string {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}
