import "server-only";
import { createClient } from "@supabase/supabase-js";

// Bypasses RLS via the service role key — only for trusted server-side
// contexts with no logged-in user (e.g. webhooks). Never import this from
// client components or anything that could end up in the client bundle.
export function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
