"use client";

import { Menu, Bell, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GlobalSearch } from "@/components/global-search";

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/[0.06] bg-[#080b12]/70 px-4 backdrop-blur-xl sm:px-6">
      <button
        onClick={onMenuClick}
        aria-label="Open menu"
        className="rounded-lg p-2 text-white/60 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <GlobalSearch />

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
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-sky-500" />
      </div>
    </header>
  );
}
