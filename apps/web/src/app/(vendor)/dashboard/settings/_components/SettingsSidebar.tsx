// app/(vendor)/settings/_components/SettingsSidebar.tsx
"use client";

import { Store, Clock, Truck, Users } from "lucide-react";

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  {
    id: "general",
    label: "General",
    description: "Store profile & preferences",
    icon: Store,
    accent: "bg-kk-fill text-kk-cocoa",
  },
  {
    id: "hours",
    label: "Operating Hours",
    description: "Daily open & close times",
    icon: Clock,
    accent: "bg-notice-surface text-kk-orange-ink",
  },
  {
    id: "delivery",
    label: "Delivery Zone",
    description: "Radius & coverage map",
    icon: Truck,
    accent: "bg-kk-danger-wash text-kk-red-ink",
  },
  {
    id: "staff",
    label: "Staff Members",
    description: "Team access & roles",
    icon: Users,
    accent: "bg-[#A3F69D] text-[#005313]",
  },
] as const;

export function SettingsSidebar({
  activeTab,
  onTabChange,
}: SettingsSidebarProps) {
  return (
    <nav className="rounded-2xl border border-kk-line bg-kk-card p-3 shadow-sm lg:p-4">
      <h2 className="hidden px-2 pb-3 font-sora text-lg font-semibold text-kk-ink lg:block">
        Settings
      </h2>
      <div className="flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex w-full min-w-[220px] shrink-0 items-center gap-3 rounded-xl border px-3 py-3 text-left font-inter transition-colors lg:min-w-0 ${
                isActive
                  ? "border-kk-red/20 bg-kk-red-tint"
                  : "border-transparent hover:bg-kk-sand"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tab.accent}`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-semibold ${
                    isActive ? "text-kk-red-ink" : "text-kk-ink"
                  }`}
                >
                  {tab.label}
                </span>
                <span className="hidden truncate text-xs text-kk-cocoa lg:block">
                  {tab.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
