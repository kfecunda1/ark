"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmPasswordChanged } from "@/lib/actions/profile";
import { getDictionary, resolveError, type Lang } from "@/lib/i18n";

const MIN_LENGTH = 12;

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

interface ChangePasswordFormProps {
  // Set only by app/change-password/page.tsx's forced first-login
  // screen: once the password is changed, send the user into the app
  // instead of showing the inline success message in place.
  redirectTo?: string;
  lang?: Lang;
}

export function ChangePasswordForm({ redirectTo, lang = "en" }: ChangePasswordFormProps = {}) {
  const router = useRouter();
  const t = getDictionary(lang);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < MIN_LENGTH) {
      setError(t.auth.errorMinLength(MIN_LENGTH));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.auth.errorMismatch);
      return;
    }
    if (newPassword === currentPassword) {
      setError(t.auth.errorSamePassword);
      return;
    }

    setIsPending(true);
    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setError(t.auth.errorNoEmail);
        return;
      }

      // Re-authenticate with the current password before allowing any
      // change — this is the "verify current password" step, and it
      // doubles as the proof that the caller actually knows it, since
      // there's no other way to check a password against Supabase Auth
      // from the client.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        setError(t.auth.errorWrongCurrentPassword);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      const { error: logError } = await supabase.rpc("log_password_change");
      if (logError) {
        // The password itself is already changed — a logging failure
        // shouldn't be reported as if the change failed.
        console.error("[ChangePasswordForm] failed to log password change:", logError.message);
      }

      // Whatever required this change (a forced first-login, or an
      // admin-triggered reset) is only actually satisfied once the
      // server itself confirms the new password works and clears the
      // flag — see lib/actions/profile.ts's confirmPasswordChanged for
      // why this can't be a plain client-side update. A failure here
      // is a real, visible error: the password did change, but the
      // flag didn't clear, so proceeding (redirecting, or claiming
      // success) would be lying to the user about their account state.
      const confirmResult = await confirmPasswordChanged(newPassword);
      if (confirmResult.error) {
        setError(resolveError(confirmResult.error, lang));
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (redirectTo) {
        router.push(`${redirectTo}?passwordChanged=1`);
        router.refresh();
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className={labelClass} htmlFor="current_password">
          {t.auth.currentPassword}
        </label>
        <input
          id="current_password"
          type="password"
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="new_password">
          {t.auth.newPassword}
        </label>
        <input
          id="new_password"
          type="password"
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">{t.auth.newPasswordHint(MIN_LENGTH)}</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="confirm_password">
          {t.auth.confirmNewPassword}
        </label>
        <input
          id="confirm_password"
          type="password"
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">{t.auth.confirmPasswordHint}</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {success && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {t.auth.passwordChangedSuccess}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? t.auth.changingPassword : t.auth.changePasswordButton}
        </button>
      </div>
    </form>
  );
}
