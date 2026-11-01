// app/(customer)/profile/_components/MobileSettings.tsx
"use client";

import { ChevronRight, MapPin, Settings } from "lucide-react";
import Link from "next/link";

interface Address {
  readonly id: string;
  readonly label: string | null;
  readonly line1: string;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly is_default: boolean;
}

interface MobileSettingsProps {
  addresses: readonly Address[];
}

// Only links to pages that actually exist. Payment Methods and
// Notifications were removed — there's no saved-payment-method or
// notification-preferences feature in this release, and a link to a
// non-existent page is worse than no link at all.
const SETTINGS_ITEMS_BASE = [
  {
    href: "/profile/addresses",
    label: "Saved Addresses",
    description: "",
    icon: MapPin,
  },
  {
    href: "/profile/settings",
    label: "Account Settings",
    description: "Manage your account",
    icon: Settings,
  },
] as const;

export function MobileSettings({ addresses }: MobileSettingsProps) {
  // Build the items array inside the component
  const items = SETTINGS_ITEMS_BASE.map((item, index) => {
    if (index === 0) {
      return {
        ...item,
        description: `${addresses.length} address${addresses.length !== 1 ? "es" : ""} saved`,
      };
    }
    return item;
  });

  return (
    <div>
      <div className="mb-2">
        <h3 className="font-inter text-sm font-semibold uppercase tracking-[0.7px] text-kk-cocoa">
          ACCOUNT SETTINGS
        </h3>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border border-kk-hair bg-kk-card p-4 transition-colors hover:bg-kk-cream"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-kk-sand">
                <item.icon className="size-5 text-kk-red-ink" />
              </div>
              <div>
                <span className="font-sora text-lg font-semibold text-kk-ink">
                  {item.label}
                </span>
                <p className="font-inter text-sm text-kk-cocoa">
                  {item.description}
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-kk-cocoa" />
          </Link>
        ))}
      </div>
    </div>
  );
}
