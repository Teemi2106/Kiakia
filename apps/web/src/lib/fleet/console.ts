import "server-only";
import { requireFleetContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFleetRider, type DemandCell, type FleetRider } from "./fleet-info";

/**
 * Every read here starts from requireFleetContext(): the fleet id is the
 * signed-in manager's own membership, never a parameter. The RPCs are
 * service_role only (0113), so the admin client is the only way in and this
 * gate is what scopes it.
 */

export async function loadFleetRiders(): Promise<{ fleetName: string; riders: FleetRider[]; loadedAt: number }> {
  const { fleet } = await requireFleetContext();
  const { data, error } = await createAdminClient().rpc("fleet_list_riders", { p_fleet_id: fleet.fleetId });
  if (error) throw new Error(error.message);
  // loadedAt is what "last seen" is measured against, so every row on a page agrees.
  return { fleetName: fleet.fleetName, riders: (data ?? []).map(toFleetRider), loadedAt: Date.now() };
}

export const DEMAND_WINDOWS = [1, 3, 6, 24] as const;
export type DemandWindow = (typeof DEMAND_WINDOWS)[number];

export function parseDemandWindow(raw: string | undefined): DemandWindow {
  return DEMAND_WINDOWS.find((hours) => String(hours) === raw) ?? 3;
}

export async function loadDemandCells(hours: DemandWindow): Promise<DemandCell[]> {
  const { fleet } = await requireFleetContext();
  const { data, error } = await createAdminClient().rpc("fleet_demand_cells", { p_fleet_id: fleet.fleetId, p_hours: hours });
  if (error) throw new Error(error.message);
  // bigint counts come back as numbers or strings depending on the driver.
  return (data ?? []).map((cell) => ({ lat: cell.lat, lng: cell.lng, orders: Number(cell.orders) }));
}
