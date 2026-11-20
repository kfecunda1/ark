"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { ProjectSectionProvider } from "@/components/project-section-context";

interface AppShellProps {
  children: React.ReactNode;
  inboxNewCount: number;
  showRecovery: boolean;
  isAdmin: boolean;
}

export function AppShell({ children, inboxNewCount, showRecovery, isAdmin }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <ProjectSectionProvider>
      <div className="relative flex min-h-screen">
        <Sidebar
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          inboxNewCount={inboxNewCount}
          showRecovery={showRecovery}
          isAdmin={isAdmin}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} showRecovery={showRecovery} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </ProjectSectionProvider>
  );
}
