"use client";

import { BottomNav, type BottomNavItem } from "@kiakia/ui";
import {
  LayoutDashboard,
  Settings,
  ShoppingBag,
  UtensilsCrossed,
  Wallet,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: readonly BottomNavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    icon: <LayoutDashboard className="size-5" />,
  },
  {
    href: "/dashboard/orders",
    label: "Orders",
    icon: <ShoppingBag className="size-5" />,
  },
  {
    href: "/dashboard/menu",
    label: "Menu",
    icon: <UtensilsCrossed className="size-5" />,
  },
  {
    href: "/dashboard/history",
    label: "History",
    icon: <Clock className="size-5" />,
  },
  {
    href: "/dashboard/earnings",
    label: "Money",
    icon: <Wallet className="size-5" />,
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <Settings className="size-5" />,
  },
];

export function VendorBottomNav() {
  const pathname = usePathname();
  return (
    <div className="sm:hidden">
      <BottomNav items={ITEMS} activeHref={pathname} LinkComponent={Link} />
    </div>
  );
}
