// app/(customer)/_components/CustomerTopNav.tsx
"use client";

import { ArrowLeftRight, Search, ShoppingCart, Truck, User, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@kiakia/ui";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { selectIsGuest, selectItemCount } from "@/lib/customer/store";
import { switchToVendorAction } from "@/app/actions/session";
import { NotificationsButton } from "@/app/_components/NotificationsButton";
import { AddressPicker } from "./AddressPicker";

// Text-only on desktop; the icon versions of these live in CustomerBottomNav,
// which is what renders below `lg`.
const NAV_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/orders", label: "Orders" },
  { href: "/orders/history", label: "History" },
] as const;

interface CustomerTopNavProps {
  canSwitchToVendor?: boolean;
  /** Shown to accounts that manage a fleet; links to the fleet console. */
  isFleetManager?: boolean;
}

/**
 * Two layouts, one breakpoint: below `lg` the bar stacks into a 56px identity
 * row over an 84px address+search row; at `lg` and up it is a single 72px
 * row. Those heights are fixed on purpose — the bar is
 * `fixed`, so (customer)/layout.tsx offsets <main> by exactly them. The
 * address label comes from the layout's server read via the customer store,
 * so it is there on first paint and the bar never changes height.
 *
 * `lg` rather than `sm` because CustomerBottomNav disappears at the same
 * breakpoint: a tablet gets the stacked bar *and* the tab bar, instead of
 * falling into a gap where the destination links have nowhere to live.
 */
