// app/(vendor)/settings/_components/SettingsDesktop.tsx
"use client";

import { useState } from "react";
import { SettingsSidebar } from "./SettingsSidebar";
import { GeneralSettings } from "./GeneralSettings";
import { OperatingHours } from "./OperatingHours";
import { DeliveryZone } from "./DeliveryZone";
import { StaffMembers } from "./StaffMembers";
import type { VendorSettings } from "./types";

interface SettingsDesktopProps {
  vendor: VendorSettings;
}

export function SettingsDesktop({ vendor }: SettingsDesktopProps) {
  const [activeTab, setActiveTab] = useState("general");

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings vendor={vendor} />;
      case "hours":
        return <OperatingHours />;
      case "delivery":
        return <DeliveryZone />;
      case "staff":
        return <StaffMembers />;
      default:
        return <GeneralSettings vendor={vendor} />;
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row">
      {/* Sidebar */}
      <div className="w-full lg:w-72">
        <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6">{renderContent()}</div>
    </div>
  );
}
