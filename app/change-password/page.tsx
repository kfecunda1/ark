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
    // Not vertically centered with items-center on a fixed min-h-screen
    // (like app/login/page.tsx, which gets away with it — two fields,
    // not three): on mobile Safari/Chrome, 100vh is measured before the
    // on-screen keyboard opens, so centering a form this tall in it can
    // push the submit button below the visible area once the keyboard
    // is up. min-h-dvh tracks the *current* visible viewport on modern
    // mobile browsers, and starting from the top with generous padding
    // (instead of centering) means the button is always reachable by
    // scrolling regardless of keyboard height or viewport-unit quirks.
    <div className="flex min-h-dvh justify-center px-4 py-10">
      <GlassCard interactive={false} className="h-fit w-full max-w-sm p-8">
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
