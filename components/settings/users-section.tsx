"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus } from "lucide-react";
import { addUser, resetUserPassword, setUserActive, setUserRole, type UserRow } from "@/lib/actions/users";
import { generateTemporaryPassword } from "@/lib/password";
import { formatDateTime } from "@/lib/format";
import type { UserRole } from "@/lib/types";

interface UsersSectionProps {
  users: UserRow[];
  // So this user's own row can disable self-deactivation and
  // self-role-change — the server actions refuse those too, but
  // disabling the control is the visible, don't-let-me-shoot-myself
  // version of the same rule.
  currentUserId: string;
}

const fieldClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";
const labelClass = "mb-1.5 block text-xs font-medium text-white/55";

function displayName(user: Pick<UserRow, "full_name" | "email">): string {
  return user.full_name?.trim() || user.email || "User";
}

interface RevealedPassword {
  userLabel: string;
  password: string;
}

function PasswordRevealPanel({ reveal, onDismiss }: { reveal: RevealedPassword; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reveal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable or denied — the value is still right
      // there to select and copy by hand.
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
      <p className="text-sm font-medium text-amber-200">Temporary password for {reveal.userLabel}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md bg-black/30 px-3 py-2 text-sm text-white select-all">
          {reveal.password}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-200/70">Send this separately from the link.</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
      >
        Done
      </button>
    </div>
  );
}

function TempPasswordField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        Temporary Password
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          className={`${fieldClass} flex-1`}
        />
        <button
          type="button"
          onClick={() => onChange(generateTemporaryPassword())}
          className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
        >
          Generate
        </button>
      </div>
      <p className="mt-1.5 text-xs text-white/35">At least 16 characters.</p>
    </div>
  );
}

export function UsersSection({ users, currentUserId }: UsersSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealedPassword | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");
  const [newPassword, setNewPassword] = useState(generateTemporaryPassword());

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);

  function handleAdd() {
    setError(null);
    setReveal(null);
    startTransition(async () => {
      try {
        const result = await addUser(newName, newEmail, newRole, newPassword);
        if (result.error) {
          setError(result.error);
          return;
        }
        setReveal({ userLabel: displayName({ full_name: newName, email: newEmail }), password: newPassword });
        setAdding(false);
        setNewName("");
        setNewEmail("");
        setNewRole("member");
        setNewPassword(generateTemporaryPassword());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  function handleResetPassword(user: UserRow) {
    setError(null);
    setReveal(null);
    setBusyId(user.id);
    startTransition(async () => {
      try {
        const result = await resetUserPassword(user.id, resetPassword);
        if (result.error) {
          setError(result.error);
          return;
        }
        setReveal({ userLabel: displayName(user), password: resetPassword });
        setResettingId(null);
        setResetPassword("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleSetActive(user: UserRow, active: boolean) {
    setError(null);
    setBusyId(user.id);
    startTransition(async () => {
      try {
        const result = await setUserActive(user.id, active);
        if (result.error) {
          setError(result.error);
          return;
        }
        setConfirmingDeactivateId(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleSetRole(user: UserRow, role: UserRole) {
    setError(null);
    setBusyId(user.id);
    startTransition(async () => {
      try {
        const result = await setUserRole(user.id, role);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {reveal && <PasswordRevealPanel reveal={reveal} onDismiss={() => setReveal(null)} />}

      <div className="flex flex-col gap-3">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          const rowBusy = isPending && busyId === user.id;

          return (
            <div key={user.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/85">
                    {displayName(user)}
                    {isSelf && <span className="ml-1.5 text-xs text-white/35">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-white/40">{user.email ?? "—"}</p>
                </div>

                <select
                  aria-label={`Role for ${displayName(user)}`}
                  value={user.role ?? "member"}
                  onChange={(e) => handleSetRole(user, e.target.value as UserRole)}
                  disabled={isSelf || rowBusy}
                  className={`${fieldClass} w-32 shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <option value="member" className="bg-[#0a0e17]">
                    Member
                  </option>
                  <option value="admin" className="bg-[#0a0e17]">
                    Admin
                  </option>
                </select>

                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                    user.active
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                      : "border-red-500/25 bg-red-500/10 text-red-300"
                  }`}
                >
                  {user.active ? "Active" : "Deactivated"}
                </span>

                <span className="shrink-0 text-xs text-white/40">
                  {user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "Never signed in"}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {resettingId === user.id ? (
                  <div className="flex w-full flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 sm:flex-row sm:items-end sm:gap-2">
                    <div className="flex-1">
                      <TempPasswordField
                        id={`reset-password-${user.id}`}
                        value={resetPassword}
                        onChange={setResetPassword}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleResetPassword(user)}
                        disabled={rowBusy}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {rowBusy ? "Resetting…" : "Confirm reset"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResettingId(null);
                          setResetPassword("");
                        }}
                        disabled={rowBusy}
                        className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setResettingId(user.id);
                      setResetPassword(generateTemporaryPassword());
                      setConfirmingDeactivateId(null);
                    }}
                    disabled={rowBusy}
                    className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reset Password
                  </button>
                )}

                {user.active ? (
                  confirmingDeactivateId === user.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSetActive(user, false)}
                        disabled={rowBusy}
                        className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors duration-150 ease-out hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {rowBusy ? "Deactivating…" : "Confirm deactivate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeactivateId(null)}
                        disabled={rowBusy}
                        className="text-xs font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeactivateId(user.id)}
                      disabled={isSelf || rowBusy}
                      className="rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors duration-150 ease-out hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetActive(user, true)}
                    disabled={rowBusy}
                    className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors duration-150 ease-out hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rowBusy ? "Reactivating…" : "Reactivate"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
          <div>
            <label className={labelClass} htmlFor="new_user_name">
              Full Name
            </label>
            <input
              id="new_user_name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new_user_email">
              Email
            </label>
            <input
              id="new_user_email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new_user_role">
              Role
            </label>
            <select
              id="new_user_role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className={fieldClass}
            >
              <option value="member" className="bg-[#0a0e17]">
                Member
              </option>
              <option value="admin" className="bg-[#0a0e17]">
                Admin
              </option>
            </select>
          </div>
          <TempPasswordField id="new_user_password" value={newPassword} onChange={setNewPassword} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create user"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={isPending}
              className="text-sm font-medium text-white/50 transition-colors duration-150 ease-out hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setReveal(null);
            setNewPassword(generateTemporaryPassword());
          }}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add User
        </button>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
    </div>
  );
}
