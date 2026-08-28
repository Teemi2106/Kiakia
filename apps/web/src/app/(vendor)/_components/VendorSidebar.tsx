"use client";

import { signOutAction } from "@/app/actions/auth";
import {
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingBag,
  Store,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/dashboard/earnings", label: "Earnings", icon: Wallet },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

const STATUS_LABEL: Record<string, string> = {
  active: "Live",
  pending: "Pending review",
  suspended: "Suspended",
};

interface VendorSidebarProps {
  vendorName: string;
  bannerUrl?: string | null;
  status?: string;
}

/**
 * Fixed-width in-flow flex item (NOT position:fixed) — the main content
 * column offsets from it automatically via flexbox in (vendor)/layout.tsx.
 * VendorTopNav, however, IS position:fixed and has to manually match this
 * width (`sm:left-64`) and breakpoint (`sm:`) since fixed elements escape
 * the flex flow — keep those two in sync if this width or breakpoint ever
 * changes.
 */
export function VendorSidebar({ vendorName, bannerUrl, status }: VendorSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#E4BEB8] bg-white sm:flex">
      <div className="border-b border-[#E4BEB8] p-4">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#B61913] font-sora text-sm font-bold text-white">
            K
          </span>
          <span className="font-sora text-lg font-bold text-[#1C1B1B]">KiaKia</span>
        </Link>

        {/* Store identity — surfaces the vendor's own banner image (§ redesign brief) */}
        <div className="relative h-20 w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#B61913] to-[#7A0F0A]">
          {bannerUrl ? (
            <Image src={bannerUrl} alt="" fill className="object-cover" />
          ) : (
            <Store className="absolute right-3 top-3 size-8 text-white/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="relative flex h-full flex-col justify-end p-3">
            <p className="truncate font-sora text-sm font-bold text-white">{vendorName}</p>
            {status && (
              <span className="mt-1 w-fit rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                {STATUS_LABEL[status] ?? status}
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-[#B61913] text-white shadow-sm shadow-[#B61913]/30"
                  : "text-[#5B403C] hover:bg-[#FCF9F8] hover:text-[#1C1B1B]"
              }`}
            >
              <Icon className="size-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <form action={signOutAction} className="border-t border-[#E4BEB8] p-3">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#5B403C] transition-colors hover:bg-[#B61913]/10 hover:text-[#B61913]"
        >
          <LogOut className="size-4" />
          Logout
        </button>
      </form>
    </aside>
  );
}
