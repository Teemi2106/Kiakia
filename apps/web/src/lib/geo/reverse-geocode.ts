import { normalizeNigerianState, type LatLng, type NigerianState } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";

export interface ReversedAddress {
  /** Street address as best the geocoder knows it; null when it only resolved a town or state. */
  readonly line1: string | null;
  readonly city: string | null;
  /** Canonical state, or null when the geocoder's region isn't a Nigerian state. */
  readonly state: NigerianState | null;
}

interface MapboxContextName {
  readonly name?: string;
}

interface MapboxReverseResponse {
  readonly features?: ReadonlyArray<{
    readonly properties?: {
      readonly name?: string;
      readonly feature_type?: string;
      readonly context?: {
        readonly address?: MapboxContextName;
        readonly street?: MapboxContextName;
        readonly locality?: MapboxContextName;
        readonly place?: MapboxContextName;
        readonly district?: MapboxContextName;
        readonly region?: MapboxContextName;
      };
    };
  }>;
}

/**
 * Turns coordinates into address fields so the customer/vendor doesn't have
 * to type a state. Best-effort by design: no Mapbox token, a network error or
 * an empty result all resolve to null and the form simply stays manual — the
 * coordinates themselves are what the database requires.
 */
export async function reverseGeocode(point: LatLng, signal?: AbortSignal): Promise<ReversedAddress | null> {
  const token = clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("country", "ng");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as MapboxReverseResponse;
    const feature = body.features?.[0]?.properties;
    if (!feature) return null;

    const context = feature.context ?? {};
    const isAddress = feature.feature_type === "address" || feature.feature_type === "street";
    const street = isAddress ? feature.name : (context.street?.name ?? null);

    return {
      line1: street ?? null,
      city: context.place?.name ?? context.locality?.name ?? context.district?.name ?? null,
      state: normalizeNigerianState(context.region?.name ?? (feature.feature_type === "region" ? feature.name : null)),
    };
  } catch {
    return null;
  }
}
