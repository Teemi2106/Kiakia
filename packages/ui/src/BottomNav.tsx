// packages/ui/src/BottomNav.tsx
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

const DefaultLink: ComponentType<LinkComponentProps> = ({
  href,
  className,
  children,
}) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** Fixed bottom tab bar — Home/Orders/History/Profile, pill-highlighted active tab (Figma Customer Home). */
export function BottomNav({
  items,
  activeHref,
  LinkComponent = DefaultLink,
}: BottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex h-16 items-center bg-[#F0EDED] px-[18.75px] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] rounded-t-xl pb-[env(safe-area-inset-bottom)]">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <LinkComponent
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center transition-all",
              active
                ? "h-11 rounded-full bg-[#FE8E27] px-4 py-1"
                : "h-[38px] px-2 py-0",
            )}
          >
            <span
              className={cn(
                "flex items-center justify-center",
                active ? "text-[#653200]" : "text-[#5B403C]",
              )}
            >
              {item.icon}
            </span>
            <span
              className={cn(
                "text-xs font-medium leading-4",
                active ? "text-[#653200]" : "text-[#5B403C]",
              )}
            >
              {item.label}
            </span>
          </LinkComponent>
        );
      })}
    </nav>
  );
}
