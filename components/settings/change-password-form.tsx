"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 12;

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

export function ChangePasswordForm() {
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
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setIsPending(true);
    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setError("Could not determine your account email. Please sign in again.");
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
        setError("Current password is incorrect.");
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

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className={labelClass} htmlFor="current_password">
          Current Password
        </label>
        <input
          id="current_password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="new_password">
          New Password
        </label>
        <input
          id="new_password"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">
          At least {MIN_LENGTH} characters, and different from your current password.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="confirm_password">
          Confirm New Password
        </label>
        <input
          id="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/35">Must match the new password above.</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {success && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Password changed.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
