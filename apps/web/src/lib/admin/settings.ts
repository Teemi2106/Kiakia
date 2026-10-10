import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { unwrap } from "./lookups";

export interface ServiceAreaView {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly baseDeliveryFeeKobo: number;
  readonly perKmFeeKobo: number;
  readonly riderBaseFeeKobo: number;
  readonly riderPerKmFeeKobo: number;
  readonly launchedAt: string | null;
}

/** Every service area, active first. The polygon is not loaded: geometry is not editable here. */
export async function listServiceAreas(): Promise<ServiceAreaView[]> {
  await requireAdminContext();
  const rows =
    unwrap(
      await createAdminClient()
        .from("service_areas")
        .select("id, name, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo, launched_at")
        .order("is_active", { ascending: false })
        .order("name"),
    ) ?? [];

  return rows.map((area) => ({
    id: area.id,
    name: area.name,
    isActive: area.is_active,
    baseDeliveryFeeKobo: area.base_delivery_fee_kobo,
    perKmFeeKobo: area.per_km_fee_kobo,
    riderBaseFeeKobo: area.rider_base_fee_kobo,
    riderPerKmFeeKobo: area.rider_per_km_fee_kobo,
    launchedAt: area.launched_at,
  }));
}
