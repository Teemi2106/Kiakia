// app/(customer)/_components/CustomerTopNav.tsx
"use client";

import { ArrowLeftRight, ChevronRight, MapPin, Search, ShoppingCart, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@kiakia/ui";
import { useCart } from "../cart/_components/CartProvider";
import { switchToVendorAction } from "@/app/actions/session";
import { createClient } from "@/lib/supabase/client";
import { NotificationsButton } from "./NotificationsButton";

// Text-only on desktop; the icon versions of these live in CustomerBottomNav,
// which is what renders below `lg`.
const NAV_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/orders", label: "Orders" },
  { href: "/orders/history", label: "History" },
] as const;

interface CustomerTopNavProps {
  canSwitchToVendor?: boolean;
}

/**
 * Default delivery address, read-only display for the top nav. Fetched
 * client-side (browser Supabase client, RLS-scoped) rather than threaded
 * through the server layout — same "read-only, cacheable" case
 * lib/supabase/client.ts calls out, and keeps this change contained to this
 * component instead of touching (customer)/layout.tsx.
 */
function useDefaultAddressLabel() {
  const [label, setLabel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadDefaultAddress() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoaded(true);
        return;
      }

      const { data } = await supabase
        .from("addresses")
        .select("label, line1")
        .eq("customer_id", user.id)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        setLabel(data ? data.label || data.line1 : null);
        setLoaded(true);
      }
    }

    void loadDefaultAddress();
    return () => {
      cancelled = true;
    };
  }, []);

  return { label, loaded };
}

/**
 * Two layouts, one breakpoint: below `lg` the bar stacks into a 56px identity
 * row over an 84px address+search row; at `lg` and up it is a single 72px
 * row. Those heights are fixed on purpose — the bar is
 * `fixed`, so (customer)/layout.tsx offsets <main> by exactly them. Anything
 * that can change this bar's height (the address line, in particular) has to
 * reserve its space even while it is still loading, or every customer page
 * jumps once the address resolves.
 *
 * `lg` rather than `sm` because CustomerBottomNav disappears at the same
 * breakpoint: a tablet gets the stacked bar *and* the tab bar, instead of
 * falling into a gap where the destination links have nowhere to live.
 */
export function CustomerTopNav({ canSwitchToVendor = false }: CustomerTopNavProps) {
  const pathname = usePathname();
  const { openCart, itemCount } = useCart();
  const { label: defaultAddressLabel, loaded: addressLoaded } = useDefaultAddressLabel();

  return (
    <nav className="fixed inset-x-0 top-0 z-40 border-b border-kk-line/50 bg-kk-cream/85 backdrop-blur-xl">
      {/* ------------------------------------------------ identity row */}
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-18">
        <Link href="/home" className="shrink-0 transition-transform duration-300 hover:scale-[1.03]">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={247}
            className="h-7 w-auto mix-blend-multiply lg:h-8"
            preload
          />
        </Link>

        <AddressPill
          className="ml-1 hidden xl:flex"
          label={defaultAddressLabel}
          loaded={addressLoaded}
        />

        {/* Search lives inline on desktop; below lg it moves to its own row. */}
        <form action="/home" method="GET" className="hidden min-w-0 flex-1 lg:block">
          <SearchField placeholder="Search for a dish or a vendor…" />
        </form>

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
                    ? "bg-kk-red/10 font-bold text-kk-red"
                    : "font-medium text-kk-cocoa hover:bg-black/5 hover:text-kk-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <span aria-hidden="true" className="hidden h-6 w-px bg-kk-line/70 lg:block" />

        <div className="ml-auto flex items-center gap-0.5 lg:ml-0 lg:gap-1">
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
            onClick={openCart}
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

          <NotificationsButton />

          <Link
            href="/profile"
            aria-label="Your profile"
            className="hidden size-9 items-center justify-center rounded-full border border-kk-line bg-white text-kk-cocoa transition-colors hover:border-kk-red/50 hover:text-kk-red lg:flex"
          >
            <User className="size-[18px]" />
          </Link>
        </div>
      </div>

      {/* -------------------------------------- address + search row */}
      <div className="flex h-21 flex-col justify-center gap-2 px-4 sm:px-6 lg:hidden">
        <AddressPill label={defaultAddressLabel} loaded={addressLoaded} compact />
        <form action="/home" method="GET">
          <SearchField placeholder="What are you craving?" />
        </form>
      </div>
    </nav>
  );
}

function SearchField({ placeholder }: { placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-kk-cocoa/70" />
      <input
        type="search"
        name="q"
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl border border-kk-line/70 bg-white pl-11 pr-3 font-inter text-sm text-kk-ink placeholder:text-kk-cocoa/60 transition-colors focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20 lg:h-10"
      />
    </div>
  );
}

/**
 * Renders a fixed-height skeleton rather than nothing while the address is
 * still loading — this sits inside the bar whose height the page layout is
 * hard-offset against.
 */
function AddressPill({
  label,
  loaded,
  compact,
  className,
}: {
  label: string | null;
  loaded: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!loaded) {
    return (
      <span
        className={cn(
          "h-4 w-40 animate-pulse rounded-full bg-kk-line/50",
          compact ? "block" : "shrink-0",
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  if (compact) {
    return (
      <Link href="/profile/addresses" className="flex items-center gap-1.5">
        <MapPin className="size-3.5 shrink-0 text-kk-red" />
        <span className="truncate font-inter text-xs text-kk-cocoa">
          {label ? (
            <>
              Deliver to <span className="font-semibold text-kk-ink">{label}</span>
            </>
          ) : (
            <span className="font-semibold text-kk-red">Set a delivery address</span>
          )}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-kk-cocoa" />
      </Link>
    );
  }

  return (
    <Link
      href="/profile/addresses"
      className={cn(
        "shrink-0 items-center gap-2 rounded-full border border-kk-line/70 bg-white/70 py-1.5 pl-3 pr-2.5 transition-colors hover:border-kk-red/40 hover:bg-white",
        className,
      )}
      title={label ? `Delivering to ${label}` : "Set delivery address"}
    >
      <MapPin className="size-4 shrink-0 text-kk-red" />
      <span className="flex flex-col leading-tight">
        <span className="font-inter text-[10px] font-medium uppercase tracking-wide text-kk-cocoa/70">
          Deliver to
        </span>
        <span className="max-w-[140px] truncate font-inter text-xs font-semibold text-kk-ink">
          {label ?? "Set address"}
        </span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-kk-cocoa" />
    </Link>
  );
}
