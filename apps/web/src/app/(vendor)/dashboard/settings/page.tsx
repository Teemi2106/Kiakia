// app/(vendor)/settings/page.tsx
import { getVendorForCurrentUser, verifySession } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsDesktop } from "./_components/SettingsDesktop";
import { SettingsMobile } from "./_components/SettingsMobile";
import type { DayHours, StaffMember, VendorSettings, VendorStaffRole } from "./_components/types";

export const metadata: Metadata = { title: "Store Settings" };

const DAY_COUNT = 7;

/** opening_hours defaults to '{}' until a vendor has ever saved hours — only
 * trust it as real data once it's actually the 7-entry array the settings
 * form writes (see updateVendorOperatingHoursAction's own validation). */
function parseOperatingHours(raw: unknown): DayHours[] | null {
  if (!Array.isArray(raw) || raw.length !== DAY_COUNT) return null;
  return raw as DayHours[];
}

export default async function VendorSettingsPage() {
  const session = await verifySession();
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  // No FK PostgREST can embed on directly (vendor_staff.user_id references
  // auth.users, not profiles) — two queries, joined in JS.
  const admin = createAdminClient();
  const { data: staffRows } = await admin
    .from("vendor_staff")
    .select("user_id, role")
    .eq("vendor_id", vendor.id)
    .order("role", { ascending: true });

  const staffUserIds = (staffRows ?? []).map((row) => row.user_id);
  const { data: profileRows } = staffUserIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", staffUserIds)
    : { data: [] };
  const fullNameByUserId = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  const staff: StaffMember[] = (staffRows ?? []).map((row) => ({
    userId: row.user_id,
    fullName: fullNameByUserId.get(row.user_id) ?? null,
    role: row.role as VendorStaffRole,
    isSelf: row.user_id === session.userId,
  }));

  const currentUserRole = staff.find((s) => s.isSelf)?.role ?? "vendor_staff";

  const vendorSettings: VendorSettings = {
    id: vendor.id,
    name: vendor.name,
    description: vendor.description,
    addressLine: vendor.address_line,
    landmark: vendor.landmark,
    state: vendor.state,
    avgPrepMins: vendor.avg_prep_mins,
    minOrderKobo: vendor.min_order_kobo,
    deliveryRadiusM: vendor.delivery_radius_m,
    isAcceptingOrders: vendor.is_accepting_orders,
    bannerUrl: vendor.banner_url,
    operatingHours: parseOperatingHours(vendor.opening_hours),
    locationLat: vendor.location_lat,
    locationLng: vendor.location_lng,
    staff,
    currentUserRole,
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
