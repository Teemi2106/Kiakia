"use client";

import { signOutAction } from "@/app/actions/auth";
import { LayoutDashboard, LogOut, Settings, ShoppingBag, UtensilsCrossed, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/dashboard/history", label: "History", icon: ShoppingBag },
  { href: "/dashboard/earnings", label: "Earnings", icon: Wallet },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

export function VendorSidebar({ vendorName }: { vendorName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-raised sm:flex">
      <div className="border-b border-border p-4">
        <p className="text-lg font-semibold text-brand-600">KiaKia</p>
        <p className="truncate text-xs text-ink-muted">{vendorName}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium ${
                active ? "bg-brand-500 text-white" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
              }`}
            >
              <Icon className="size-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <form action={signOutAction} className="border-t border-border p-3">
        <button type="submit" className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-ink-muted hover:text-danger">
          <LogOut className="size-4" />
          Logout
        </button>
      </form>
    </aside>
  );
}
