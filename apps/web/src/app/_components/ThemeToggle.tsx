"use client";

import { cn } from "@kiakia/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { setThemeAction } from "@/app/actions/theme";
import type { Theme } from "@/lib/theme";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeToggle({ theme }: { theme: Theme }) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(theme);

  return (
    <div role="group" aria-label="Theme" className="flex gap-0.5 rounded-control bg-surface-sunken p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={optimistic === value}
          aria-label={label}
          title={label}
          onClick={() =>
            startTransition(async () => {
              setOptimistic(value);
              await setThemeAction(value);
            })
          }
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-[0.5rem] text-ink-muted transition-colors hover:text-ink",
            optimistic === value && "bg-surface-raised text-ink shadow-sm",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
