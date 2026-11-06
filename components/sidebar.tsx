"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, FolderKanban, History, LayoutDashboard, RotateCcw, StickyNote, Settings, User, X } from "lucide-react";
import { useProjectSection } from "@/components/project-section-context";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/recovery", label: "Recovery Projects", icon: RotateCcw },
  { href: "/receivers", label: "Receivers", icon: Contact },
  { href: "/people", label: "Contacts", icon: User },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { section } = useProjectSection();

  // /projects/[id] (and its /edit) is the one URL for every project
  // regardless of is_recovery, so a plain pathname match can't tell
  // Projects and Recovery Projects apart there — both branches check
  // the *same* "/projects/" prefix and let `section` (set by the
  // detail page itself, see set-project-section.tsx) break the tie.
  // The list pages (/projects, /recovery exactly) are unambiguous on
  // pathname alone and never consult it.
  function isActive(href: string): boolean {
    if (href === "/projects") {
      if (pathname === "/projects") return true;
      if (pathname?.startsWith("/projects/")) return section !== "recovery";
      return false;
    }
    if (href === "/recovery") {
      if (pathname === "/recovery") return true;
      if (pathname?.startsWith("/projects/")) return section === "recovery";
      return false;
    }
    return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/[0.06] bg-[#0a0e17]/95 px-4 py-6 backdrop-blur-2xl transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:bg-[#0a0e17]/40 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <span className="text-lg font-semibold tracking-tight text-white">ARK</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-white/60 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-out ${
                  active
                    ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                    : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <Icon
                  className={`h-[18px] w-[18px] transition-colors duration-150 ease-out ${
                    active ? "text-accent-soft" : "text-white/40 group-hover:text-white/70"
                  }`}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-2 pt-4 text-xs text-white/30">v0.1.0 — stage 1</div>
      </aside>
    </>
  );
}
