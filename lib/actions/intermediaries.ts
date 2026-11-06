"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same reasoning as lib/actions/projects.ts's own copy: turns a
// genuinely unexpected exception into the same returned-error shape
// every normal Supabase-error path already uses.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// ----------------------------------------------------------------------------
// Receiver intermediaries — an unordered set per receiver
// (components/receivers/receiver-intermediaries-section.tsx).
// ----------------------------------------------------------------------------

export async function addReceiverIntermediary(receiverId: string, personId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("receiver_intermediaries")
      .upsert({ receiver_id: receiverId, person_id: personId }, { onConflict: "receiver_id,person_id", ignoreDuplicates: true });

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${receiverId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function removeReceiverIntermediary(receiverId: string, personId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("receiver_intermediaries")
      .delete()
      .eq("receiver_id", receiverId)
      .eq("person_id", personId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/receivers/${receiverId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Callable from a client component (the create/edit project form's
// live picker reordering as the matched receiver changes) — same
// reasoning as lib/actions/contacts.ts's getContactProductRatio(s).
export async function getReceiverIntermediaryPersonIds(receiverId: string): Promise<string[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("receiver_intermediaries").select("person_id").eq("receiver_id", receiverId);
    return ((data as { person_id: string }[] | null) ?? []).map((r) => r.person_id);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Project intermediaries — the detail page's own immediate add/remove/
// reorder (components/projects/project-intermediaries-section.tsx).
// The create/edit *form*'s picker (components/projects/project-form.
// tsx) stages its changes locally instead and submits them as ordered
// `intermediary_person_ids` fields — see lib/intermediaries.ts's
// syncProjectIntermediaries, called from lib/actions/projects.ts (not
// defined in *this* file: every export of a "use server" file becomes
// a Server Action, which Next.js requires to take only serializable
// arguments — syncProjectIntermediaries takes a live Supabase client,
// so it lives in a plain, non-"use server" module instead).
// ----------------------------------------------------------------------------

// Appends at the end of the chain and, if the project has a matched
// receiver, also adds this person to that receiver's own intermediaries
// when they aren't already one of them — the one piece of behavior
// every "add an intermediary to a project" path (this, and
// syncProjectIntermediaries) must apply identically.
export async function addProjectIntermediary(projectId: string, personId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: existingRow } = await supabase
      .from("project_intermediaries")
      .select("id")
      .eq("project_id", projectId)
      .eq("person_id", personId)
      .maybeSingle();
    if (existingRow) {
      return { error: null };
    }

    const { data: maxRow } = await supabase
      .from("project_intermediaries")
      .select("position")
      .eq("project_id", projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = ((maxRow as { position: number } | null)?.position ?? 0) + 1;

    const { error: insertError } = await supabase
      .from("project_intermediaries")
      .insert({ project_id: projectId, person_id: personId, position: nextPosition });
    if (insertError) {
      return { error: insertError.message };
    }

    const { data: projectRow } = await supabase
      .from("projects")
      .select("matched_contact_id")
      .eq("id", projectId)
      .maybeSingle();
    const matchedContactId = (projectRow as { matched_contact_id: string | null } | null)?.matched_contact_id ?? null;

    if (matchedContactId) {
      const { error: receiverError } = await supabase
        .from("receiver_intermediaries")
        .upsert(
          { receiver_id: matchedContactId, person_id: personId },
          { onConflict: "receiver_id,person_id", ignoreDuplicates: true }
        );
      if (receiverError) {
        return { error: receiverError.message };
      }
    }

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function removeProjectIntermediary(projectId: string, personId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_intermediaries")
      .delete()
      .eq("project_id", projectId)
      .eq("person_id", personId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Swaps this person's position with their neighbor one step up/down.
// Done as a 3-step dance (move the displaced row out of the way to a
// temporary negative position first) rather than two plain updates —
// swapping two rows' values directly under a plain UNIQUE (project_id,
// position) constraint would have the second statement collide with
// the first row's *old*, not-yet-vacated position.
export async function moveProjectIntermediary(
  projectId: string,
  personId: string,
  direction: "up" | "down"
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_intermediaries")
      .select("id, person_id, position")
      .eq("project_id", projectId)
      .order("position");

    const rows = (data as { id: string; person_id: string; position: number }[] | null) ?? [];
    const index = rows.findIndex((r) => r.person_id === personId);
    if (index === -1) {
      return { error: "That person is no longer in this project's intermediary chain." };
    }

    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rows.length) {
      return { error: null }; // already at that end — nothing to do
    }

    const current = rows[index];
    const neighbor = rows[swapWith];

    let { error } = await supabase.from("project_intermediaries").update({ position: -1 }).eq("id", current.id);
    if (error) return { error: error.message };

    ({ error } = await supabase
      .from("project_intermediaries")
      .update({ position: current.position })
      .eq("id", neighbor.id));
    if (error) return { error: error.message };

    ({ error } = await supabase
      .from("project_intermediaries")
      .update({ position: neighbor.position })
      .eq("id", current.id));
    if (error) return { error: error.message };

    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
