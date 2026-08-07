// app/(auth)/customer/_components/CustomerTopNav.tsx
"use client";

import {
  Bell,
  ShoppingCart,
  Search,
  User,
  Home,
  ClipboardList,
  History,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@kiakia/ui";

const NAV_LINKS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/orders/history", label: "History", icon: History },
] as const;

export function CustomerTopNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 z-50 w-full bg-[#FCF9F8] shadow-[0px_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex h-14 items-center justify-between px-4 sm:h-[63px] sm:px-6">
        {/* Logo */}
        <Link href="/home" className="shrink-0">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={93}
            height={47}
            className="h-10 w-auto sm:h-[47px]"
            priority
          />
        </Link>

        {/* Desktop Navigation Links (hidden on mobile) */}
        <div className="hidden items-center gap-6 sm:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "font-inter text-sm leading-5 tracking-[0.14px]",
                  isActive
                    ? "border-b-2 border-[#E23B2E] font-bold text-[#E23B2E]"
                    : "rounded-full px-3 py-1 font-medium text-[#5B403C] hover:bg-black/5",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Search Bar - Desktop */}
        <div className="hidden flex-1 max-w-[448px] sm:block">
          <form action="/home" method="GET" className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-[#5B403C]" />
              <input
                type="search"
                name="q"
                placeholder="Search for food, restaurants..."
                className="h-[38px] w-full rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] pl-10 pr-3 font-inter text-sm text-[#5B403C] placeholder:text-[#5B403C] focus:border-[#E23B2E] focus:outline-none focus:ring-2 focus:ring-[#E23B2E]/20"
              />
            </div>
          </form>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Search - Mobile (icon only) */}
          <Link
            href="/home?q="
            className="rounded-full p-2 hover:bg-black/5 sm:hidden"
            aria-label="Search"
          >
            <Search className="size-5 text-[#5B403C]" />
          </Link>

          {/* Cart */}
          <Link
            href="/cart"
            className="rounded-full p-2 hover:bg-black/5"
            aria-label="Cart"
          >
            <ShoppingCart className="size-5 text-[#5B403C] sm:size-[19.98px]" />
          </Link>

          {/* Notifications */}
          <button
            className="relative rounded-full p-2 hover:bg-black/5"
            aria-label="Notifications"
          >
            <Bell className="size-5 text-[#5B403C] sm:size-4" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-[#B61913] sm:right-1.5 sm:top-1.5 sm:size-2" />
          </button>

          {/* Profile Avatar */}
          <Link
            href="/profile"
            className="hidden h-10 w-10 items-center justify-center rounded-full border-2 border-[#E5E2E1] hover:border-[#E23B2E] sm:flex"
          >
            <User className="size-5 text-[#5B403C]" />
          </Link>
        </div>
      </div>

      {/* Mobile Search Bar (below nav) */}
      <div className="border-t border-[#E5E2E1] bg-[#FCF9F8] px-4 py-3 sm:hidden">
        <form action="/home" method="GET" className="relative">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-[#5B403C]" />
            <input
              type="search"
              name="q"
              placeholder="What are you craving?"
              className="h-12 w-full rounded-xl border border-[rgba(228,190,184,0.3)] bg-[#F0EDED] pl-10 pr-3 font-inter text-base text-[#5B403C] placeholder:text-[#6B7280] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] focus:border-[#E23B2E] focus:outline-none focus:ring-2 focus:ring-[#E23B2E]/20"
            />
          </div>
        </form>
      </div>
    </nav>
  );
}
