import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsForm } from "./_components/SettingsForm";

export const metadata: Metadata = { title: "Store Settings" };

export default async function VendorSettingsPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Store Settings</h1>
      <Card className="mt-4">
        <SettingsForm
          vendor={{
            id: vendor.id,
            name: vendor.name,
            description: vendor.description,
            addressLine: vendor.address_line,
            landmark: vendor.landmark,
            avgPrepMins: vendor.avg_prep_mins,
            minOrderKobo: vendor.min_order_kobo,
            deliveryRadiusM: vendor.delivery_radius_m,
            isAcceptingOrders: vendor.is_accepting_orders,
          }}
        />
      </Card>
    </div>
  );
}
