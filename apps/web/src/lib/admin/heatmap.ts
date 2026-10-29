import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import type { DemandCell } from "@/lib/fleet/fleet-info";
import { createAdminClient } from "@/lib/supabase/admin";

export const HEATMAP_WINDOWS = [1, 3, 6, 24, 72] as const;
export type HeatmapWindow = (typeof HEATMAP_WINDOWS)[number];

export function parseHeatmapWindow(raw: string | undefined): HeatmapWindow {
  return HEATMAP_WINDOWS.find((hours) => String(hours) === raw) ?? 3;
}

export interface HeatmapRider {
  readonly userId: string;
  readonly fullName: string;
  readonly lat: number;
  readonly lng: number;
  /** Online and pinging recently enough for dispatch to offer them orders. */
  readonly isLive: boolean;
  readonly onDelivery: boolean;
  readonly fleetName: string | null;
}

/** Whole-platform demand and every online rider: the admin view, no fleet scoping and no minimum order count. */
export async function loadHeatmap(hours: HeatmapWindow): Promise<{ cells: DemandCell[]; riders: HeatmapRider[] }> {
  await requireAdminContext();
  const admin = createAdminClient();

  const [cells, riders] = await Promise.all([
    admin.rpc("admin_demand_cells", { p_hours: hours, p_min_orders: 1 }),
    admin.rpc("admin_live_riders"),
  ]);
  if (cells.error) throw new Error(cells.error.message);
  if (riders.error) throw new Error(riders.error.message);

  return {
    // bigint counts come back as numbers or strings depending on the driver.
    cells: (cells.data ?? []).map((cell) => ({ lat: cell.lat, lng: cell.lng, orders: Number(cell.orders) })),
    riders: (riders.data ?? []).map((rider) => ({
      userId: rider.user_id,
      fullName: rider.full_name,
      lat: rider.lat,
      lng: rider.lng,
      isLive: rider.is_live,
      onDelivery: rider.on_delivery,
      fleetName: rider.fleet_name,
    })),
  };
}