export function CustomerTopNav({ canSwitchToVendor = false, isFleetManager = false }: CustomerTopNavProps) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const itemCount = useCustomerStore(selectItemCount);
  const isGuest = useCustomerStore(selectIsGuest);
  const setCartOpen = useCustomerStore((s) => s.setCartOpen);

  const searchContext = getSearchContext(pathname);

  useEffect(() => {
    setSearchQuery(new URLSearchParams(window.location.search).get("q") ?? "");
  }, [pathname]);

  useEffect(() => {
    let previousY = window.scrollY;
    let compactNow = false;
    let lastDirection = 0;
    let directionDistance = 0;
    const hysteresisPx = 28;

    const transitionCompactState = (next: boolean) => {
      if (next === compactNow) return;
      compactNow = next;
      setCompact(next);
    };

    const onScroll = () => {
      // iOS Safari reports elastic rubber-band movement beyond the document
      // edges. Ignore that overscroll so it can't reverse the header state
      // while the page is being dragged.
      const maxScrollY = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const currentY = Math.min(maxScrollY, Math.max(0, window.scrollY));
      const delta = currentY - previousY;
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      // Main keeps the expanded-header inset while scrolling. Collapse only
      // after the content reaches the compact nav's lower edge, avoiding a
      // blank band below the fixed header near the top of the page.
      if (isDesktop || currentY <= 88) {
        lastDirection = 0;
        directionDistance = 0;
        transitionCompactState(false);
      } else if (Math.abs(delta) > 0) {
        const direction = delta > 0 ? 1 : -1;
        if (direction !== lastDirection) {
          lastDirection = direction;
          directionDistance = 0;
        }
        directionDistance += Math.abs(delta);
        if (!compactNow && direction === 1 && directionDistance >= hysteresisPx) {
          transitionCompactState(true);
          directionDistance = 0;
        } else if (compactNow && direction === -1 && directionDistance >= hysteresisPx) {
          transitionCompactState(false);
          directionDistance = 0;
        }
      }

      previousY = currentY;
    };

    const onResize = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) {
        transitionCompactState(false);
      }
      previousY = window.scrollY;
      lastDirection = 0;
      directionDistance = 0;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <nav data-nav-compact={compact || undefined} className="fixed inset-x-0 top-0 z-40 border-b border-kk-line/50 bg-kk-cream/90 backdrop-blur-xl transition-[background-color]">
      {/* ------------------------------------------------ identity row */}
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] sm:gap-3 sm:px-6 lg:h-18 motion-reduce:transition-none">
        <Link href="/home" style={{ viewTransitionName: "kk-brand" }} className="shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.03] motion-reduce:transition-none">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={270}
            className="h-7 w-auto max-w-none mix-blend-multiply dark:mix-blend-normal lg:h-8"
            preload
          />
        </Link>

        <div className={compact ? "hidden" : "contents"}>
          <AddressPicker />
        </div>

        {searchContext && (
          <form
            action={searchContext.action}
            method="GET"
            aria-hidden={!compact}
            className={cn(
              "min-w-0 overflow-hidden transition-[max-width,opacity,transform,visibility] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden motion-reduce:transition-none",
              compact ? "visible ml-0 max-w-[220px] flex-1 translate-y-0 scale-100 opacity-100" : "invisible pointer-events-none max-w-0 translate-y-1 scale-90 opacity-0",
            )}
          >
            <SearchField placeholder={searchContext.placeholder} compact value={searchQuery} onChange={setSearchQuery} transitionName={compact ? "kk-search" : "none"} />
          </form>
        )}

        {/* Search lives inline on desktop; below lg it moves to its own row. */}
        {searchContext && (
          <form action={searchContext.action} method="GET" className="hidden min-w-0 max-w-md flex-1 lg:block">
            <SearchField placeholder={searchContext.placeholder} value={searchQuery} onChange={setSearchQuery} transitionName="none" />
          </form>
        )}
        {!searchContext && <div aria-hidden="true" className="hidden min-w-0 flex-1 lg:block" />}

        <div className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 font-inter text-sm transition-colors",
                  isActive
                    ? "bg-kk-red/10 font-bold text-kk-red-ink"
                    : "font-medium text-kk-cocoa hover:bg-black/5 hover:text-kk-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <span aria-hidden="true" className="hidden h-6 w-px bg-kk-line/70 lg:block" />

        <div style={{ viewTransitionName: "kk-actions" }} className="ml-auto flex items-center gap-0.5 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:ml-0 lg:gap-1 motion-reduce:transition-none">
          {isFleetManager && (
            <Link
              href="/fleet"
              className="flex items-center gap-1.5 rounded-full p-2.5 font-inter text-xs font-medium text-kk-cocoa transition-colors hover:bg-black/5 hover:text-kk-ink xl:px-3.5"
              aria-label="Open fleet dashboard"
              title="Open fleet dashboard"
            >
              <Truck className="size-[18px]" />
              <span className="hidden xl:inline">Fleet</span>
            </Link>
          )}
          {canSwitchToVendor && (
            <form action={switchToVendorAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full p-2.5 font-inter text-xs font-medium text-kk-cocoa transition-colors hover:bg-black/5 hover:text-kk-ink xl:px-3.5"
                aria-label="Switch to vendor dashboard"
                title="Switch to vendor dashboard"
              >
                <ArrowLeftRight className="size-[18px]" />
                <span className="hidden xl:inline">Vendor</span>
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative rounded-full p-2.5 text-kk-cocoa transition-colors hover:bg-black/5 hover:text-kk-ink"
            aria-label={`Cart${itemCount > 0 ? `, ${itemCount} ${itemCount === 1 ? "item" : "items"}` : ""}`}
          >
            <ShoppingCart className="size-[18px]" />
            {itemCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-kk-red px-1 font-inter text-[10px] font-bold text-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </button>

          {isGuest ? (
            <div className="ml-1 flex items-center gap-1.5">
              <Link
                href="/login"
                className="rounded-full px-3 py-2 font-inter text-sm font-semibold text-kk-ink transition-colors hover:bg-black/5"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="hidden rounded-full bg-kk-red px-4 py-2 font-inter text-sm font-semibold text-white transition-colors hover:bg-kk-red/90 sm:block"
              >
                Sign up
              </Link>
            </div>
          ) : (
            <>
              <Link
                href="/profile/wallet"
                aria-label="Your wallet"
                title="Your wallet"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-kk-cocoa transition-colors hover:bg-black/5 hover:text-kk-red-ink"
              >
                <Wallet className="size-[18px]" />
              </Link>
              <NotificationsButton audience="customer" />

              <Link
                href="/profile"
                aria-label="Your profile"
                className="hidden size-9 items-center justify-center rounded-full border border-kk-line bg-kk-card text-kk-cocoa transition-colors hover:border-kk-red/50 hover:text-kk-red-ink lg:flex"
              >
                <User className="size-[18px]" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* -------------------------------------- address + search row */}
      <div className={cn(
        "flex flex-col justify-center gap-2 overflow-hidden px-4 transition-[height,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-6 lg:hidden motion-reduce:transition-none",
        compact ? "h-0 opacity-0" : "h-21 opacity-100",
      )} inert={compact}>
        <AddressPicker compact />
        {searchContext && (
          <form
            action={searchContext.action}
            method="GET"
            aria-hidden={compact}
            className={cn(
              "transition-[opacity,transform,visibility] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              compact ? "invisible pointer-events-none -translate-y-2 scale-[0.98] opacity-0" : "visible translate-y-0 scale-100 opacity-100",
            )}
          >
            <SearchField placeholder={searchContext.placeholder} value={searchQuery} onChange={setSearchQuery} transitionName={compact ? "none" : "kk-search"} />
          </form>
        )}
      </div>
    </nav>
  );
}

function SearchField({
  placeholder,
  compact = false,
  value,
  onChange,
  transitionName = "none",
}: {
  placeholder: string;
  compact?: boolean;
  value: string;
  onChange: (value: string) => void;
  transitionName?: string;
}) {
  return (
    <div className="relative" style={{ viewTransitionName: transitionName }}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-kk-cocoa/70" />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-2xl border border-kk-line/70 bg-kk-card font-inter text-sm text-kk-ink placeholder:text-kk-cocoa/60 transition-[height,padding,border-radius,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20 motion-reduce:transition-none",
          compact ? "h-9 rounded-xl pl-9 pr-2 text-xs" : "h-11 pl-11 pr-3 lg:h-10",
        )}
        aria-label={placeholder}
      />
    </div>
  );
}

function getSearchContext(pathname: string): { action: string; placeholder: string } | null {
  if (pathname === "/home" || pathname === "/cart") {
    return { action: "/home", placeholder: "Search food, category or vendor…" };
  }
  if (pathname === "/orders/history") {
    return { action: pathname, placeholder: "Search your order history…" };
  }
  if (pathname === "/orders" || pathname.startsWith("/orders/")) {
    return { action: "/orders", placeholder: "Search your active orders…" };
  }
  if (pathname === "/profile") {
    return { action: pathname, placeholder: "Search profile and help…" };
  }
  return null;
}
