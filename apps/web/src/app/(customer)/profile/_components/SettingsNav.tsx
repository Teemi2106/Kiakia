// app/(customer)/profile/_components/SettingsNav.tsx
"use client";

import { ChevronRight, MapPin, Settings, Wallet } from "lucide-react";
import Link from "next/link";

// Only links to pages that actually exist. Payment Methods and
// Notifications were removed — there's no saved-payment-method or
// notification-preferences feature in this release.
const SETTINGS_LINKS = [
  {
    href: "/profile/wallet",
    label: "Wallet",
    icon: Wallet,
    description: "Refunds from cancelled orders, ready to spend",
  },
  {
    href: "/profile/addresses",
    label: "Saved Addresses",
    icon: MapPin,
    description: "Manage your delivery addresses",
  },
  {
    href: "/profile/settings",
    label: "Account Settings",
    icon: Settings,
    description: "Manage your account preferences",
  },
] as const;

export function SettingsNav() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E2E1] bg-white shadow-sm">
      {SETTINGS_LINKS.map((link, index) => (
        <Link
          key={link.href}
          href={link.href}
          className={`flex items-center justify-between px-4 py-4 transition-colors hover:bg-[#FCF9F8] ${
            index < SETTINGS_LINKS.length - 1 ? "border-b border-[#E5E2E1]" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-5 w-5 items-center justify-center text-[#5B403C]">
              <link.icon className="size-5" />
            </div>
            <div>
              <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                {link.label}
              </span>
              <p className="font-inter text-xs text-[#5B403C]">
                {link.description}
              </p>
            </div>
          </div>
          <ChevronRight className="size-4 text-[#5B403C]" />
        </Link>
      ))}
    </div>
  );
}
