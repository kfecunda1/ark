"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Currency } from "@/lib/types";

function unexpectedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function updateAppSettings(
  defaultCurrency: Currency,
  stuckAfterDays: number
): Promise<{ error: string | null }> {
  if (!Number.isInteger(stuckAfterDays) || stuckAfterDays <= 0) {
    return { error: '"Stuck after" must be a whole number of days greater than 0.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({ default_currency: defaultCurrency, stuck_after_days: stuckAfterDays })
      .eq("id", true);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/projects/new");
    return { error: null };
  } catch (err) {
    return { error: unexpectedErrorMessage(err) };
  }
}
