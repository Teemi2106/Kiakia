"use client";

import { cn } from "@kiakia/ui";
import {
  Bike,
  Flag,
  Truck,
  Flame,
  Hourglass,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Landmark,
  Settings,
  ScrollText,
  ShoppingBag,
  Store,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_GROUPS = [
  { heading: null, items: [{ href: "/admin", label: "Overview", Icon: LayoutDashboard }] },
  {
    heading: "Day to day",
    items: [
      { href: "/admin/orders", label: "Orders", Icon: ShoppingBag },
      { href: "/admin/dispatch", label: "Waiting for a rider", Icon: Hourglass },
      { href: "/admin/heatmap", label: "Demand heatmap", Icon: Flame },
      { href: "/admin/flagged-orders", label: "Problems to review", Icon: Flag },
    ],
  },
  {
    heading: "People",
    items: [
      { href: "/admin/customers", label: "Customers", Icon: UserRound },
      { href: "/admin/vendors", label: "Vendors", Icon: Store },
      { href: "/admin/riders", label: "Riders", Icon: Bike },
      { href: "/admin/fleets", label: "Fleets", Icon: Truck },
      { href: "/admin/messages", label: "Messages", Icon: MessageSquare },
    ],
  },
  {
    heading: "Money",
    items: [
      { href: "/admin/payouts", label: "Payouts", Icon: HandCoins },
      { href: "/admin/finance", label: "Finance", Icon: Landmark },
    ],
  },
  {
    heading: "Admin",
    items: [
      { href: "/admin/users", label: "Admins & access", Icon: KeyRound },
      { href: "/admin/settings", label: "Settings", Icon: Settings },
      { href: "/admin/audit", label: "Activity log", Icon: ScrollText },
    ],
  },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-0 md:overflow-visible md:pb-4">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.heading ?? "top"} role="group" aria-label={group.heading ?? undefined} className={cn("flex gap-1 md:flex-col", index > 0 && "md:mt-4")}>
          {group.heading && (
            <p className="hidden px-3 pb-1 text-xs font-medium uppercase tracking-wide text-ink-muted md:block">{group.heading}</p>
          )}
          {group.items.map(({ href, label, Icon }) => {
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
        </div>
      ))}
    </nav>
  );
}
