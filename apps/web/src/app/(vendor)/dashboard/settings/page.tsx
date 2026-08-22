// app/(vendor)/settings/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsDesktop } from "./_components/SettingsDesktop";
import { SettingsMobile } from "./_components/SettingsMobile";
import type { VendorSettings } from "./_components/types";

export const metadata: Metadata = { title: "Store Settings" };

export default async function VendorSettingsPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const vendorSettings: VendorSettings = {
    id: vendor.id,
    name: vendor.name,
    description: vendor.description,
    addressLine: vendor.address_line,
    landmark: vendor.landmark,
    avgPrepMins: vendor.avg_prep_mins,
    minOrderKobo: vendor.min_order_kobo,
    deliveryRadiusM: vendor.delivery_radius_m,
    isAcceptingOrders: vendor.is_accepting_orders,
  };

  return (
    <>
      <div className="hidden lg:block">
        <SettingsDesktop vendor={vendorSettings} />
      </div>
      <div className="lg:hidden">
        <SettingsMobile vendor={vendorSettings} />
      </div>
    </>
  );
}
