import { notFound } from "next/navigation";
import { PersonForm } from "@/components/people/person-form";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/people";
import type { Person } from "@/lib/types";

interface EditPersonPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPersonPage({ params }: EditPersonPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  const person = data as Person | null;

  if (!person) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Edit Contact</h1>
        <p className="mt-1 text-sm text-white/45">Update details for {personLabel(person)}.</p>
      </div>
      <PersonForm mode="edit" person={person} />
    </div>
  );
}
