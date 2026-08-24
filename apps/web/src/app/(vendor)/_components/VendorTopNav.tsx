// app/(vendor)/_components/VendorTopNav.tsx
"use client";

import { Bell, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Map paths to display names
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/orders": "Orders",
  "/menu": "Menu Management",
  "/earnings": "Earnings",
  "/history": "Order History",
  "/settings": "Store Settings",
};

interface VendorTopNavProps {
  onMenuClick?: () => void;
}

export function VendorTopNav({ onMenuClick }: VendorTopNavProps) {
  const pathname = usePathname();

  // Get the current page title
  const getPageTitle = () => {
    if (PAGE_TITLES[pathname]) {
      return PAGE_TITLES[pathname];
    }

    for (const [path, title] of Object.entries(PAGE_TITLES)) {
      if (pathname.startsWith(path) && path !== "/") {
        return title;
      }
    }

    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment
      ? lastSegment.charAt(0).toUpperCase() +
          lastSegment.slice(1).replace(/-/g, " ")
      : "Dashboard";
  };

  const pageTitle = getPageTitle();

  return (
    <nav className="fixed left-3 top-0 z-40 w-full bg-surface shadow-[0px_1px_2px_rgba(0,0,0,0.05)] md:left-64 md:w-[calc(100%-256px)]">
      <div className="flex h-14 items-center justify-between px-4 sm:h-[63px] sm:px-6">
        {/* Left Section - Title */}
        <div className="flex items-center gap-2">
          <h1 className="font-sora text-xl font-bold text-[#1C1B1B] sm:text-2xl">
            {pageTitle}
          </h1>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Notifications */}
          <button
            className="relative rounded-full p-2 hover:bg-black/5"
            aria-label="Notifications"
          >
            <Bell className="size-5 text-[#5B403C] sm:size-5" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-[#B61913]" />
          </button>

          {/* Profile Avatar */}
          <Link
            href="/profile"
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E5E2E1] hover:border-[#E23B2E] sm:h-10 sm:w-10"
          >
            <User className="size-4 text-[#5B403C] sm:size-5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
