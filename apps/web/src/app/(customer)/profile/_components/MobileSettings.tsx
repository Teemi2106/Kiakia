// app/(customer)/profile/_components/MobileSettings.tsx
"use client";

import { ChevronRight, MapPin, CreditCard, Bell, Settings } from "lucide-react";
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

// Give all items a description property (even if placeholder)
const SETTINGS_ITEMS_BASE = [
  {
    href: "/profile/addresses",
    label: "Saved Addresses",
    description: "", // Placeholder - will be replaced
    icon: MapPin,
  },
  {
    href: "/profile/payments",
    label: "Payment Methods",
    description: "Manage your payment options",
    icon: CreditCard,
  },
  {
    href: "/profile/notifications",
    label: "Notifications",
    description: "Manage your preferences",
    icon: Bell,
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
        <h3 className="font-inter text-sm font-semibold uppercase tracking-[0.7px] text-[#5B403C]">
          ACCOUNT SETTINGS
        </h3>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border border-[#E5E2E1] bg-white p-4 transition-colors hover:bg-[#FCF9F8]"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F6F3F2]">
                <item.icon className="size-5 text-[#B61913]" />
              </div>
              <div>
                <span className="font-sora text-lg font-semibold text-[#1C1B1B]">
                  {item.label}
                </span>
                <p className="font-inter text-sm text-[#5B403C]">
                  {item.description}
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-[#5B403C]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
