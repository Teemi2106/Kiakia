import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn";

export interface BottomNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export interface LinkComponentProps {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export interface BottomNavProps {
  readonly items: readonly BottomNavItem[];
  readonly activeHref: string;
  /**
   * Deliberately not hard-wired to `next/link` — `packages/ui` is meant to
   * be shared with the rider app too (§6 of the architecture doc), which
   * isn't Next.js. Pass `next/link`'s `Link` here from apps/web for
   * prefetching/transitions; defaults to a plain `<a>` otherwise.
   */
  readonly LinkComponent?: ComponentType<LinkComponentProps>;
}

const DefaultLink: ComponentType<LinkComponentProps> = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** Fixed bottom tab bar — Home/Orders/History/Profile, pill-highlighted active tab (Figma Customer Home). */
export function BottomNav({ items, activeHref, LinkComponent = DefaultLink }: BottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)]">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <LinkComponent
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium",
              active ? "text-brand-600" : "text-ink-muted",
            )}
          >
            <span className={cn("flex size-8 items-center justify-center rounded-pill", active && "bg-brand-100")}>
              {item.icon}
            </span>
            {item.label}
          </LinkComponent>
        );
      })}
    </nav>
  );
}
