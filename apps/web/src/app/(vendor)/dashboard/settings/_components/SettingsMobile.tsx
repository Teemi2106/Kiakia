// app/(vendor)/settings/_components/SettingsMobile.tsx
"use client";

import { useState } from "react";
import { ChevronRight, Clock, MapPin, Users, Settings } from "lucide-react";
import { OperatingHours } from "./OperatingHours";
import { DeliveryZone } from "./DeliveryZone";
import { StaffMembers } from "./StaffMembers";
import { GeneralSettings } from "./GeneralSettings";
import type { VendorSettings } from "./types";

interface SettingsMobileProps {
  vendor: VendorSettings;
}

type SubScreen = "general" | "hours" | "delivery" | "staff" | null;

export function SettingsMobile({ vendor }: SettingsMobileProps) {
  const [activeSubScreen, setActiveSubScreen] = useState<SubScreen>(null);

  const menuItems = [
    {
      id: "hours",
      label: "Operating Hours",
      icon: Clock,
      color: "bg-[#FFDCC5] text-[#934B00]",
    },
    {
      id: "delivery",
      label: "Delivery Zone",
      icon: MapPin,
      color: "bg-[#FFDAD5] text-[#B61913]",
    },
    {
      id: "staff",
      label: "Staff",
      icon: Users,
      color: "bg-[#A3F69D] text-[#005313]",
    },
    {
      id: "general",
      label: "Account",
      icon: Settings,
      color: "bg-[#F0EDED] text-[#5B403C]",
    },
  ];

  const renderSubScreen = () => {
    switch (activeSubScreen) {
      case "hours":
        return <OperatingHours vendor={vendor} />;
      case "delivery":
        return <DeliveryZone vendor={vendor} />;
      case "staff":
        return <StaffMembers vendor={vendor} />;
      case "general":
        return <GeneralSettings vendor={vendor} />;
      default:
        return null;
    }
  };

  // If a sub-screen is open, show it
  if (activeSubScreen) {
    return (
      <div className="flex h-full flex-col bg-[#FCF9F8]">
        <header className="flex items-center gap-4 border-b border-[#E4BEB8] px-4 py-4">
          <button
            onClick={() => setActiveSubScreen(null)}
            className="rounded-full p-2 transition-colors hover:bg-[#F0EDED]"
          >
            <ChevronRight className="size-5 text-[#B61913]" />
          </button>
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            {menuItems.find((item) => item.id === activeSubScreen)?.label}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto p-4 pb-24">
          {renderSubScreen()}
        </div>
      </div>
    );
  }

  // Main menu
  return (
    <div className="p-4 pb-24">
      <section className="max-w-3xl mx-auto space-y-6">
        <div className="grid grid-cols-1 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSubScreen(item.id as SubScreen)}
                className="group flex items-center justify-between rounded-2xl border border-[#E4BEB8] bg-white p-6 text-left transition-all hover:shadow-lg"
              >
                <div className="flex items-center gap-6">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full ${item.color}`}
                  >
                    <Icon className="size-6" />
                  </div>
                  <div>
                    <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
                      {item.label}
                    </h3>
                    <p className="text-sm text-[#5B403C]">
                      {item.id === "hours" &&
                        "Set your daily opening and closing times."}
                      {item.id === "delivery" &&
                        "Manage your delivery radius and map boundaries."}
                      {item.id === "staff" &&
                        "Manage team access and permissions."}
                      {item.id === "general" &&
                        "Update kitchen profile and security settings."}
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-6 text-[#5B403C] transition-transform group-hover:translate-x-1" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
