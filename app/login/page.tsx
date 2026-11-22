"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/glass-card";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useBrowserLang } from "@/lib/i18n/use-browser-lang";

async function ensureProfile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  email: string | null
) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) return;

  await supabase.from("profiles").insert({
    id: userId,
    email,
    full_name: null,
    role: null,
  });
}

export default function LoginPage() {
  const router = useRouter();
  const lang = useBrowserLang();
  const t = getDictionary(lang);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? t.auth.unableToSignIn);
      setLoading(false);
      return;
    }

    await ensureProfile(supabase, data.user.id, data.user.email ?? null);

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))]">
      <GlassCard interactive={false} className="w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/ark-mark.svg" alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-[12px]" />
            <h1 className="font-wordmark text-xl font-semibold tracking-[4px] text-[#e6ebf0]">ARK</h1>
          </div>
          <p className="text-sm text-white/45">{t.auth.signInSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-white/55">
              {t.auth.email}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-white/55">
              {t.auth.password}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t.auth.signingIn : t.auth.signIn}
          </button>
        </form>
      </GlassCard>
    </div>
  );
}
