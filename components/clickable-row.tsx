"use client";

import type { ReactNode } from "react";
import { useClickableNavigate } from "@/lib/use-clickable-navigate";

interface ClickableRowProps {
  href: string;
  className?: string;
  children: ReactNode;
}

// A <tr> that navigates to `href` on click, except when the click landed on
// a nested interactive element (a link, button, or form control) — those
// keep handling their own click instead of also triggering row navigation.
// Also carries the "group" class so cell content can use group-hover
// variants to match the row's hover state.
export function ClickableRow({ href, className = "", children }: ClickableRowProps) {
  const handleClick = useClickableNavigate(href);

  return (
    <tr onClick={handleClick} className={`group cursor-pointer ${className}`}>
      {children}
    </tr>
  );
}
