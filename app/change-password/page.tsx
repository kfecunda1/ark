import { GlassCard } from "@/components/glass-card";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

// Reached only when lib/supabase/proxy.ts's middleware finds
// profiles.must_change_password = true for the signed-in user — set by
// Settings → Users on a new account or a password reset. There is no
// link to this page anywhere in the app's own navigation; the
// middleware redirects here from every other protected route until the
// user changes their password themselves.
export default function ChangePasswordRequiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <GlassCard interactive={false} className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-white">Change your password</h1>
          <p className="mt-1 text-sm text-white/45">
            You&apos;re using a temporary password. Set your own before continuing.
          </p>
        </div>
        <ChangePasswordForm redirectTo="/dashboard" />
      </GlassCard>
    </div>
  );
}
