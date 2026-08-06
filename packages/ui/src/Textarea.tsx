import type { TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink outline-none",
        "placeholder:text-ink-muted focus:border-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
