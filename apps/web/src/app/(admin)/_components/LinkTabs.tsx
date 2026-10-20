import { cn } from "@kiakia/ui";
import Link from "next/link";

export interface LinkTab {
  readonly value: string;
  readonly label: string;
  readonly href: string;
  /** Shown beside the label; omitted when the count is unknown. */
  readonly count?: number;
}

/**
 * Tab bar whose tabs are links, so the active tab lives in the URL and the page
 * stays a Server Component (the client Tabs in @kiakia/ui is state-driven).
 * Same underline styling as Tabs.
 */
export function LinkTabs({ items, value, label }: { items: readonly LinkTab[]; value: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-6 overflow-x-auto border-b border-border">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 pb-2 pt-1 text-sm font-medium transition-colors",
              active ? "border-brand-500 text-brand-600" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="ml-1.5 text-xs text-ink-muted">{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
