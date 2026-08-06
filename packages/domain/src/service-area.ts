/**
 * Point-in-polygon containment, mirrored from the PostGIS `ST_Contains`
 * check the database runs authoritatively at checkout (§15 "Schema
 * treatment", §19 "area containment" is listed as a 100%-unit-tested
 * domain function). This copy exists for instant client-side UX feedback
 * ("this address looks outside our delivery area") — it is never the
 * source of truth. The RPC that places an order re-validates with
 * `ST_Contains` against `service_areas.polygon` server-side; a client
 * bypassing this check cannot place an out-of-area order.
 *
 * Coordinates are [longitude, latitude] pairs, matching GeoJSON and
 * PostGIS's `geography(Polygon, 4326)` ordering — not [lat, lng].
 */

export interface GeoPoint {
  readonly lng: number;
  readonly lat: number;
}

/** A simple (non-self-intersecting) polygon ring, first point not repeated at the end. */
export type PolygonRing = readonly GeoPoint[];

/**
 * Ray-casting point-in-polygon test. O(n) in the number of ring vertices.
 * Points exactly on the boundary may return either true or false depending
 * on floating point rounding — acceptable for a UX pre-check; the
 * server-side ST_Contains call is authoritative.
 */
export function isPointInPolygon(point: GeoPoint, ring: PolygonRing): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vi = ring[i]!;
    const vj = ring[j]!;

    const intersects =
      vi.lat > point.lat !== vj.lat > point.lat &&
      point.lng < ((vj.lng - vi.lng) * (point.lat - vi.lat)) / (vj.lat - vi.lat) + vi.lng;

    if (intersects) inside = !inside;
  }

  return inside;
}

export interface ServiceAreaCheck {
  readonly id: string;
  readonly name: string;
  readonly polygon: PolygonRing;
  readonly isActive: boolean;
}

/** Returns the first active service area containing `point`, or null. */
export function findContainingServiceArea(
  point: GeoPoint,
  areas: readonly ServiceAreaCheck[],
): ServiceAreaCheck | null {
  for (const area of areas) {
    if (area.isActive && isPointInPolygon(point, area.polygon)) {
      return area;
    }
  }
  return null;
}
