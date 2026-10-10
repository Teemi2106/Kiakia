"use client";

import { cn } from "@kiakia/ui";
import {
  Bike,
  Flag,
  LayoutDashboard,
  Settings,
  ScrollText,
  ShoppingBag,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", Icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", Icon: ShoppingBag },
  { href: "/admin/vendors", label: "Vendors", Icon: Store },
  { href: "/admin/riders", label: "Riders", Icon: Bike },
  { href: "/admin/users", label: "Users", Icon: Users },
  { href: "/admin/finance", label: "Finance", Icon: Wallet },
  { href: "/admin/settings", label: "Settings", Icon: Settings },
  { href: "/admin/audit", label: "Audit log", Icon: ScrollText },
  { href: "/admin/flagged-orders", label: "Flagged orders", Icon: Flag },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-4">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
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
