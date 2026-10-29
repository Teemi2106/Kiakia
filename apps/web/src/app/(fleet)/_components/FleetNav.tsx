"use client";

import { cn } from "@kiakia/ui";
import { Bike, Map } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/fleet", label: "Riders", Icon: Bike },
  { href: "/fleet/map", label: "Map & demand", Icon: Map },
] as const;

export function FleetNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Fleet" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-4">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = href === "/fleet" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
