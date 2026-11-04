"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStepKind } from "@/lib/types";

// See the matching helper in lib/actions/projects.ts: converts a
// genuinely unexpected exception (network failure, …) into the same
// returned-error shape every normal Supabase-error path already uses,
// so callers never see a save silently fail.
function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Every write below touches the project's own pages (the timeline) as
// well as the two places a step surfaces as derived data: the Projects
// list's "Next step" column and the Dashboard's Follow-ups
// due/Stuck projects sections.
function revalidateTimelinePaths(projectId: string): void {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function createProjectStep(
  projectId: string,
  kind: ProjectStepKind,
  body: string,
  dueDate: string | null
): Promise<{ error: string | null }> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { error: '"Text" is required.' };
  }
  if (kind === "next_step" && !dueDate) {
    return { error: '"Due date" is required for a next step.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("project_steps").insert({
      project_id: projectId,
      kind,
      body: trimmed,
      due_date: kind === "next_step" ? dueDate : null,
      author_id: user?.id ?? null,
    });

    if (error) {
      return { error: error.message };
    }

    revalidateTimelinePaths(projectId);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function updateProjectStep(
  stepId: string,
  projectId: string,
  body: string,
  dueDate: string | null
): Promise<{ error: string | null }> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { error: '"Text" is required.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_steps")
      .update({ body: trimmed, due_date: dueDate })
      .eq("id", stepId);

    if (error) {
      return { error: error.message };
    }

    revalidateTimelinePaths(projectId);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

// Ticking a next_step's "Done" checkbox sets done_at to now; unticking
// clears it — same instant round-trip pattern as every other inline
// toggle in the app (StatusSelect, ArchiveProjectButton, …).
export async function setProjectStepDone(
  stepId: string,
  projectId: string,
  done: boolean
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_steps")
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq("id", stepId);

    if (error) {
      return { error: error.message };
    }

    revalidateTimelinePaths(projectId);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}

export async function deleteProjectStep(stepId: string, projectId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("project_steps").delete().eq("id", stepId);

    if (error) {
      return { error: error.message };
    }

    revalidateTimelinePaths(projectId);
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
