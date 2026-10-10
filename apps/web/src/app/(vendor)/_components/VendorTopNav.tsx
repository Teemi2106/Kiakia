// app/(vendor)/_components/VendorTopNav.tsx
"use client";

import { ArrowLeftRight, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { switchToCustomerAction } from "@/app/actions/session";
import { NotificationsButton } from "@/app/_components/NotificationsButton";

// Map paths to display names
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/orders": "Orders",
  "/menu": "Menu Management",
  "/earnings": "Earnings",
  "/history": "Order History",
  "/settings": "Store Settings",
};

export function VendorTopNav({ vendorId }: { vendorId: string | null }) {
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
    // `sm:left-64`/`sm:w-[calc(100%-256px)]` must match VendorSidebar's
    // rendered width (w-64 = 256px) AND its visibility breakpoint (`sm:flex`)
    // — this nav is position:fixed so it escapes the flex layout that
    // otherwise auto-offsets the main content column from the sidebar.
    // Previously this was `md:left-64` against a `sm:flex` w-56 sidebar,
    // which overlapped the sidebar between the sm/md breakpoints and left a
    // 32px gap above md — keep both in sync if either changes.
    <nav className="fixed left-0 top-0 z-40 w-full border-b border-[#E4BEB8] bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] sm:left-64 sm:w-[calc(100%-256px)]">
      <div className="flex h-14 items-center justify-between px-4 sm:h-[63px] sm:px-6">
        {/* Left Section - Title */}
        <div className="flex items-center gap-2">
          <h1 className="font-sora text-xl font-bold text-[#1C1B1B] sm:text-2xl">
            {pageTitle}
          </h1>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Switch back to customer mode */}
          <form action={switchToCustomerAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-medium text-[#5B403C] transition-colors hover:bg-[#FCF9F8] hover:text-[#1C1B1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40 sm:px-3"
              aria-label="Switch to customer view"
              title="Switch to customer view"
            >
              <ArrowLeftRight className="size-4" />
              <span className="hidden sm:inline">Customer view</span>
            </button>
          </form>

          {/* Notifications. Rendered only with a vendor in context — without
              one there is no feed to read. Until 0049 this was a bare
              <button> with no handler and a permanently-lit red dot, so it
              both did nothing and claimed unread activity that did not
              exist. */}
          {vendorId && (
            <NotificationsButton
              audience="vendor"
              vendorId={vendorId}
              buttonClassName="relative rounded-full p-2 transition-colors hover:bg-[#FCF9F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40"
              iconClassName="size-5 text-[#5B403C]"
              emptyMessage="Nothing here yet — new orders and delivery updates will show up as they happen."
            />
          )}

          {/* Profile Avatar - vendor mode has no /profile route (customer-only); store settings is the equivalent here */}
          <Link
            href="/dashboard/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E5E2E1] transition-colors hover:border-[#B61913] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40 sm:h-10 sm:w-10"
          >
            <User className="size-4 text-[#5B403C] sm:size-5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
