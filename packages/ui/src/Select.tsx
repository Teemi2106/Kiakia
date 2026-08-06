import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 rounded-control border border-border bg-surface px-3 text-sm text-ink outline-none",
        "focus:border-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
