import type { LatLng, NigerianState } from "@kiakia/domain";
import { normalizeNigerianState } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";

export interface AddressSearchResult {
  readonly id: string;
  readonly label: string;
  readonly line1: string;
  readonly city: string;
  readonly state: NigerianState | null;
  readonly point: LatLng;
  readonly provider: "geoapify" | "mapbox";
}

interface GeoapifyResponse {
  readonly results?: ReadonlyArray<{
    readonly place_id?: string;
    readonly lat?: number;
    readonly lon?: number;
    readonly formatted?: string;
    readonly address_line1?: string;
    readonly name?: string;
    readonly city?: string;
    readonly town?: string;
    readonly village?: string;
    readonly municipality?: string;
    readonly suburb?: string;
    readonly district?: string;
    readonly state?: string;
    readonly country_code?: string;
  }>;
}

interface GeocodingResponse {
  readonly features?: ReadonlyArray<{
    readonly id?: string;
    readonly geometry?: { readonly coordinates?: readonly number[] };
    readonly properties?: {
      readonly name?: string;
      readonly full_address?: string;
      readonly place_formatted?: string;
      readonly feature_type?: string;
      readonly context?: {
        readonly address?: { readonly name?: string };
        readonly street?: { readonly name?: string };
        readonly place?: { readonly name?: string };
        readonly locality?: { readonly name?: string };
        readonly district?: { readonly name?: string };
        readonly region?: { readonly name?: string };
      };
    };
  }>;
}

/** Search Nigerian streets, neighborhoods and towns with storable results. */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressSearchResult[]> {
  const geoapifyKey = clientEnv.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  if (geoapifyKey) {
    try {
      const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
      url.searchParams.set("text", query.trim());
      url.searchParams.set("filter", "countrycode:ng");
      url.searchParams.set("lang", "en");
      url.searchParams.set("limit", "10");
      url.searchParams.set("format", "json");
      url.searchParams.set("apiKey", geoapifyKey);

      const response = await fetch(url, { signal });
      if (response.ok) {
        const body = (await response.json()) as GeoapifyResponse;
        const results = (body.results ?? []).flatMap((result) => {
          const lat = result.lat;
          const lng = result.lon;
          if (
            typeof lat !== "number" || typeof lng !== "number" ||
            !Number.isFinite(lat) || !Number.isFinite(lng) ||
            lat < 4.2 || lat > 13.9 || lng < 2.6 || lng > 14.7 ||
            (result.country_code && result.country_code.toLowerCase() !== "ng")
          ) return [];

          const label = result.formatted ?? result.address_line1 ?? result.name ?? "Address";
          const line1 = result.address_line1 ?? result.name ?? label;
          const city = result.city ?? result.town ?? result.village ?? result.municipality ?? result.suburb ?? result.district ?? "";
          return [{
            id: result.place_id ?? `${lng},${lat}`,
            label,
            line1,
            city,
            state: normalizeNigerianState(result.state ?? null),
            point: { lat, lng },
            provider: "geoapify" as const,
          }];
        });
        if (results.length > 0) return results;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // Keep the existing Mapbox search available if Geoapify is unavailable.
    }
  }

  const token = clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) throw new Error("Address search is unavailable right now.");

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("country", "ng");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "10");
  // Return partial matches such as neighborhoods while the customer is
  // searching. AddressSearch debounces requests so this doesn't fire per key.
  url.searchParams.set("autocomplete", "true");
  // Saved address coordinates are retained in our database, so request
  // permanent geocoding results as required by Mapbox's storage terms.
  url.searchParams.set("permanent", "true");
  url.searchParams.set("access_token", token);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not search addresses. Please try again.");
  const body = (await response.json()) as GeocodingResponse;

  return (body.features ?? []).flatMap((feature) => {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (!properties || !coordinates || coordinates.length < 2) return [];
    const [lng, lat] = coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 4.2 || lat > 13.9 || lng < 2.6 || lng > 14.7) return [];

    const context = properties.context ?? {};
    const name = properties.name ?? properties.full_address ?? "Address";
    const line1 = context.address?.name ?? context.street?.name ?? name;
    const city = context.place?.name ?? context.locality?.name ?? context.district?.name ?? "";
    const state = normalizeNigerianState(context.region?.name ?? null);
    const label = properties.full_address ?? [name, properties.place_formatted].filter(Boolean).join(", ");

    return [{
      id: feature.id ?? `${lng},${lat}`,
      label,
      line1,
      city,
      state,
      point: { lat, lng },
      provider: "mapbox" as const,
    }];
  });
}
