// app/(vendor)/settings/_components/SettingsSidebar.tsx
"use client";

import { Store, Clock, Truck, Users } from "lucide-react";

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: "general", label: "General", icon: Store },
  { id: "hours", label: "Operating Hours", icon: Clock },
  { id: "delivery", label: "Delivery Zone", icon: Truck },
  { id: "staff", label: "Staff Members", icon: Users },
] as const;

export function SettingsSidebar({
  activeTab,
  onTabChange,
}: SettingsSidebarProps) {
  return (
    <nav className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible pb-4 lg:pb-0">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`shrink-0 rounded-xl px-4 py-3 text-left font-inter text-sm font-medium transition-all w-full lg:w-auto min-w-[140px] flex items-center gap-3 ${
              isActive
                ? "border border-[#B61913]/20 bg-white text-[#B61913] font-bold"
                : "border border-[#E4BEB8] bg-white text-[#5B403C] hover:bg-[#F6F3F2]"
            }`}
          >
            <Icon
              className={`size-5 ${isActive ? "text-[#B61913]" : "text-[#5B403C]"}`}
            />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
