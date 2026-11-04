"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

// Shared click-to-navigate behavior for ClickableRow and ClickableCard:
// navigates to `href` unless the click landed on a nested interactive
// element (a link, button, or form control), which keeps its own behavior
// instead of also triggering navigation.
export function useClickableNavigate(href: string) {
  const router = useRouter();

  return function handleClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    router.push(href);
  };
}
