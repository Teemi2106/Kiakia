import { haversineDistanceM, type LatLng } from "@kiakia/domain";

/** One rider as the fleet console shows them (fleet_list_riders, 0113). */
export interface FleetRider {
  readonly userId: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly vehicleType: string | null;
  readonly kycStatus: string;
  /** The rider's own online switch. */
  readonly isOnline: boolean;
  /** Online AND pinged recently enough that dispatch would still offer them orders. */
  readonly isLive: boolean;
  readonly lastPingAt: string | null;
  readonly position: LatLng | null;
  readonly delivery: FleetDelivery | null;
}

export interface FleetDelivery {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly vendorName: string | null;
  readonly destinationCity: string | null;
  /** Rounded to about 100 m by the database; never the customer's exact door. */
  readonly destination: LatLng | null;
}

/** delivering: carrying an order. available: live and free. no_signal: switched on but not pinging. offline. */
export type FleetRiderStatus = "delivering" | "available" | "no_signal" | "offline";

export function riderStatus(rider: Pick<FleetRider, "delivery" | "isLive" | "isOnline">): FleetRiderStatus {
  if (rider.delivery) return "delivering";
  if (rider.isLive) return "available";
  if (rider.isOnline) return "no_signal";
  return "offline";
}

export const RIDER_STATUS_LABELS: Record<FleetRiderStatus, string> = {
  delivering: "On a delivery",
  available: "Online, free",
  no_signal: "Online, no signal",
  offline: "Offline",
};

/** "just now", "5 min ago", "3 h ago", "2 d ago"; "never" when the rider has not pinged yet. */
export function lastSeenText(lastPingAt: string | null, now: number): string {
  if (!lastPingAt) return "Never";
  const seconds = Math.max(0, Math.round((now - Date.parse(lastPingAt)) / 1000));
  if (Number.isNaN(seconds)) return "Never";
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export interface FleetSummary {
  readonly total: number;
  readonly delivering: number;
  readonly available: number;
  readonly noSignal: number;
  readonly offline: number;
}

export function summarizeRiders(riders: readonly FleetRider[]): FleetSummary {
  const counts = { delivering: 0, available: 0, no_signal: 0, offline: 0 };
  for (const rider of riders) counts[riderStatus(rider)] += 1;
  return {
    total: riders.length,
    delivering: counts.delivering,
    available: counts.available,
    noSignal: counts.no_signal,
    offline: counts.offline,
  };
}

/** A demand cell: the centre of a ~550 m square and how many orders landed in it. */
export interface DemandCell {
  readonly lat: number;
  readonly lng: number;
  readonly orders: number;
}

export interface Hotspot extends DemandCell {
  readonly rank: number;
  /** Free, live riders of this fleet within HOTSPOT_RADIUS_M of the cell. */
  readonly freeRidersNearby: number;
}

export const HOTSPOT_RADIUS_M = 1500;

/**
 * The busiest areas, each with how many free riders are already nearby, so
 * a manager can see where demand is outrunning supply and whom to send.
 * Ties keep the database's order (highest demand first).
 */
export function rankHotspotsNear(cells: readonly DemandCell[], freeRiderPositions: readonly LatLng[], limit = 8): Hotspot[] {
  return [...cells]
    .sort((a, b) => b.orders - a.orders)
    .slice(0, limit)
    .map((cell, index) => ({
      ...cell,
      rank: index + 1,
      freeRidersNearby: freeRiderPositions.filter((position) => haversineDistanceM(position, cell) <= HOTSPOT_RADIUS_M).length,
    }));
}

/** Same as rankHotspotsNear, counting this fleet's live riders who are not on a delivery. */
export function rankHotspots(cells: readonly DemandCell[], riders: readonly FleetRider[], limit = 8): Hotspot[] {
  const free = riders.flatMap((rider) => (riderStatus(rider) === "available" && rider.position ? [rider.position] : []));
  return rankHotspotsNear(cells, free, limit);
}

/** Raw fleet_list_riders row, as the generated types describe it. */
export interface FleetRiderRow {
  readonly user_id: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly vehicle_type: string | null;
  readonly kyc_status: string;
  readonly is_online: boolean;
  readonly is_live: boolean | null;
  readonly last_ping_at: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly order_id: string | null;
  readonly order_code: string | null;
  readonly order_status: string | null;
  readonly vendor_name: string | null;
  readonly dest_city: string | null;
  readonly dest_lat: number | null;
  readonly dest_lng: number | null;
}

function point(lat: number | null, lng: number | null): LatLng | null {
  return lat === null || lng === null ? null : { lat, lng };
}

export function toFleetRider(row: FleetRiderRow): FleetRider {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    phone: row.phone,
    vehicleType: row.vehicle_type,
    kycStatus: row.kyc_status,
    isOnline: row.is_online,
    isLive: row.is_live === true,
    lastPingAt: row.last_ping_at,
    position: point(row.lat, row.lng),
    delivery:
      row.order_id && row.order_code
        ? {
            orderId: row.order_id,
            orderCode: row.order_code,
            status: row.order_status ?? "",
            vendorName: row.vendor_name,
            destinationCity: row.dest_city,
            destination: point(row.dest_lat, row.dest_lng),
          }
        : null,
  };
}
