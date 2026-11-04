import { HTMLAttributes } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function GlassCard({ className = "", interactive = true, ...props }: GlassCardProps) {
  return (
    <div
      className={`glass-panel ${interactive ? "glass-panel-interactive" : ""} rounded-2xl ${className}`}
      {...props}
    />
  );
}
