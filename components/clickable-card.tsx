"use client";

import type { ReactNode } from "react";
import { GlassCard } from "@/components/glass-card";
import { useClickableNavigate } from "@/lib/use-clickable-navigate";

interface ClickableCardProps {
  href: string;
  className?: string;
  children: ReactNode;
}

// Mobile-card counterpart to ClickableRow — a GlassCard that navigates to
// `href` on click, except when the click landed on a nested interactive
// element (a link, button, or form control).
export function ClickableCard({ href, className = "", children }: ClickableCardProps) {
  const handleClick = useClickableNavigate(href);

  return (
    <GlassCard onClick={handleClick} className={`group cursor-pointer p-4 ${className}`}>
      {children}
    </GlassCard>
  );
}
