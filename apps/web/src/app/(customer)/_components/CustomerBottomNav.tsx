// app/(auth)/customer/_components/CustomerBottomNav.tsx
"use client";

import { BottomNav, type BottomNavItem } from "@kiakia/ui";
import { ClipboardList, History, Home, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: readonly BottomNavItem[] = [
  { href: "/home", label: "Home", icon: <Home className="size-5" /> },
  {
    href: "/orders",
    label: "Orders",
    icon: <ClipboardList className="size-5" />,
  },
  {
    href: "/orders/history",
    label: "History",
    icon: <History className="size-5" />,
  },
  { href: "/profile", label: "Profile", icon: <User className="size-5" /> },
];

export function CustomerBottomNav() {
  const pathname = usePathname();

  // `lg`, not `sm`: CustomerTopNav only grows its own destination links at
  // `lg`, so a tablet would otherwise have no way to reach Orders/History.
  return (
    <div className="block lg:hidden">
      <BottomNav items={ITEMS} activeHref={pathname} LinkComponent={Link} />
    </div>
  );
}
