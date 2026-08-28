/**
 * Great-circle distance, for display-only previews (e.g. the checkout map's
 * "X km away" hint before an order exists). NOT the billing distance —
 * place_order() (supabase/migrations/0008_place_order.sql) computes that
 * server-side via PostGIS `st_distance()` on the geography columns, which
 * accounts for the earth's actual spheroid shape rather than approximating
 * it as a sphere. The two will differ by a small margin; that's expected.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
