"use client";

import { Menu, Bell, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GlobalSearch } from "@/components/global-search";

interface TopBarProps {
  onMenuClick: () => void;
  showRecovery: boolean;
}

export function TopBar({ onMenuClick, showRecovery }: TopBarProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className="sticky top-0 z-30 flex min-h-16 items-center gap-4 border-b border-white/[0.06] bg-[#080b12]/70 pb-2 backdrop-blur-xl pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
    >
      <div className="flex items-center gap-2 lg:hidden">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-lg p-2 text-white/60 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ark-mark.svg" alt="ARK" width={28} height={28} className="h-7 w-7 shrink-0 rounded-md" />
      </div>

      <GlobalSearch showRecovery={showRecovery} />

      <div className="ml-auto flex items-center gap-2">
        <button
          aria-label="Notifications"
          className="rounded-lg p-2 text-white/60 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white"
        >
          <Bell className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={handleLogout}
          aria-label="Log out"
          title="Log out"
          className="rounded-lg p-2 text-white/60 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent to-silver" />
      </div>
    </header>
  );
}
