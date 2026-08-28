// app/(vendor)/settings/_components/types.ts

export interface DayHours {
  day: number; // 0 (Sunday) .. 6 (Saturday), matching JS Date#getDay()
  isOpen: boolean;
  opensAt: string; // "HH:MM"
  closesAt: string;
}

export type VendorStaffRole = "vendor_staff" | "vendor_manager" | "vendor_owner";

export interface StaffMember {
  userId: string;
  fullName: string | null;
  role: VendorStaffRole;
  isSelf: boolean;
}

export interface VendorSettings {
  id: string;
  name: string;
  description: string | null;
  addressLine: string | null;
  landmark: string | null;
  state: string | null;
  avgPrepMins: number;
  minOrderKobo: number;
  deliveryRadiusM: number;
  isAcceptingOrders: boolean;
  bannerUrl: string | null;
  // null when the store hasn't configured hours yet (opening_hours defaults
  // to an empty jsonb object, not a 7-day array) — render a sensible
  // all-days-closed default in that case rather than crashing on it.
  operatingHours: DayHours[] | null;
  locationLat: number | null;
  locationLng: number | null;
  staff: StaffMember[];
  currentUserRole: VendorStaffRole;
}
