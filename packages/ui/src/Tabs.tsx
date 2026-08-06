"use client";

import { cn } from "./cn";

export interface TabItem {
  readonly value: string;
  readonly label: string;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly className?: string;
}

/**
 * Horizontal, horizontally-scrollable tab bar with a brand-colored
 * underline on the active tab — matches the KiaKia Figma file's vendor-page
 * category tabs (Rice Dishes / Swallows / Sides / Drinks). Controlled, not
 * routed: the caller owns which value is active (menu category filter,
 * order-status filter, etc.), this component just renders it.
 */
export function Tabs({ items, value, onValueChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn("flex gap-6 overflow-x-auto border-b border-border", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 pb-2 pt-1 text-sm font-medium transition-colors",
              active ? "border-brand-500 text-brand-600" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
