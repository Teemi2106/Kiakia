"use client";

import {
  Bell,
  Search,
  ShoppingCart,
  User,
  Home,
  ClipboardList,
  History,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function VendorTopNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed top-0 z-40 w-full bg-[#FCF9F8] shadow-[0px_1px_2px_rgba(0,0,0,0.05)]">
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
        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
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
            className="h-10 w-10 items-center justify-center rounded-full border-2 border-[#E5E2E1] hover:border-[#E23B2E] sm:flex"
          >
            <User className="size-5 text-[#5B403C]" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
